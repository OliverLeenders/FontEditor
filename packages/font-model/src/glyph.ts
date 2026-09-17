import type { Rect } from "@typewright/geometry";

import { type Anchor, movedAnchor, renamedAnchor } from "./anchor.js";
import type { Guide } from "./guide.js";
import type { ImageRef } from "./image.js";
import type { Component } from "./component.js";
import { type Contour, type Segment, contourBounds, segments, unionRect } from "./contour.js";
import type { AnchorId, ComponentId, ContourId, GuideId } from "./ids.js";
import type { LayerDrawing } from "./layers.js";

/**
 * A single glyph.
 *
 * Guides are still left out rather than stubbed, so nothing reads as supported
 * when it is not. Adding them is additive — no existing field changes shape.
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
  /**
   * Named places other glyphs attach to. See {@link Anchor}.
   *
   * Beside the outline rather than in it: an anchor is not part of the shape and
   * must not be drawn, transformed, or exported as though it were. It moves when
   * it is moved.
   */
  readonly anchors: readonly Anchor[];
  /**
   * Lines to draw against, belonging to this letter.
   *
   * The font's guides say what the typeface has decided; these say what this
   * letter has — where its diagonal wants to sit, how far its bowl overshoots.
   * Drawn and snapped to, never exported into an outline.
   */
  readonly guides: readonly Guide[];
  /**
   * A picture to trace from, and where it sits behind this letter.
   *
   * One, as the format allows one. The file it names belongs to the font, so a
   * scanned alphabet is a single image with a different transform per glyph.
   */
  readonly image: ImageRef | null;
  /**
   * What the glyph's own file carried that this editor cannot model.
   *
   * Guidelines, a note, an image, a `lib` — each one an element of the `.glif`
   * this glyph was read from, kept as the XML it was written as. The model does
   * not read any of it and must not: it is kept so that saving the font back
   * over somebody's source does not quietly take these out of it.
   *
   * Empty for a glyph drawn here, which has nothing to preserve.
   */
  readonly kept: readonly string[];
  /**
   * Where this glyph's spacing comes from, where it is another glyph's.
   *
   * Empty for nearly every glyph, which is spaced on its own. See
   * `metric-keys.ts` for what the three mean and when they are followed.
   */
  readonly metricKeys: MetricKeys;
  /**
   * The colour a designer marked this glyph with, as the UFO writes it: `"r,g,b,a"`,
   * each from 0 to 1. `null` for none. A flag for the designer — "done", "look at
   * this again" — and nothing the compiled font carries. See `mark-color.ts`.
   */
  readonly markColor: string | null;
  /**
   * How the glyph is drawn in the font's other layers, by layer name: a
   * background, a sketch, an earlier version. See `layers.ts`. Empty for a
   * glyph drawn only once, which is nearly every glyph.
   */
  readonly layers: Readonly<Record<string, LayerDrawing>>;
};

/**
 * Where a glyph's spacing comes from, where it is another glyph's.
 *
 * Three of them, because there are three things to say: `left` and `right` take
 * a sidebearing from another glyph, which is what spacing a lower case is made
 * of — `o` from `c`, `ü` from `u` — and `width` takes the whole advance, which
 * is what a tabular figure wants.
 *
 * Empty means "its own", which is what nearly every glyph says. The key is a
 * glyph *name*, as a component's base and a kerning group's members are: names
 * are the only thing one part of a font source has to refer to another by.
 *
 * The type is here because the field is; following the keys is in
 * `metric-keys.ts`, which needs the whole document to do it.
 */
export type MetricKeys = {
  readonly left: string;
  readonly right: string;
  readonly width: string;
};

export const NO_METRIC_KEYS: MetricKeys = { left: "", right: "", width: "" };

/** Whether a glyph says anything about where its spacing comes from. */
export function hasMetricKeys(keys: MetricKeys): boolean {
  return keys.left !== "" || keys.right !== "" || keys.width !== "";
}

export type GlyphInit = {
  readonly unicodes?: readonly number[];
  readonly advance?: number;
  readonly contours?: readonly Contour[];
  readonly components?: readonly Component[];
  readonly anchors?: readonly Anchor[];
  readonly guides?: readonly Guide[];
  readonly image?: ImageRef | null;
  readonly kept?: readonly string[];
  readonly metricKeys?: MetricKeys;
  readonly markColor?: string | null;
  readonly layers?: Readonly<Record<string, LayerDrawing>>;
};

export function glyph(name: string, init: GlyphInit = {}): Glyph {
  return {
    name,
    unicodes: init.unicodes ?? [],
    advance: init.advance ?? 0,
    contours: init.contours ?? [],
    components: init.components ?? [],
    anchors: init.anchors ?? [],
    guides: init.guides ?? [],
    image: init.image ?? null,
    kept: init.kept ?? [],
    metricKeys: init.metricKeys ?? NO_METRIC_KEYS,
    markColor: init.markColor ?? null,
    layers: init.layers ?? {},
  };
}

// ---------------------------------------------------------------------------
// anchors
// ---------------------------------------------------------------------------

export function anchorById(g: Glyph, id: AnchorId): Anchor | null {
  return g.anchors.find((a) => a.id === id) ?? null;
}

/** The anchor going by a name, which is how another glyph finds one. */
export function anchorNamed(g: Glyph, name: string): Anchor | null {
  return g.anchors.find((a) => a.name === name) ?? null;
}

export function addAnchor(g: Glyph, a: Anchor): Glyph {
  return { ...g, anchors: [...g.anchors, a] };
}

export function removeAnchor(g: Glyph, id: AnchorId): Glyph | null {
  const kept = g.anchors.filter((a) => a.id !== id);
  return kept.length === g.anchors.length ? null : { ...g, anchors: kept };
}

function updateAnchor(g: Glyph, id: AnchorId, change: (a: Anchor) => Anchor): Glyph | null {
  const i = g.anchors.findIndex((a) => a.id === id);
  if (i < 0) return null;
  const next = change(g.anchors[i]!);
  if (next === g.anchors[i]) return g;
  const anchors = g.anchors.slice();
  anchors[i] = next;
  return { ...g, anchors };
}

export function moveAnchorBy(g: Glyph, id: AnchorId, dx: number, dy: number): Glyph | null {
  return updateAnchor(g, id, (a) => movedAnchor(a, dx, dy));
}

export function moveAnchorTo(g: Glyph, id: AnchorId, pt: { x: number; y: number }): Glyph | null {
  return updateAnchor(g, id, (a) =>
    a.pt.x === pt.x && a.pt.y === pt.y ? a : { ...a, pt: { x: pt.x, y: pt.y } },
  );
}

/** Put a picture behind this glyph, or take the one that is there away. */
export function setGlyphImage(g: Glyph, image: ImageRef | null): Glyph {
  return g.image === image ? g : { ...g, image };
}

// ---------------------------------------------------------------------------
// guides
// ---------------------------------------------------------------------------

/**
 * The glyph's own guides.
 *
 * Kept beside the outline, exactly as anchors are, and for the same reason: a
 * guide is not part of the shape and must never be drawn, transformed or
 * exported as though it were. It moves when it is moved.
 */
export function addGuide(g: Glyph, guide: Guide): Glyph {
  return { ...g, guides: [...g.guides, guide] };
}

export function removeGuide(g: Glyph, id: GuideId): Glyph | null {
  const kept = g.guides.filter((x) => x.id !== id);
  return kept.length === g.guides.length ? null : { ...g, guides: kept };
}

export function guideNamed(g: Glyph, id: GuideId): Guide | null {
  return g.guides.find((x) => x.id === id) ?? null;
}

export function updateGuide(g: Glyph, id: GuideId, change: (x: Guide) => Guide): Glyph | null {
  const i = g.guides.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const next = change(g.guides[i]!);
  if (next === g.guides[i]) return g;
  const guides = g.guides.slice();
  guides[i] = next;
  return { ...g, guides };
}

/**
 * Rename an anchor, unless the name is already taken in this glyph.
 *
 * Two anchors called `top` would make "the top of this letter" a question with
 * two answers, and every glyph built on it would get whichever came first.
 */
export function renameAnchor(g: Glyph, id: AnchorId, name: string): Glyph | null {
  const existing = anchorNamed(g, name);
  if (existing !== null && existing.id !== id) return null;
  return updateAnchor(g, id, (a) => renamedAnchor(a, name));
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

/**
 * The same glyph with its components drawn into it as contours.
 *
 * The one operation that gives up the reference on purpose: after this the shape
 * is the glyph's own, and correcting the letter it came from will not correct
 * this any more. That is exactly what it is for — a composite that has to be
 * departed from, an accent nudged for one letter only, a font going somewhere
 * that cannot follow references.
 *
 * Returns the glyph unchanged when it has no components, so a caller can tell
 * whether anything happened by comparing references.
 */
export function decomposedGlyph(g: Glyph, resolve: (g: Glyph) => readonly Contour[]): Glyph {
  if (g.components.length === 0) return g;
  return { ...g, contours: [...g.contours, ...resolve(g)], components: [] };
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
