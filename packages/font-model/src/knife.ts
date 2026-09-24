import { type Cubic, type Vec2, subcurve } from "@typewright/geometry";

import { type Contour, contour, segmentAt, segmentCount, segmentCubic } from "./contour.js";
import { type StrokeCrossing, byContour, samePoint, strokeCrossings } from "./crossings.js";
import { contourPolygon, insidePolygons, shapesOf } from "./direction.js";
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
 * the *stroke* and paired off wherever the stretch between two of them lies
 * inside the ink, and those stretches are the new edges.
 *
 * That pairing is what makes the general case fall out rather than needing a
 * case of its own. Cut across an `o` and the stroke meets the outer contour, the
 * counter, the counter again, and the outer again — four crossings, pairing as
 * outer-to-counter and counter-to-outer, which is exactly the two chords each
 * half needs. Nothing here knows what a counter is.
 *
 * Pairing along the stroke rather than within a contour is also what lets a cut
 * *join* two contours. Go into an `o` from outside and stop in the counter: the
 * outer contour is met once and the counter once, and the pair spans the ink
 * between them. Walking that gives a single closed contour — round the outside,
 * along the stroke inwards, round the counter, back along the stroke — which is
 * a ring with a slit in it, and is simply connected the way a `c` is where the
 * `o` was not. One shape where there were two, and the hole is gone: the slit
 * has no width yet, and pulling it open is drawing rather than cutting.
 *
 * Pairing happens inside one *shape* — a contour and the holes in it — rather
 * than across the glyph. The two look the same from the stroke: between an
 * outer contour and its counter is ink, and so is the stretch between two
 * overlapping shapes. They are not the same thing to cut. A counter is part of
 * the boundary of the ink the outer contour holds, so a chord across it belongs
 * to that one shape; two shapes that happen to overlap are two things, and a
 * knife through both should leave each of them cut rather than weave one out of
 * the two. Paired along the whole glyph, two overlapping squares came out as a
 * pair of pinwheels — the bottom of one stitched to the top of the other — and
 * pulling a piece away tore both.
 *
 * A crossing whose stretch of ink runs to an end of the stroke has no partner.
 * The stroke came in and did not come out, so there is no chord to close there —
 * but there is a place worth naming, so a point goes in and the contour keeps
 * its shape. That is the knife used to mark rather than to cut, and it is how a
 * point gets put exactly where a stroke crosses an edge.
 */

export type KnifeCut = {
  readonly glyph: Glyph;
  /** How many times the stroke crossed the outline. */
  readonly crossings: number;
  /** Contours left alone because the cut could not be made sense of. */
  readonly skipped: number;
  /** Places the stroke marked without dividing anything. */
  readonly marked: number;
  /** Open contours the stroke divided. */
  readonly divided: number;
  /** Stretches of ink the stroke closed across: the new edges a cut made. */
  readonly chords: number;
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
  const found = strokeCrossings(g, a, b, { open: true });
  if (found.length === 0) return null;

  const perContour = byContour(found);
  const crossings = found.length;

  // An open contour has no inside, so there is no chord to close across it and
  // no parity to satisfy: a path that is cut is simply shorter paths. It is set
  // aside here so the pairing below is about closed outlines alone.
  const cutting = new Map<number, StrokeCrossing[]>();
  const dividing = new Map<number, StrokeCrossing[]>();

  for (const [index, list] of perContour) {
    const source = g.contours[index];
    if (source === undefined) continue;
    if (source.closed) cutting.set(index, list);
    else dividing.set(index, list);
  }

  let divided = 0;
  const replaced = new Map<number, Contour[]>();

  for (const [index, list] of dividing) {
    const source = g.contours[index]!;
    const pieces = dividePath(source, list, ids);
    if (pieces === null) continue;
    replaced.set(index, pieces);
    divided += 1;
  }

  if (cutting.size === 0) {
    const glyph = replaced.size === 0 ? g : { ...g, contours: rebuilt(g.contours, replaced, []) };
    return { glyph, crossings, skipped: 0, marked: 0, divided, chords: 0 };
  }

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

  // Pairs along the stroke, within one shape, and only where the stretch
  // between two crossings is that shape's ink. Counting pairs off by parity
  // assumes the stroke began outside the letter; one that begins inside a stem
  // pairs the wrong way round, and the stretch it closes across is the white
  // between two stems — a `v` cut from stem to stem grew a bar across its
  // mouth. Asking the midpoint, as the section ruler does, is right wherever
  // the stroke starts.
  const partner = new Map<string, Meeting>();
  const key = (m: Meeting): string => `${String(m.contour)}:${String(m.index)}`;
  const pointOf = (m: Meeting): Vec2 | null =>
    split.get(m.contour)?.contour.nodes[m.index]?.pt ?? null;

  const shapes = shapesOf(g.contours);
  const shapeOf = new Map<number, number>();
  shapes.forEach((shape, id) => {
    shapeOf.set(shape.outer, id);
    for (const hole of shape.holes) shapeOf.set(hole, id);
  });
  // The ink of each shape on its own, worked out once for the pairs to be
  // measured against: what matters is whether the stroke is inside *this*
  // shape, not whether it is inside the letter somewhere.
  const ink = shapes.map((shape) =>
    [shape.outer, ...shape.holes].flatMap((index) => {
      const c = g.contours[index];
      return c === undefined ? [] : [contourPolygon(c)];
    }),
  );

  const perShape = new Map<number, Meeting[]>();
  for (const meeting of meetings) {
    const id = shapeOf.get(meeting.contour);
    if (id === undefined) continue;
    const list = perShape.get(id);
    if (list === undefined) perShape.set(id, [meeting]);
    else list.push(meeting);
  }

  for (const [id, list] of perShape) {
    const polygons = ink[id] ?? [];
    for (let i = 0; i + 1 < list.length;) {
      const first = list[i]!;
      const second = list[i + 1]!;
      const a = pointOf(first);
      const b = pointOf(second);
      if (
        a !== null &&
        b !== null &&
        insidePolygons(polygons, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      ) {
        partner.set(key(first), second);
        partner.set(key(second), first);
        i += 2;
      } else {
        i += 1;
      }
    }
  }

  // A crossing left without a partner is a stretch of ink that runs to an end of
  // the stroke. Nothing closes across it, but it is still a place worth naming,
  // so it stays as a point on the outline.
  const paired = meetings.filter((m) => partner.has(key(m)));
  const marked = meetings.length - paired.length;

  // A contour with no chord of its own keeps its shape, with the points put in;
  // only the ones a chord leaves or arrives at are walked into new loops.
  const walking = new Map<number, { contour: Contour; meetings: Meeting[] }>();
  for (const [index, entry] of split) {
    const own = entry.meetings.filter((m) => partner.has(key(m)));
    if (own.length > 0) walking.set(index, { contour: entry.contour, meetings: own });
    else if (entry.meetings.length > 0) replaced.set(index, [entry.contour]);
  }

  if (walking.size === 0) {
    const glyph = replaced.size === 0 ? g : { ...g, contours: rebuilt(g.contours, replaced, []) };
    return { glyph, crossings, skipped: 0, marked, divided, chords: 0 };
  }

  const loops = walk(walking, partner, paired, key, ids);
  if (loops === null) {
    return { glyph: g, crossings, skipped: cutting.size, marked: 0, divided: 0, chords: 0 };
  }

  for (const index of walking.keys()) replaced.set(index, []);
  return {
    glyph: { ...g, contours: rebuilt(g.contours, replaced, loops) },
    crossings,
    skipped: 0,
    marked,
    divided,
    chords: paired.length / 2,
  };
}

/**
 * The glyph's contours with the changed ones swapped in and the new loops after.
 *
 * A contour that was replaced keeps the place it had, so a save does not
 * shuffle the ones the knife did not touch; the halves a cut produced have no
 * previous place and go on the end.
 */
function rebuilt(
  before: readonly Contour[],
  replaced: ReadonlyMap<number, Contour[]>,
  loops: readonly Contour[],
): Contour[] {
  const out: Contour[] = [];
  for (const [index, c] of before.entries()) {
    const instead = replaced.get(index);
    if (instead === undefined) out.push(c);
    else out.push(...instead);
  }
  out.push(...loops);
  return out;
}

/**
 * An open contour, divided everywhere the stroke crossed it.
 *
 * No parity to satisfy and no inside to close across: a path that is cut is
 * simply shorter paths. `null` where there was nothing to divide.
 */
function dividePath(c: Contour, hits: readonly StrokeCrossing[], ids: IdFactory): Contour[] | null {
  const { contour: withNodes, meetings } = splitAtCrossings(c, hits, ids, 0, false);
  if (meetings.length === 0) return null;

  const at = [...new Set(meetings.map((m) => m.index))].sort((l, r) => l - r);
  const pieces: Contour[] = [];
  let from = 0;

  for (const stop of [...at, withNodes.nodes.length - 1]) {
    if (stop <= from) continue;
    // The crossing node ends one piece and begins the next, so it is in both —
    // as its own node in each, since a node belongs to one contour.
    const nodes = withNodes.nodes.slice(from, stop + 1).map((n, i, all) => ({
      ...n,
      id: ids.node(),
      in: i === 0 ? null : n.in,
      out: i === all.length - 1 ? null : n.out,
    }));
    if (nodes.length >= 2) pieces.push(contour(pieces.length === 0 ? c.id : ids.contour(), nodes));
    from = stop;
  }

  return pieces.length < 2 ? null : pieces;
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

  // `<= count`, and the stop tested only after the first step, so that an arc
  // from a crossing back to itself is the whole ring rather than nothing. That
  // is the case where a contour was met once — going into an `o` and stopping
  // in the counter — and the arc has to come all the way round to the slit.
  for (let step = 0; step <= count; step++) {
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
    if (step > 0 && index === to) break;
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
  closed = true,
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

  // An open contour ends where its last segment ends; a closed one wraps, and
  // the node it wraps to is already the first.
  if (!closed) {
    const last = c.nodes[c.nodes.length - 1];
    if (last !== undefined) nodes.push(node(ids.node(), last.pt, { type: last.type, in: last.in }));
  }

  return { contour: contour(c.id, nodes, closed), meetings };
}
