import { type Vec2, project, tangent } from "@typewright/geometry";

import { segmentAt, segmentCubic } from "./contour.js";
import { strokeCrossings } from "./crossings.js";
import { insideGlyph } from "./direction.js";
import { type Glyph, glyphBounds } from "./glyph.js";
import type { ContourId } from "./ids.js";

/**
 * Measuring across a shape, square to the outline.
 *
 * The measurement anyone actually wants from a font editor is a stem width, and
 * a stem width is a distance along the *normal*. Dragging a straight line across
 * a round letter measures a chord instead, which is a different and larger
 * number — so for anything but an upright stem, a ruler answers the wrong
 * question. This asks the right one.
 *
 * Nothing here needs to know what is inside the glyph and what is outside. The
 * direction comes from where the cursor is relative to the outline, which is
 * both simpler and exactly what someone pointing at a stem means.
 */

export type Measurement = {
  /** Where on the outline the measurement starts. */
  readonly from: Vec2;
  /** Where it lands on the far side. */
  readonly to: Vec2;
  readonly distance: number;
  /** Direction from `from` to `to`, as a unit vector. */
  readonly normal: Vec2;
  /**
   * The segment measured from, so a caller can show which one it picked.
   *
   * `null` for a measurement that came from no single segment — the gap between
   * two letters is the distance between two different glyphs' outlines, and
   * neither of them is where the reading belongs.
   */
  readonly contourId: ContourId | null;
  readonly segmentIndex: number | null;
};

/**
 * Measure from the outline nearest the cursor, square to it, towards the cursor.
 *
 * `null` whenever there is no honest answer, and each of those cases is a real
 * one rather than a guard against nonsense:
 *
 *  - the cursor sits on the outline, so "towards the cursor" names no direction
 *  - the outline has no tangent there, which happens at a cusp or where a handle
 *    sits on its anchor
 *  - the ray leaves the glyph without meeting anything, which is what hovering
 *    outside the letter looks like
 *
 * The last is worth being deliberate about: hovering just off the edge of a stem
 * measures nothing, because the normal points away from the ink. Measurement
 * happens where there is material between you and the far side.
 */
export function measureNormal(
  g: Glyph,
  contourId: ContourId,
  segmentIndex: number,
  cursor: Vec2,
): Measurement | null {
  const c = g.contours.find((each) => each.id === contourId);
  if (c === undefined) return null;

  const segment = segmentAt(c, segmentIndex);
  if (segment === null) return null;

  const cubic = segmentCubic(segment);
  const { t, point } = project(cubic, cursor);

  const along = tangent(cubic, t);
  if (along === null) return null;

  // Square to the curve, pointing at the side the cursor is on. A cursor exactly
  // on the outline picks neither side, and either answer would be arbitrary.
  const away = { x: cursor.x - point.x, y: cursor.y - point.y };
  const side = -along.y * away.x + along.x * away.y;
  if (Math.abs(side) < 1e-9) return null;

  const sign = side > 0 ? 1 : -1;
  const normal = { x: -along.y * sign, y: along.x * sign };

  // Long enough to leave the glyph from anywhere inside it, so a ray that finds
  // nothing has genuinely found nothing rather than fallen short.
  const box = glyphBounds(g);
  if (box === null) return null;
  const reach = Math.hypot(box.maxX - box.minX, box.maxY - box.minY) + 1;

  const far = { x: point.x + normal.x * reach, y: point.y + normal.y * reach };
  const crossings = strokeCrossings(g, point, far);

  // The ray starts on the outline, so its first meeting is the place it left.
  // Anything within a whisker of the start is that, not the far side.
  const opposite = crossings.find((crossing) => crossing.u * reach > 1e-6);
  if (opposite === undefined) return null;

  return {
    from: point,
    to: opposite.point,
    distance: Math.hypot(opposite.point.x - point.x, opposite.point.y - point.y),
    normal,
    contourId,
    segmentIndex,
  };
}

/** A glyph as it sits in a line: the drawing, and where its origin is. */
export type PlacedGlyph = {
  readonly glyph: Glyph;
  readonly x: number;
};

/**
 * Measure the gap between two letters, at the height being pointed at.
 *
 * The other ruler here measures inside one letter. This is the question the
 * strip of neighbours under the canvas exists to ask and could not answer: how
 * far apart do these two actually look. Not how far apart their advance boxes
 * are — the sidebearings say that, and they say it once for the whole letter —
 * but ink to ink at one height, which is what the eye judges and which changes
 * as you move up and down a round letter.
 *
 * `null` where there is nothing to read: outside every gap, at a height where
 * one of the two letters has no ink, or between letters that have none. The
 * cursor sitting *inside* a letter is `null` too, because that is the other
 * ruler's question and answering it here would give two readings for one place.
 *
 * Components are not resolved, for the same reason the canvas does not draw a
 * neighbour's: what is measured is what is on screen.
 */
export function measureGap(placed: readonly PlacedGlyph[], at: Vec2): Measurement | null {
  const edges: { readonly left: number; readonly right: number }[] = [];
  for (const p of placed) {
    const span = inkSpanAt(p.glyph, at.y);
    if (span !== null) edges.push({ left: span.left + p.x, right: span.right + p.x });
  }
  edges.sort((l, r) => l.left - r.left);

  for (const [i, edge] of edges.entries()) {
    // Inside a letter rather than between two of them.
    if (at.x >= edge.left && at.x <= edge.right) return null;

    const next = edges[i + 1];
    if (next === undefined) continue;
    // Ink that reaches past the next letter's ink leaves no gap between them —
    // kerning can do it — and there is then nowhere to point that is not inside
    // one of the two.
    if (next.left < edge.right) continue;
    if (at.x < edge.right || at.x > next.left) continue;

    const from = { x: edge.right, y: at.y };
    const to = { x: next.left, y: at.y };
    return {
      from,
      to,
      distance: to.x - from.x,
      normal: { x: 1, y: 0 },
      contourId: null,
      segmentIndex: null,
    };
  }

  return null;
}

/**
 * How far the ink of one glyph reaches left and right at a given height.
 *
 * The outermost crossings of a horizontal line, so a letter with a counter — an
 * `o`, an `e` — reads as one span from its left edge to its right, which is what
 * the gap to the next letter is measured from. The hole in the middle is a
 * question for the other ruler.
 */
function inkSpanAt(g: Glyph, y: number): { readonly left: number; readonly right: number } | null {
  const box = glyphBounds(g);
  if (box === null || y < box.minY || y > box.maxY) return null;

  // Started and ended clear of the drawing, so a crossing is never at an end of
  // the stroke, where "did it cross" and "did it touch" are the same arithmetic.
  const reach = box.maxX - box.minX + 1;
  const crossings = strokeCrossings(g, { x: box.minX - reach, y }, { x: box.maxX + reach, y });
  if (crossings.length === 0) return null;

  let left = Infinity;
  let right = -Infinity;
  for (const crossing of crossings) {
    left = Math.min(left, crossing.point.x);
    right = Math.max(right, crossing.point.x);
  }
  return { left, right };
}

/** The measurement's angle in degrees, measured from the horizontal. */
export function measureAngle(m: Measurement): number {
  return (Math.atan2(m.normal.y, m.normal.x) * 180) / Math.PI;
}

/**
 * One stretch of a section line between two crossings of the outline.
 *
 * `ink` says whether that stretch is inside the letter. Both kinds are worth
 * reading — the stretches of ink are stems and bars, the ones between them are
 * counters and the gaps that hold a letter together — so both are measured and
 * the caller decides how loudly to say each.
 */
export type SectionSpan = {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly distance: number;
  readonly ink: boolean;
};

export type Section = {
  readonly from: Vec2;
  readonly to: Vec2;
  /** Where the line meets the outline, in the order it meets them. */
  readonly crossings: readonly Vec2[];
  readonly spans: readonly SectionSpan[];
};

/**
 * Cut a line across the glyph and measure what it passes through.
 *
 * The complement of {@link measureNormal}, which answers "how thick is this
 * stem" for one stem square to the outline. This answers the other question a
 * ruler is for: laid across a whole letter, what are all the widths in a row —
 * stem, counter, stem — which is how the rhythm of an `n` or the fit of an `o`
 * is actually judged.
 *
 * Whether a stretch is ink is asked of its midpoint rather than counted off by
 * parity from one end, so a line that starts inside the letter is read
 * correctly and a line that grazes a corner does not flip everything after it.
 */
export function sectionAcross(g: Glyph, from: Vec2, to: Vec2): Section {
  const crossings = strokeCrossings(g, from, to).map((crossing) => crossing.point);

  const spans: SectionSpan[] = [];
  for (let i = 0; i + 1 < crossings.length; i++) {
    const a = crossings[i]!;
    const b = crossings[i + 1]!;
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    spans.push({
      from: a,
      to: b,
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      ink: insideGlyph(g, middle),
    });
  }

  return { from, to, crossings, spans };
}
