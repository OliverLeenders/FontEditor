import type { Vec2 } from "@typewright/geometry";

import type { Anchor } from "./anchor.js";
import type { Component } from "./component.js";
import type { Contour, Nib } from "./contour.js";
import type { FontDocument, FontInfo, PlainValue } from "./document.js";
import type { Glyph } from "./glyph.js";
import type { Guide } from "./guide.js";
import type { ImageRef } from "./image.js";
import type { Kerning } from "./kerning.js";
import type { LayerDrawing } from "./layers.js";
import { parseMetricKey } from "./metric-key-text.js";
import type { Node } from "./node.js";

/**
 * A font drawn on another em.
 *
 * The em is the unit everything else is counted in, so changing it without
 * scaling the drawing changes the size of every glyph instead: a font at 1000
 * units moved to 2000 sets at half the size. That is sometimes what is meant —
 * an em typed wrong and put right — and this is for the rest of the time, most
 * often an icon font moved to an em its grid divides: 24 pixels go into 960 or
 * 1200, not into 1000.
 *
 * Everything counted in units goes: outlines and pens, components' placement,
 * anchors, guides, advances, kerning, the font's measurements, a background
 * image, the spacing keys' numbers, the grid and the fixed width, in every
 * layer. Coordinates come out on whole units, as they went in; the grid's step
 * is left as it scales, since a step of 41.67 on 1000 is meant to come out 40 on
 * 960. Angles and proportions do not change.
 *
 * Not scaled: the feature file, which is source somebody wrote and is kept as
 * text — its numbers are theirs to change, and this says so rather than editing
 * it. See {@link FEATURES_NOT_SCALED}.
 */
export function scaledFont(document: FontDocument, unitsPerEm: number): FontDocument {
  const from = document.info.unitsPerEm;
  if (!(unitsPerEm > 0) || unitsPerEm === from) return document;
  // An em of nothing has no scale to go from; the new one is only written down.
  if (!(from > 0)) return { ...document, info: { ...document.info, unitsPerEm } };
  const k = unitsPerEm / from;
  const n = (v: number): number => Math.round(v * k);

  const glyphs: Record<string, Glyph> = {};
  for (const [name, g] of Object.entries(document.glyphs)) glyphs[name] = scaledGlyph(g, k);

  return {
    ...document,
    info: scaledInfo(document.info, unitsPerEm, k),
    glyphs,
    kerning: scaledKerning(document.kerning, k),
    guides: document.guides.map((g) => scaledGuide(g, k)),
    kept: { ...document.kept, fontInfo: scaledKeptInfo(document.kept.fontInfo, k) },
    // To a millionth of a unit, so a step of a thousand over twenty-four, scaled
    // by 0.96, is the 40 it was meant to come out as rather than a hair over.
    grid: { ...document.grid, step: Math.round(document.grid.step * k * 1e6) / 1e6 },
    fixedWidth: document.fixedWidth === null ? null : n(document.fixedWidth),
  };
}

/** What a font cannot have scaled for it, said where the scaling is offered. */
export const FEATURES_NOT_SCALED =
  "Numbers in the feature file are left as they are: positioning written there is in the old units.";

function scaledInfo(info: FontInfo, unitsPerEm: number, k: number): FontInfo {
  const n = (v: number): number => Math.round(v * k);
  const maybe = (v: number | null): number | null => (v === null ? null : n(v));
  return {
    ...info,
    unitsPerEm,
    ascender: n(info.ascender),
    descender: n(info.descender),
    xHeight: n(info.xHeight),
    capHeight: n(info.capHeight),
    openTypeHheaAscender: maybe(info.openTypeHheaAscender),
    openTypeHheaDescender: maybe(info.openTypeHheaDescender),
    openTypeHheaLineGap: maybe(info.openTypeHheaLineGap),
    openTypeOS2TypoAscender: maybe(info.openTypeOS2TypoAscender),
    openTypeOS2TypoDescender: maybe(info.openTypeOS2TypoDescender),
    openTypeOS2TypoLineGap: maybe(info.openTypeOS2TypoLineGap),
    openTypeOS2WinAscent: maybe(info.openTypeOS2WinAscent),
    openTypeOS2WinDescent: maybe(info.openTypeOS2WinDescent),
  };
}

/**
 * The `fontinfo` keys this editor carries without modelling that are counted in
 * units, so a font arriving with hinting zones or an underline keeps them where
 * they were on the letters rather than where they were on the old em.
 */
const KEPT_IN_UNITS = new Set([
  "postscriptUnderlinePosition",
  "postscriptUnderlineThickness",
  "postscriptBlueValues",
  "postscriptOtherBlues",
  "postscriptFamilyBlues",
  "postscriptFamilyOtherBlues",
  "postscriptStemSnapH",
  "postscriptStemSnapV",
  "postscriptBlueFuzz",
  "postscriptBlueShift",
  "postscriptDefaultWidthX",
  "postscriptNominalWidthX",
  "openTypeHheaCaretOffset",
  "openTypeOS2SubscriptXSize",
  "openTypeOS2SubscriptYSize",
  "openTypeOS2SubscriptXOffset",
  "openTypeOS2SubscriptYOffset",
  "openTypeOS2SuperscriptXSize",
  "openTypeOS2SuperscriptYSize",
  "openTypeOS2SuperscriptXOffset",
  "openTypeOS2SuperscriptYOffset",
  "openTypeOS2StrikeoutSize",
  "openTypeOS2StrikeoutPosition",
  "openTypeVheaVertTypoAscender",
  "openTypeVheaVertTypoDescender",
  "openTypeVheaVertTypoLineGap",
  "openTypeVheaCaretOffset",
]);

function scaledKeptInfo(
  kept: Readonly<Record<string, PlainValue>>,
  k: number,
): Readonly<Record<string, PlainValue>> {
  const out: Record<string, PlainValue> = {};
  for (const [key, value] of Object.entries(kept)) {
    out[key] = KEPT_IN_UNITS.has(key) ? scaledPlain(value, k) : value;
  }
  return out;
}

function scaledPlain(value: PlainValue, k: number): PlainValue {
  if (typeof value === "number") return Math.round(value * k);
  if (Array.isArray(value)) return value.map((v: PlainValue) => scaledPlain(v, k));
  return value;
}

function scaledKerning(kerning: Kerning, k: number): Kerning {
  const pairs: Record<string, Record<string, number>> = {};
  for (const [first, row] of Object.entries(kerning.pairs)) {
    const out: Record<string, number> = {};
    for (const [second, value] of Object.entries(row)) out[second] = Math.round(value * k);
    pairs[first] = out;
  }
  return { ...kerning, pairs };
}

function point(p: Vec2, k: number): Vec2 {
  return { x: Math.round(p.x * k), y: Math.round(p.y * k) };
}

function scaledGuide(g: Guide, k: number): Guide {
  return { ...g, pt: point(g.pt, k) };
}

function scaledAnchor(a: Anchor, k: number): Anchor {
  return { ...a, pt: point(a.pt, k) };
}

/** A component's placement scales; its own scale is a ratio, and does not. */
function scaledComponent(c: Component, k: number): Component {
  return {
    ...c,
    transform: {
      ...c.transform,
      xOffset: Math.round(c.transform.xOffset * k),
      yOffset: Math.round(c.transform.yOffset * k),
    },
  };
}

function scaledNib(nib: Nib, k: number): Nib {
  return {
    ...nib,
    width: Math.round(nib.width * k),
    ...(nib.thickness === undefined ? {} : { thickness: Math.round(nib.thickness * k) }),
  };
}

function scaledNode(node: Node, k: number): Node {
  return {
    ...node,
    pt: point(node.pt, k),
    in: node.in === null ? null : point(node.in, k),
    out: node.out === null ? null : point(node.out, k),
    ...(node.pen === undefined ? {} : { pen: scaledNib(node.pen, k) }),
    ...(node.continuous === undefined
      ? {}
      : { continuous: { ...node.continuous, size: Math.round(node.continuous.size * k) } }),
  };
}

function scaledContour(c: Contour, k: number): Contour {
  return {
    ...c,
    nodes: c.nodes.map((node) => scaledNode(node, k)),
    ...(c.nib === undefined ? {} : { nib: scaledNib(c.nib, k) }),
  };
}

/** An image is placed by a matrix from its pixels; all of it scales, the placement and the size. */
function scaledImage(image: ImageRef | null, k: number): ImageRef | null {
  if (image === null) return null;
  const t = image.transform;
  return {
    ...image,
    transform: {
      xScale: t.xScale * k,
      xyScale: t.xyScale * k,
      yxScale: t.yxScale * k,
      yScale: t.yScale * k,
      xOffset: t.xOffset * k,
      yOffset: t.yOffset * k,
    },
  };
}

function scaledDrawing(d: LayerDrawing, k: number): LayerDrawing {
  return {
    ...d,
    advance: Math.round(d.advance * k),
    contours: d.contours.map((c) => scaledContour(c, k)),
    components: d.components.map((c) => scaledComponent(c, k)),
    anchors: d.anchors.map((a) => scaledAnchor(a, k)),
    guides: d.guides.map((g) => scaledGuide(g, k)),
    image: scaledImage(d.image, k),
  };
}

/**
 * A spacing key's numbers scaled and the rest kept: `n+10` on 1000 is `n+20`
 * on 2000. A key that cannot be read is left as it was written.
 */
function scaledMetricKey(text: string, k: number): string {
  const key = parseMetricKey(text);
  if (key === null || (key.offset === 0 && key.units === null)) return text;
  const offset = Math.round(key.offset * k);
  const more = offset === 0 ? "" : offset > 0 ? `+${String(offset)}` : String(offset);
  if (key.units !== null) return `=${String(Math.round(key.units * k))}${more}`;
  return `${key.opposite ? "|" : ""}${key.glyph}${more}`;
}

function scaledGlyph(g: Glyph, k: number): Glyph {
  const layers: Record<string, LayerDrawing> = {};
  for (const [name, drawing] of Object.entries(g.layers)) layers[name] = scaledDrawing(drawing, k);
  return {
    ...g,
    advance: Math.round(g.advance * k),
    contours: g.contours.map((c) => scaledContour(c, k)),
    components: g.components.map((c) => scaledComponent(c, k)),
    anchors: g.anchors.map((a) => scaledAnchor(a, k)),
    guides: g.guides.map((guide) => scaledGuide(guide, k)),
    image: scaledImage(g.image, k),
    metricKeys: {
      left: scaledMetricKey(g.metricKeys.left, k),
      right: scaledMetricKey(g.metricKeys.right, k),
      width: scaledMetricKey(g.metricKeys.width, k),
    },
    layers,
  };
}
