import type { Rect } from "@fonteditor/geometry";

import type { Component } from "./component.js";
import { type Contour, type Segment, contourBounds, segments, unionRect } from "./contour.js";
import type { ComponentId, ContourId } from "./ids.js";

/**
 * A single glyph.
 *
 * Deliberately minimal for now: components, anchors and guides belong to phase 3
 * and are left out rather than stubbed, so nothing reads as supported when it is
 * not. Adding them is additive — no existing field changes shape.
 *
 * Coordinates are fractional throughout. TrueType wants integers on the em grid,
 * but rounding at every edit would compound through transforms and, later,
 * interpolation between masters. Rounding happens once, in the compiler, where
 * the format actually demands it.
 */
export type Glyph = {
  readonly name: string;
  readonly unicodes: readonly number[];
  /** Advance width in design units. */
  readonly advance: number;
  readonly contours: readonly Contour[];
  /**
   * Glyphs placed inside this one, by reference.
   *
   * Kept apart from `contours` rather than resolved into them, because the
   * reference is the point: correcting the `a` corrects every letter built from
   * it. Resolving happens where the outlines are needed — to draw, to measure,
   * to compile — and never in the document.
   */
  readonly components: readonly Component[];
};

export type GlyphInit = {
  readonly unicodes?: readonly number[];
  readonly advance?: number;
  readonly contours?: readonly Contour[];
  readonly components?: readonly Component[];
};

export function glyph(name: string, init: GlyphInit = {}): Glyph {
  return {
    name,
    unicodes: init.unicodes ?? [],
    advance: init.advance ?? 0,
    contours: init.contours ?? [],
    components: init.components ?? [],
  };
}

// ---------------------------------------------------------------------------
// components
// ---------------------------------------------------------------------------

export function addGlyphComponent(g: Glyph, c: Component): Glyph {
  return { ...g, components: [...g.components, c] };
}

export function removeGlyphComponent(g: Glyph, id: ComponentId): Glyph | null {
  const kept = g.components.filter((c) => c.id !== id);
  return kept.length === g.components.length ? null : { ...g, components: kept };
}

export function updateGlyphComponent(
  g: Glyph,
  id: ComponentId,
  change: (c: Component) => Component,
): Glyph | null {
  const i = g.components.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const components = g.components.slice();
  components[i] = change(components[i]!);
  return { ...g, components };
}

/** True when the glyph draws nothing of its own and is purely assembled. */
export function isComposite(g: Glyph): boolean {
  return g.contours.length === 0 && g.components.length > 0;
}

export function contourIndex(g: Glyph, id: ContourId): number {
  return g.contours.findIndex((c) => c.id === id);
}

export function contourById(g: Glyph, id: ContourId): Contour | null {
  return g.contours.find((c) => c.id === id) ?? null;
}

export function addContour(g: Glyph, c: Contour): Glyph {
  return { ...g, contours: [...g.contours, c] };
}

export function replaceContour(g: Glyph, c: Contour): Glyph | null {
  const i = contourIndex(g, c.id);
  if (i < 0) return null;
  const contours = g.contours.slice();
  contours[i] = c;
  return { ...g, contours };
}

/**
 * Apply an edit to one contour by id.
 *
 * The shape almost every tool wants: locate the contour, run a pure contour
 * operation, put the result back. Returns `null` if the contour is missing or
 * the operation declined, so a failed edit never half-applies.
 */
export function updateContour(
  g: Glyph,
  id: ContourId,
  operation: (c: Contour) => Contour | null,
): Glyph | null {
  const existing = contourById(g, id);
  if (existing === null) return null;
  const next = operation(existing);
  if (next === null) return null;
  return replaceContour(g, next);
}

export function removeContour(g: Glyph, id: ContourId): Glyph | null {
  const i = contourIndex(g, id);
  if (i < 0) return null;
  const contours = g.contours.slice();
  contours.splice(i, 1);
  return { ...g, contours };
}

export function setAdvance(g: Glyph, advance: number): Glyph {
  return { ...g, advance };
}

/** Every segment in the glyph, paired with the contour it belongs to. */
export function allSegments(g: Glyph): Array<{ contourId: ContourId; segment: Segment }> {
  const out: Array<{ contourId: ContourId; segment: Segment }> = [];
  for (const c of g.contours) {
    for (const segment of segments(c)) {
      out.push({ contourId: c.id, segment });
    }
  }
  return out;
}

export function nodeCount(g: Glyph): number {
  let total = 0;
  for (const c of g.contours) total += c.nodes.length;
  return total;
}

/** Outline bounds, ignoring sidebearings. `null` when the glyph is empty. */
export function glyphBounds(g: Glyph): Rect | null {
  let box: Rect | null = null;
  for (const c of g.contours) {
    const contourBox = contourBounds(c);
    if (contourBox !== null) box = unionRect(box, contourBox);
  }
  return box;
}
