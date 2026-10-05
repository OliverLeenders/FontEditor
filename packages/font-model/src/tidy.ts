import type { Vec2 } from "@typewright/geometry";

import type { Contour } from "./contour.js";
import { type FontDocument, type GlyphName, putGlyph } from "./document.js";
import type { Glyph } from "./glyph.js";
import type { IdFactory } from "./ids.js";
import type { Node } from "./node.js";
import { nestedAsWound } from "./overlap.js";
import { withoutEmptySegments } from "./simplify.js";

/**
 * A font read from a font file, put right where it was read in less well.
 *
 * Reading a TrueType or OpenType font has got better at two things, and a font
 * read in before it did keeps what it was given. This is what brings one up to
 * what it would be read as now, without reading it again — which would lose
 * whatever has been drawn in it since.
 *
 * Two things, and they are kept apart because one of them is safe and the other
 * is a judgment:
 *
 * - **Tidying.** A point on top of the point before it, with a segment of no
 *   length between them, and a handle on its own point. Neither draws anything.
 *   A TrueType outline read in had one of the first after nearly every curve —
 *   twenty to a glyph in an icon font. Taking them out changes no shape.
 *
 * - **Filling as the file did.** A font file fills its outlines by which way
 *   they wind, and this editor by how they nest; a glyph built of overlapping
 *   pieces is a different picture under each. Putting that right reads each
 *   contour's direction as the file meant it — which is right for a glyph as it
 *   came in, and wrong for one that has been redrawn here since, where the
 *   directions are whatever they happened to be. So it is asked for by name,
 *   and says what it would change first.
 */

/** How near two places are to be one place: an arithmetic hair, far below a unit. */
const SAME_PLACE = 1e-9;

const samePlace = (a: Vec2, b: Vec2): boolean =>
  Math.abs(a.x - b.x) <= SAME_PLACE && Math.abs(a.y - b.y) <= SAME_PLACE;

/** A node without a handle that sits on its own point; the same node where it has none. */
function withoutEmptyHandles(n: Node): Node {
  const into = n.in !== null && samePlace(n.in, n.pt) ? null : n.in;
  const out = n.out !== null && samePlace(n.out, n.pt) ? null : n.out;
  if (into === n.in && out === n.out) return n;
  // A point with a handle on one side only is a corner, whatever it was.
  return { ...n, in: into, out, type: into === null || out === null ? "corner" : n.type };
}

/** One contour tidied; the same contour where there was nothing to tidy. */
export function tidyContour(c: Contour): Contour {
  // A stroke's skeleton is the path a pen goes along, with settings at its
  // points: two of them at one place may be meant.
  if (c.nib !== undefined) return c;

  const joined = withoutEmptySegments(c) ?? c;
  const nodes = joined.nodes.map(withoutEmptyHandles);
  if (joined === c && nodes.every((n, i) => n === c.nodes[i])) return c;
  return { ...joined, nodes };
}

/** One glyph's outlines tidied; the same glyph where there was nothing to tidy. */
export function tidyGlyph(g: Glyph): Glyph {
  const contours = g.contours.map(tidyContour);
  return contours.every((c, i) => c === g.contours[i]) ? g : { ...g, contours };
}

/** How many of a font's glyphs {@link tidyFont} would change. */
export function untidyGlyphs(d: FontDocument): number {
  let count = 0;
  for (const name of d.glyphOrder) {
    const g = d.glyphs[name];
    if (g !== undefined && tidyGlyph(g) !== g) count += 1;
  }
  return count;
}

/** Every glyph of a font tidied. No shape changes; the same font where none needed it. */
export function tidyFont(d: FontDocument): FontDocument {
  let next = d;
  for (const name of d.glyphOrder) {
    const g = next.glyphs[name];
    if (g === undefined) continue;
    const tidied = tidyGlyph(g);
    if (tidied !== g) next = putGlyph(next, tidied);
  }
  return next;
}

/** What filling a font as its file did would do, worked out and not yet done. */
export type FillAsWound = {
  /** The font with those glyphs redrawn: the same font where there are none. */
  readonly document: FontDocument;
  /** The glyphs it redraws, in the font's order. */
  readonly redrawn: readonly GlyphName[];
  /** The glyphs the two rules fill differently that could not be redrawn, and are left. */
  readonly left: readonly GlyphName[];
};

/**
 * The glyphs of a font that nesting fills differently from how their contours
 * wind, redrawn so that it fills them the same.
 *
 * Worked out whole and handed back, to be shown before it is taken: this is the
 * one of the two that can change what a glyph looks like, and for a glyph drawn
 * here it changes it for the worse.
 */
export function fillAsWound(d: FontDocument, ids: IdFactory): FillAsWound {
  let document = d;
  const redrawn: GlyphName[] = [];
  const left: GlyphName[] = [];
  for (const name of d.glyphOrder) {
    const g = d.glyphs[name];
    if (g === undefined || g.contours.length < 2) continue;
    const drawn = nestedAsWound(g, ids);
    if (drawn === g) continue;
    if (drawn === null) left.push(name);
    else {
      document = putGlyph(document, drawn);
      redrawn.push(name);
    }
  }
  return { document, redrawn, left };
}
