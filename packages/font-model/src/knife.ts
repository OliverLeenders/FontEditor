import { type Cubic, type Vec2, subcurve } from "@fonteditor/geometry";

import { type Contour, contour, segmentAt, segmentCount, segmentCubic } from "./contour.js";
import { type StrokeCrossing, byContour, samePoint, strokeCrossings } from "./crossings.js";
import type { Glyph } from "./glyph.js";
import type { IdFactory } from "./ids.js";
import { type Node, node } from "./node.js";

/**
 * Cutting a glyph along a straight stroke.
 *
 * The interesting half is not finding where the stroke crosses the outline — a
 * cubic substituted into a line's distance function is a cubic in `t`, and that
 * is arithmetic. It is what to do afterwards.
 *
 * A knife that only split contours open would be easy and nearly useless: what
 * you want from cutting a shape is two shapes. So the crossings are sorted along
 * the *stroke* and paired off consecutively. Each pair spans a stretch of the
 * stroke that lies inside the glyph, and those stretches are the new edges.
 *
 * That pairing is what makes the general case fall out rather than needing a
 * case of its own. Cut across an `o` and the stroke meets the outer contour, the
 * counter, the counter again, and the outer again — four crossings, pairing as
 * outer-to-counter and counter-to-outer, which is exactly the two chords each
 * half needs. Nothing here knows what a counter is.
 */

export type KnifeCut = {
  readonly glyph: Glyph;
  /** How many times the stroke crossed the outline. */
  readonly crossings: number;
  /** Contours left alone because the cut could not be made sense of. */
  readonly skipped: number;
};

/** A crossing after the contours have been split, when it is a node of its own. */
type Meeting = {
  readonly contour: number;
  readonly index: number;
  readonly u: number;
};

/**
 * Cut every closed contour a stroke passes through.
 *
 * `null` when the stroke cuts nothing, so a caller can tell "no crossings" from
 * "cut, and here is the result". An open contour is left alone: it has no inside
 * for a chord to close across, and slicing one is a different operation wearing
 * the same name.
 */
export function cutGlyph(g: Glyph, a: Vec2, b: Vec2, ids: IdFactory): KnifeCut | null {
  const found = strokeCrossings(g, a, b);
  if (found.length === 0) return null;

  const perContour = byContour(found);
  const crossings = found.length;

  // A contour crossed an odd number of times has been grazed rather than cut —
  // the stroke came in and did not come out, which means it ended inside or ran
  // along the outline. There is no honest pair of shapes to make from that, so
  // the contour is left exactly as it was and the caller is told.
  let skipped = 0;
  const cutting = new Map<number, StrokeCrossing[]>();
  for (const [index, list] of perContour) {
    if (list.length % 2 === 1) skipped += 1;
    else cutting.set(index, list);
  }
  if (cutting.size === 0) return { glyph: g, crossings, skipped };

  // Split every cut contour so each crossing is a node of its own.
  const split = new Map<number, { contour: Contour; meetings: Meeting[] }>();
  for (const [index, list] of cutting) {
    const source = g.contours[index];
    if (source === undefined) continue;
    split.set(index, splitAtCrossings(source, list, ids, index));
  }

  const meetings: Meeting[] = [];
  for (const entry of split.values()) meetings.push(...entry.meetings);
  meetings.sort((l, r) => l.u - r.u);

  // Consecutive pairs along the stroke. An odd one out cannot happen here, since
  // every contour contributed an even number.
  const partner = new Map<string, Meeting>();
  const key = (m: Meeting): string => `${String(m.contour)}:${String(m.index)}`;
  for (let i = 0; i + 1 < meetings.length; i += 2) {
    const first = meetings[i]!;
    const second = meetings[i + 1]!;
    partner.set(key(first), second);
    partner.set(key(second), first);
  }

  const loops = walk(split, partner, meetings, key, ids);
  if (loops === null) return { glyph: g, crossings, skipped: skipped + cutting.size };

  const kept = g.contours.filter((_, index) => !cutting.has(index));
  return { glyph: { ...g, contours: [...kept, ...loops] }, crossings, skipped };
}

/**
 * Walk the cut outline into closed loops.
 *
 * From a crossing, follow the contour it is on forwards to the next crossing,
 * then step across the stroke to that crossing's partner, and go on. Every
 * crossing is left once by the outline and once by the stroke, so starting at
 * each in turn yields each half exactly once.
 */
function walk(
  split: ReadonlyMap<number, { contour: Contour; meetings: Meeting[] }>,
  partner: ReadonlyMap<string, Meeting>,
  meetings: readonly Meeting[],
  key: (m: Meeting) => string,
  ids: IdFactory,
): Contour[] | null {
  const departed = new Set<string>();
  const loops: Contour[] = [];

  for (const start of meetings) {
    if (departed.has(key(start))) continue;

    const nodes: Node[] = [];
    let at = start;
    // A loop cannot visit more crossings than exist, twice over; anything longer
    // means the pairing is inconsistent and guessing further would be worse.
    const limit = meetings.length * 2 + 4;

    for (let step = 0; step <= limit; step++) {
      const entry = split.get(at.contour);
      if (entry === undefined) return null;
      departed.add(key(at));

      const next = nextMeeting(entry, at);
      if (next === null) return null;

      // The arc from this crossing to the next, along the outline.
      nodes.push(...arc(entry.contour, at.index, next.index, ids));

      const across = partner.get(key(next));
      if (across === undefined) return null;
      if (across.contour === start.contour && across.index === start.index) {
        loops.push(contour(ids.contour(), nodes, true));
        break;
      }
      if (step === limit) return null;
      at = across;
    }
  }

  return loops.length === 0 ? null : loops;
}

/** The next crossing round the contour from this one. */
function nextMeeting(
  entry: { contour: Contour; meetings: Meeting[] },
  from: Meeting,
): Meeting | null {
  const ordered = [...entry.meetings].sort((l, r) => l.index - r.index);
  const at = ordered.findIndex((m) => m.index === from.index);
  if (at < 0) return null;
  return ordered[(at + 1) % ordered.length] ?? null;
}

/**
 * The nodes from one crossing up to the next, going forwards round the contour.
 *
 * The last node is left out: it is the next crossing, and it will be added by
 * the chord that leaves it. Handles are carried as they are, except that the
 * arc's first node loses its incoming one and its last keeps its outgoing —
 * a chord arrives and leaves straight.
 */
function arc(c: Contour, from: number, to: number, ids: IdFactory): Node[] {
  const out: Node[] = [];
  const count = c.nodes.length;

  for (let step = 0; step < count; step++) {
    const index = (from + step) % count;
    const source = c.nodes[index]!;
    const first = step === 0;

    out.push(
      node(ids.node(), source.pt, {
        type: first ? "corner" : source.type,
        // The chord that arrives here is straight, so the handle facing it goes.
        in: first ? null : source.in,
        out: source.out,
      }),
    );
    if (index === to) break;
  }

  // The crossing this arc ends at keeps no outgoing handle: the chord leaving it
  // is straight too.
  const last = out[out.length - 1];
  if (last !== undefined) out[out.length - 1] = { ...last, out: null, type: "corner" };
  return out;
}

/**
 * Rebuild a contour with a node at every crossing.
 *
 * Built as a ring of pieces rather than by inserting into the node list. Every
 * piece is a genuine subcurve, so the shape is unchanged by cutting it — a knife
 * moves nothing, it only adds places where the outline can be taken apart.
 *
 * A crossing that lands on a node uses that node instead of splitting there.
 * This is the common case rather than a corner one: the extremes are where the
 * points are and where anyone aims, and splitting at `t = 0` would make a piece
 * of no length, which is how three-node loops of one repeated point appear.
 */
function splitAtCrossings(
  c: Contour,
  hits: readonly StrokeCrossing[],
  ids: IdFactory,
  contourIndex: number,
): { contour: Contour; meetings: Meeting[] } {
  const count = segmentCount(c);

  // Which original nodes a crossing landed on, and where each segment is cut.
  const onNode = new Map<number, number>();
  const inside = new Map<number, { t: number; u: number }[]>();

  for (const hit of hits) {
    const segment = segmentAt(c, hit.segmentIndex);
    if (segment === null) continue;

    if (samePoint(hit.point, segment.a)) {
      onNode.set(hit.segmentIndex, hit.u);
      continue;
    }
    if (samePoint(hit.point, segment.b)) {
      onNode.set((hit.segmentIndex + 1) % count, hit.u);
      continue;
    }
    const list = inside.get(hit.segmentIndex) ?? [];
    // The same crossing can be found twice when a stroke grazes; once is enough.
    if (!list.some((seen) => Math.abs(seen.t - hit.t) < 1e-7)) list.push({ t: hit.t, u: hit.u });
    inside.set(hit.segmentIndex, list);
  }

  // The ring of pieces, each with the anchor it starts at.
  type Piece = { readonly cubic: Cubic; readonly line: boolean };
  type Anchor = { readonly pt: Vec2; readonly type: Node["type"]; readonly u: number | null };

  const pieces: Piece[] = [];
  const anchors: Anchor[] = [];

  for (let i = 0; i < count; i++) {
    const segment = segmentAt(c, i);
    if (segment === null) continue;

    const start = c.nodes[i]!;
    const crossed = onNode.has(i);
    anchors.push({
      pt: start.pt,
      type: crossed ? "corner" : start.type,
      u: crossed ? onNode.get(i)! : null,
    });

    const whole = segmentCubic(segment);
    const line = segment.kind === "line";
    const ts = (inside.get(i) ?? []).slice().sort((l, r) => l.t - r.t);
    const stops = [0, ...ts.map((x) => x.t), 1];

    for (let k = 0; k + 1 < stops.length; k++) {
      pieces.push({ cubic: subcurve(whole, stops[k]!, stops[k + 1]!), line });
      // Every stop but the last opens a piece; the ones after the first are the
      // interior crossings, and each becomes an anchor of its own.
      if (k + 1 < stops.length - 1) {
        anchors.push({ pt: subcurve(whole, 0, stops[k + 1]!).b, type: "corner", u: ts[k]!.u });
      }
    }
  }

  const nodes: Node[] = [];
  const meetings: Meeting[] = [];

  for (const [index, anchor] of anchors.entries()) {
    const before = pieces[(index - 1 + pieces.length) % pieces.length]!;
    const after = pieces[index]!;

    nodes.push(
      node(ids.node(), anchor.pt, {
        type: anchor.type,
        in: before.line ? null : before.cubic.c2,
        out: after.line ? null : after.cubic.c1,
      }),
    );
    if (anchor.u !== null) meetings.push({ contour: contourIndex, index, u: anchor.u });
  }

  return { contour: contour(c.id, nodes, true), meetings };
}
