import type { Vec2 } from "@typewright/geometry";

import type { Anchor } from "./anchor.js";
import type { Component } from "./component.js";
import { glyphCompatible } from "./compatible.js";
import type { Contour } from "./contour.js";
import type { Axis, Location } from "./designspace.js";
import type { FontDocument, GlyphName } from "./document.js";
import { fontDocument } from "./document.js";
import type { Glyph } from "./glyph.js";
import { glyph as makeGlyph } from "./glyph.js";
import type { Node } from "./node.js";
import { weightsAmong } from "./variation.js";

/**
 * Working a drawing out between the masters.
 *
 * Arithmetic on corresponding points and nothing more: the first point of the
 * first contour of every master, weighted and added. Which is exactly why the
 * compatibility check exists — nothing here can tell whether the points it is
 * adding describe the same part of the same letter, and the arithmetic is just
 * as happy to average a serif with a bowl.
 *
 * So an instance is refused where the masters disagree, rather than drawn
 * wrongly. A letter that cannot be worked out is a letter to go and fix, and a
 * spike in a preview that nobody quite believes is worse than a gap.
 */

/** A glyph worked out between its masters, or `null` where they disagree. */
export function interpolateGlyph(
  glyphs: readonly (Glyph | null)[],
  weights: readonly number[],
): Glyph | null {
  const present: Glyph[] = [];
  const its: number[] = [];

  for (const [i, g] of glyphs.entries()) {
    const weight = weights[i] ?? 0;
    // A master that counts for nothing here need not even have the glyph: at
    // the light end of an axis the bold has no say, and a glyph it happens to
    // be missing is not a reason to refuse the light one.
    if (weight === 0) continue;
    if (g === null) return null;
    present.push(g);
    its.push(weight);
  }

  const first = present[0];
  if (first === undefined) return null;

  // Compared against the first that counts, which is enough: compatibility is
  // transitive through a common shape, and every master here has a say.
  for (const g of present.slice(1)) {
    if (!glyphCompatible(first.name, first, g)) return null;
  }

  return makeGlyph(first.name, {
    unicodes: [...first.unicodes],
    advance: mix(
      present.map((g) => g.advance),
      its,
    ),
    contours: first.contours.map((c, i) =>
      mixContour(
        c,
        present.map((g) => g.contours[i]),
        its,
      ),
    ),
    components: first.components.map((c, i) =>
      mixComponent(
        c,
        present.map((g) => g.components[i]),
        its,
      ),
    ),
    anchors: mixAnchors(present, its),
    guides: [...first.guides],
    image: first.image,
    kept: [...first.kept],
  });
}

/**
 * A whole font, worked out at a location.
 *
 * Glyphs that cannot be interpolated are left out rather than drawn wrongly,
 * and named, so that a caller can say which ones and why instead of showing an
 * instance that is quietly missing letters.
 */
export function interpolateFont(
  axes: readonly Axis[],
  locations: readonly Location[],
  sources: readonly FontDocument[],
  at: Location,
  /** Which masters draw only some glyphs. Absent where none do. */
  sparse: readonly boolean[] = [],
): { document: FontDocument; refused: GlyphName[] } {
  const base = sources.find((_, i) => sparse[i] !== true);
  if (base === undefined) {
    return { document: fontDocument(), refused: [] };
  }

  const glyphs: Glyph[] = [];
  const refused: GlyphName[] = [];
  // Most glyphs are in every master, so most glyphs share one set of weights;
  // worked out once per set of masters rather than once per glyph.
  const known = new Map<string, number[]>();

  for (const name of base.glyphOrder) {
    const present = glyphPresence(sources, sparse, name);
    const key = present.map((p) => (p ? "1" : "0")).join("");
    let weights = known.get(key);
    if (weights === undefined) {
      weights = weightsAmong(axes, locations, present, at);
      known.set(key, weights);
    }

    const worked = interpolateGlyph(
      sources.map((s) => s.glyphs[name] ?? null),
      weights,
    );
    if (worked === null) refused.push(name);
    else glyphs.push(worked);
  }

  const weights = weightsAmong(
    axes,
    locations,
    sources.map((_, i) => sparse[i] !== true),
    at,
  );

  // The information, features and kerning of the master nearest the location:
  // none of it interpolates in any way this editor can act on, and the answer
  // has to come from somewhere real.
  const nearest = sources[indexOfLargest(weights)] ?? base;
  const document = { ...nearest, ...fontDocument(glyphs, nearest.info) };
  return {
    document: { ...document, kerning: nearest.kerning, features: nearest.features },
    refused,
  };
}

/**
 * Which masters take part in working out one glyph.
 *
 * Every whole master, and a sparse one only where it draws the glyph. A whole
 * master without it is still counted, so that the glyph is refused rather than
 * quietly worked out from the others: missing from a whole master is a mistake,
 * where missing from a sparse one is the point of it.
 */
export function glyphPresence(
  sources: readonly (FontDocument | null)[],
  sparse: readonly boolean[],
  name: GlyphName,
): boolean[] {
  return sources.map((s, i) => sparse[i] !== true || s?.glyphs[name] !== undefined);
}

/** One contour, point by point. */
function mixContour(
  base: Contour,
  others: readonly (Contour | undefined)[],
  weights: readonly number[],
): Contour {
  return {
    ...base,
    nodes: base.nodes.map((n, i) =>
      mixNode(
        n,
        others.map((c) => c?.nodes[i]),
        weights,
      ),
    ),
  };
}

function mixNode(
  base: Node,
  others: readonly (Node | undefined)[],
  weights: readonly number[],
): Node {
  return {
    ...base,
    pt: mixPoint(
      others.map((n) => n?.pt),
      weights,
      base.pt,
    ),
    // A handle that is absent is absent in every master — the compatibility
    // check refuses anything else — so the base decides whether there is one.
    in:
      base.in === null
        ? null
        : mixPoint(
            others.map((n) => n?.in ?? null),
            weights,
            base.in,
          ),
    out:
      base.out === null
        ? null
        : mixPoint(
            others.map((n) => n?.out ?? null),
            weights,
            base.out,
          ),
  };
}

/**
 * A component, which interpolates as a placement rather than as a shape.
 *
 * The glyph it names is the same in every master — the compatibility check
 * insists — and what moves is where it is put, which is the whole point of
 * building a letter out of others: correct the `a` and every letter that uses
 * it follows, at every weight.
 */
function mixComponent(
  base: Component,
  others: readonly (Component | undefined)[],
  weights: readonly number[],
): Component {
  const at = (read: (c: Component) => number): number =>
    mix(
      others.map((c) => (c === undefined ? null : read(c))),
      weights,
      read(base),
    );

  return {
    ...base,
    transform: {
      xScale: at((c) => c.transform.xScale),
      xyScale: at((c) => c.transform.xyScale),
      yxScale: at((c) => c.transform.yxScale),
      yScale: at((c) => c.transform.yScale),
      xOffset: at((c) => c.transform.xOffset),
      yOffset: at((c) => c.transform.yOffset),
    },
  };
}

/**
 * The anchors, by name.
 *
 * By name rather than by position in the list, because an anchor is not part of
 * the outline and the compatibility check says nothing about them: a master
 * with an extra one is a perfectly interpolatable master. An anchor missing
 * from any master that counts is left out — there is nothing to work out a
 * place from.
 */
function mixAnchors(glyphs: readonly Glyph[], weights: readonly number[]): Anchor[] {
  const first = glyphs[0];
  if (first === undefined) return [];

  const out: Anchor[] = [];
  for (const a of first.anchors) {
    const found = glyphs.map((g) => g.anchors.find((x) => x.name === a.name) ?? null);
    if (found.some((x) => x === null)) continue;
    out.push({
      ...a,
      pt: mixPoint(
        found.map((x) => x?.pt ?? null),
        weights,
        a.pt,
      ),
    });
  }
  return out;
}

const mixPoint = (
  points: readonly (Vec2 | null | undefined)[],
  weights: readonly number[],
  fallback: Vec2,
): Vec2 => ({
  x: mix(
    points.map((p) => p?.x ?? null),
    weights,
    fallback.x,
  ),
  y: mix(
    points.map((p) => p?.y ?? null),
    weights,
    fallback.y,
  ),
});

/**
 * A weighted sum, treating a missing value as the base.
 *
 * The weights come from the variation model and add up to one, so this is an
 * average rather than a sum however far outside the masters the location is.
 */
function mix(
  values: readonly (number | null | undefined)[],
  weights: readonly number[],
  fallback = 0,
): number {
  let total = 0;
  for (const [i, value] of values.entries()) total += (value ?? fallback) * (weights[i] ?? 0);
  return total;
}

function indexOfLargest(weights: readonly number[]): number {
  let best = 0;
  for (const [i, weight] of weights.entries()) {
    if (Math.abs(weight) > Math.abs(weights[best] ?? 0)) best = i;
  }
  return best;
}
