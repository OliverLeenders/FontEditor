import { type Vec2, toQuadratics, toQuadraticsTogether } from "@typewright/geometry";
import type { Contour, Glyph } from "@typewright/font-model";
import { segmentCubic, segments } from "@typewright/font-model";

import { Bytes } from "./bytes.js";

/**
 * `glyf` and `loca`: outlines the TrueType way.
 *
 * Quadratic where CFF is cubic, and a point list rather than a program: a
 * contour is its points in order, each flagged as on the curve or off it, and
 * the curve between two on-curve points bends towards the off-curve one between
 * them.
 *
 * The saving the format allows and this takes is the *implied* on-curve point.
 * Two off-curve points in a row imply an on-curve point at their midpoint, so a
 * run of quadratics that meets end to end — which is what one converted cubic
 * is — writes one point per curve instead of two whenever the joint happens to
 * sit at the midpoint. It very often does, because that is where a smooth join
 * puts it.
 */

export type GlyfResult = {
  readonly glyf: Uint8Array;
  readonly loca: Uint8Array;
  /** Which `loca` format was used: 0 for short, 1 for long. `head` must agree. */
  readonly longLoca: number;
  /** What `maxp` has to declare, which is the worst of every glyph. */
  readonly maxPoints: number;
  readonly maxContours: number;
  /**
   * Each glyph's leftmost point as written, `null` for one with no outline.
   *
   * What `hmtx` has to say each left sidebearing is: a TrueType rasteriser puts
   * the outline where the sidebearing says, not where its points are.
   */
  readonly xMins: readonly (number | null)[];
};

/** Round to whole units, which is the only thing this format can hold. */
const whole = (n: number): number => Math.round(n);

/**
 * Every glyph, as one table and the index into it.
 *
 * In the order they are given, which must be the font's glyph order: `loca` is
 * addressed by glyph id and nothing here can look a name up.
 */
export function glyfTable(
  glyphs: readonly Glyph[],
  /**
   * The points to write, where the caller has already worked them out.
   *
   * A variable font needs every master converted to the same points, which is
   * a question about all the masters at once and cannot be answered here — see
   * {@link compatiblePoints}. Given them, this writes what it is told rather
   * than converting again and disagreeing with `gvar` about what it wrote.
   */
  precomputed?: readonly (Drawn | undefined)[],
): GlyfResult {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [0];

  let maxPoints = 0;
  let maxContours = 0;
  let at = 0;
  const xMins: (number | null)[] = [];

  for (const [index, glyph] of glyphs.entries()) {
    const drawn = precomputed?.[index] ?? pointsOf(glyph);
    const data = drawn.contours.length === 0 ? new Uint8Array() : simpleGlyph(drawn);
    xMins.push(
      drawn.contours.length === 0
        ? null
        : Math.min(...drawn.contours.flat().map((p) => whole(p.pt.x))),
    );

    maxPoints = Math.max(
      maxPoints,
      drawn.contours.reduce((n, c) => n + c.length, 0),
    );
    maxContours = Math.max(maxContours, drawn.contours.length);

    parts.push(data);
    // Every glyph starts on a two-byte boundary, which is what the short form
    // of `loca` needs in order to be able to name the offset at all.
    at += data.length + (data.length % 2);
    offsets.push(at);
  }

  const glyf = new Bytes();
  for (const part of parts) {
    glyf.bytes(part);
    if (part.length % 2 !== 0) glyf.u8(0);
  }

  // The short form holds offsets in units of two bytes, so it reaches twice as
  // far as its sixteen bits suggest — and past that the long form is the only
  // way to say where a glyph is.
  const longLoca = at > 0x1fffe ? 1 : 0;
  const loca = new Bytes();
  for (const offset of offsets) {
    if (longLoca === 1) loca.u32(offset);
    else loca.u16(offset / 2);
  }

  return { glyf: glyf.done(), loca: loca.done(), longLoca, maxPoints, maxContours, xMins };
}

/** A glyph as contours of points, each on the curve or off it. */
/** One point of an outline, and whether the curve passes through it. */
export type OutlinePoint = { readonly pt: Vec2; readonly on: boolean };

export type Drawn = {
  readonly contours: readonly (readonly OutlinePoint[])[];
};

/**
 * One glyph's outline, converted and flattened into points.
 *
 * Each segment becomes one or more quadratics; a straight one becomes a single
 * on-curve point, which is what a line is in this format.
 */
function pointsOf(glyph: Glyph): Drawn {
  const contours: OutlinePoint[][] = [];

  for (const contour of glyph.contours) {
    if (!contour.closed || contour.nodes.length < 2) continue;

    const points = contourPoints(contour);
    if (points.length > 0) contours.push(points);
  }

  return { contours };
}

function contourPoints(contour: Contour): OutlinePoint[] {
  const start = contour.nodes[0]?.pt;
  if (start === undefined) return [];

  const out: OutlinePoint[] = [{ pt: start, on: true }];

  for (const segment of segments(contour)) {
    if (segment.kind === "line") {
      out.push({ pt: segmentCubic(segment).b, on: true });
      continue;
    }

    const run = toQuadratics(segmentCubic(segment));
    for (const quadratic of run) {
      out.push({ pt: quadratic.q, on: false });
      out.push({ pt: quadratic.b, on: true });
    }
  }

  // The contour closes on its own start, so the point the last segment ended on
  // is the one it began with and is written once.
  if (out.length > 1) out.pop();
  return implied(out);
}

/**
 * Drop the on-curve points the format can work out for itself.
 *
 * An on-curve point exactly between two off-curve neighbours is implied: a
 * reader puts it back. Leaving it out is a saving of about a fifth of the
 * points in a curved glyph, and it costs nothing — the outline is identical
 * because the point was the midpoint by definition.
 */
function implied(points: readonly OutlinePoint[]): OutlinePoint[] {
  const keep = keptPoints(points);
  return points.filter((_, i) => keep[i] === true);
}

/**
 * Which points survive, as a mask.
 *
 * Separated from the filtering because a variable font has to make this
 * decision for every master at once: whether a joint lands exactly on the
 * midpoint depends on the coordinates, so one master can imply a point that
 * another spells out — and two masters with different numbers of points have no
 * deltas between them. The masks are combined and the same points kept in all.
 */
export function keptPoints(points: readonly OutlinePoint[]): boolean[] {
  return points.map((point, i) => {
    const before = points[(i - 1 + points.length) % points.length];
    const after = points[(i + 1) % points.length];

    return !(
      point.on &&
      before !== undefined &&
      after !== undefined &&
      !before.on &&
      !after.on &&
      // Rounded first: the file holds whole units, and a point that is the
      // midpoint only before rounding is not the midpoint a reader works out.
      whole(point.pt.x) === whole((before.pt.x + after.pt.x) / 2) &&
      whole(point.pt.y) === whole((before.pt.y + after.pt.y) / 2)
    );
  });
}

/**
 * One glyph as drawn in every master, converted to the same points.
 *
 * The whole of what a variable TrueType font needs and a static one does not.
 * A delta is the difference between two points, so every master must produce
 * the same points in the same order — and three separate things here decide how
 * many points there are, each of which can answer differently for a Light than
 * for a Black:
 *
 *  - **How many quadratics a cubic becomes.** Settled by converting the masters
 *    together, at the piece count the most demanding of them needs.
 *  - **Whether a segment is a line.** A line is one point and a curve is more,
 *    so a segment drawn straight in one master and bent in another is converted
 *    as a curve in both.
 *  - **Whether an on-curve point is implied.** Decided by whether a joint lands
 *    exactly on a midpoint, which is a fact about coordinates. The masks are
 *    combined, so a point is dropped only where every master would have.
 *
 * `null` where the masters do not correspond at all — a different number of
 * contours, or of segments in one. That is a glyph the caller has to write from
 * the default master alone, which is what the compatibility check is for.
 */
export function compatiblePoints(masters: readonly Glyph[]): Drawn[] | null {
  const lists = masters.map((g) => g.contours.filter((c) => c.closed && c.nodes.length >= 2));
  const first = lists[0];
  if (first === undefined) return null;
  if (lists.some((l) => l.length !== first.length)) return null;

  const out: OutlinePoint[][][] = masters.map(() => []);

  for (let ci = 0; ci < first.length; ci++) {
    const here = lists.map((l) => l[ci]!);
    const runs = here.map((c) => segments(c));
    const count = runs[0]!.length;
    if (runs.some((r) => r.length !== count)) return null;

    const points: OutlinePoint[][] = here.map((c) => [{ pt: c.nodes[0]!.pt, on: true }]);

    for (let si = 0; si < count; si++) {
      const straight = runs.every((r) => r[si]!.kind === "line");
      if (straight) {
        for (const [m, r] of runs.entries())
          points[m]!.push({ pt: segmentCubic(r[si]!).b, on: true });
        continue;
      }

      const together = toQuadraticsTogether(runs.map((r) => segmentCubic(r[si]!)));
      if (together === null) return null;
      for (const [m, run] of together.entries()) {
        for (const q of run) {
          points[m]!.push({ pt: q.q, on: false });
          points[m]!.push({ pt: q.b, on: true });
        }
      }
    }

    // The contour closes on its own start, so the last segment's end is the
    // point it began with and is written once.
    for (const list of points) if (list.length > 1) list.pop();

    const masks = points.map(keptPoints);
    const keep = masks[0]!.map((_, i) => masks.every((mask) => mask[i] === true));
    for (const [m, list] of points.entries()) {
      out[m]!.push(list.filter((_, i) => keep[i] === true));
    }
  }

  return out.map((contours) => ({ contours: contours.filter((c) => c.length > 0) }));
}

/** One simple glyph: its bounds, where its contours end, and its points. */
function simpleGlyph(drawn: Drawn): Uint8Array {
  const out = new Bytes();
  const all = drawn.contours.flat();

  const xs = all.map((p) => whole(p.pt.x));
  const ys = all.map((p) => whole(p.pt.y));

  out.i16(drawn.contours.length);
  out.i16(Math.min(...xs));
  out.i16(Math.min(...ys));
  out.i16(Math.max(...xs));
  out.i16(Math.max(...ys));

  let end = -1;
  for (const contour of drawn.contours) {
    end += contour.length;
    out.u16(end);
  }
  out.u16(0); // no hinting instructions

  // Flags and coordinates, each coordinate written as the step from the last.
  // The format has a short form for a step that fits in a byte and a flag that
  // says a step is zero, and both are worth taking: most steps in a letter are
  // small and a great many are zero.
  const flags: number[] = [];
  const dxs: number[] = [];
  const dys: number[] = [];

  let x = 0;
  let y = 0;
  for (const point of all) {
    const px = whole(point.pt.x);
    const py = whole(point.pt.y);
    const dx = px - x;
    const dy = py - y;
    x = px;
    y = py;

    let flag = point.on ? 1 : 0;
    if (dx === 0)
      flag |= 0x10; // x is the same as the last
    else if (dx >= -255 && dx <= 255) {
      flag |= 0x02;
      if (dx > 0) flag |= 0x10;
    }
    if (dy === 0) flag |= 0x20;
    else if (dy >= -255 && dy <= 255) {
      flag |= 0x04;
      if (dy > 0) flag |= 0x20;
    }

    flags.push(flag);
    dxs.push(dx);
    dys.push(dy);
  }

  for (const flag of flags) out.u8(flag);

  for (const [i, dx] of dxs.entries()) {
    const flag = flags[i] ?? 0;
    if ((flag & 0x02) !== 0) out.u8(Math.abs(dx));
    else if ((flag & 0x10) === 0) out.i16(dx);
  }
  for (const [i, dy] of dys.entries()) {
    const flag = flags[i] ?? 0;
    if ((flag & 0x04) !== 0) out.u8(Math.abs(dy));
    else if ((flag & 0x20) === 0) out.i16(dy);
  }

  return out.done();
}
