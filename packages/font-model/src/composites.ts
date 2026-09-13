import { type Vec2, applyAffine } from "@typewright/geometry";

import { isMarkAnchor, pairedName } from "./anchor.js";
import { type Component, component, placedComponent } from "./component.js";
import { type FontDocument, glyphForCodePoint, putGlyph } from "./document.js";
import { type Glyph, NO_METRIC_KEYS, glyph } from "./glyph.js";
import type { IdFactory } from "./ids.js";
import { glyphNameForCodePoint } from "./names.js";

/**
 * Accented letters, built from the letter and the accent.
 *
 * A Latin font needs a few hundred of these, and every one of them is a letter
 * that already exists with a mark that already exists put on top of it. Drawing
 * them is a waste of an afternoon and, worse, a few hundred copies that stop
 * agreeing with the `e` the moment the `e` is corrected. So each is a composite:
 * components by reference, placed by their anchors.
 *
 * Which parts is not a table kept here. Unicode already says it — `é`
 * decomposes canonically to `e` and U+0301 — and the font already says which of
 * its glyphs is which character. The recipe is the one read through the other,
 * which covers every accented character Unicode defines and nothing the font
 * cannot actually build.
 */

/** A glyph by name, or `null`: all that placing components needs of a font. */
export type GlyphLookup = (name: string) => Glyph | null;

/**
 * A glyph's components, each put where its anchors say.
 *
 * Walked in order, with a running record of which anchors are on offer and
 * where. The glyph's own anchors start it; each component, once placed, adds
 * its own base-side anchors — moved to where it now sits — and a later one of
 * the same name takes the place of the earlier. That is what stacks marks: an
 * `ǘ` is `u`, then a dieresis landing on the `u`'s `top`, then an acute landing
 * on the *dieresis's* `top`, which is above it.
 *
 * A component with no mark anchor pairing with anything on offer is left where
 * it is. That is the letter itself, which has nothing to attach by, and an
 * accent whose base has no anchor for it, which is reported rather than guessed
 * at.
 */
export function attachComponents(
  owner: Glyph,
  glyphOf: GlyphLookup,
): { readonly components: readonly Component[]; readonly unplaced: readonly string[] } {
  const offered = new Map<string, Vec2>();
  for (const a of owner.anchors) if (!isMarkAnchor(a)) offered.set(a.name, a.pt);

  const unplaced: string[] = [];
  const components = owner.components.map((c) => {
    const placed = glyphOf(c.base);
    if (placed === null) return c;

    let next = c;
    const at = landing(placed, c, offered);
    if (at === null) {
      // Only a mark can fail to land. A letter carries no `_` anchor, and not
      // attaching is simply what it does.
      if (placed.anchors.some(isMarkAnchor)) unplaced.push(c.base);
    } else if (at.x !== c.transform.xOffset || at.y !== c.transform.yOffset) {
      next = placedComponent(c, at.x, at.y);
    }

    for (const a of placed.anchors) {
      if (!isMarkAnchor(a)) offered.set(a.name, applyAffine(next.transform, a.pt));
    }
    return next;
  });

  // The same array back when nothing moved, which is how a sweep over the font
  // tells the glyphs it would change from the ones it would not.
  const changed = components.some((c, i) => c !== owner.components[i]);
  return { components: changed ? components : owner.components, unplaced };
}

/** Where a component lands on the anchors on offer, or `null`. */
function landing(
  accent: Glyph,
  placed: Component,
  offered: ReadonlyMap<string, Vec2>,
): Vec2 | null {
  for (const mark of accent.anchors) {
    const wanted = pairedName(mark);
    if (wanted === null) continue;
    const on = offered.get(wanted);
    if (on === undefined) continue;

    // Where the accent's own anchor falls under the transform, offset aside —
    // the offset is the answer being worked out.
    const carried = applyAffine({ ...placed.transform, xOffset: 0, yOffset: 0 }, mark.pt);
    return { x: on.x - carried.x, y: on.y - carried.y };
  }
  return null;
}

/** `ı` and `ȷ`: the letters an accent goes on in place of `i` and `j`. */
const DOTLESS: Readonly<Record<number, number>> = { 0x69: 0x131, 0x6a: 0x237 };

/**
 * The glyphs a character is built from, letter first, or `null`.
 *
 * `null` where Unicode does not decompose the character, and where the font has
 * not got every part — or has one it has not drawn yet, since a composite of
 * empty glyphs is an empty glyph with a promise in it.
 *
 * One rule beyond the decomposition, because the decomposition is wrong about
 * it for type: `í` is `i` and an acute, but the acute goes on a dotless `ı`, or
 * the letter gets a dot and an accent. So an accent that attaches by `_top` is
 * put on the dotless letter wherever the font has one.
 */
export function compositeParts(document: FontDocument, codePoint: number): string[] | null {
  const decomposed = [...String.fromCodePoint(codePoint).normalize("NFD")].map(
    (character) => character.codePointAt(0) ?? 0,
  );
  if (decomposed.length < 2) return null;

  const parts: Glyph[] = [];
  for (const part of decomposed) {
    const found = glyphForCodePoint(document, part);
    if (found === null || !drawn(found)) return null;
    parts.push(found);
  }

  const base = decomposed[0]!;
  const dotless = DOTLESS[base];
  const first = parts[1];
  if (dotless !== undefined && first?.anchors.some((a) => a.name === "_top") === true) {
    const replacement = glyphForCodePoint(document, dotless);
    if (replacement !== null && drawn(replacement)) parts[0] = replacement;
  }

  return parts.map((p) => p.name);
}

const drawn = (g: Glyph): boolean => g.contours.length > 0 || g.components.length > 0;

/** One accented glyph the font can build, and where it would go. */
export type CompositeBuild = {
  readonly codePoint: number;
  /** An existing glyph with nothing in it, to build into; `null` to make one. */
  readonly into: string | null;
  readonly name: string;
  /** Letter first, then its marks in the order they stack. */
  readonly parts: readonly string[];
};

/** One the font has the parts for, but cannot place. */
export type CompositeProblem = {
  readonly codePoint: number;
  readonly name: string;
  /** The marks with nothing to land on. */
  readonly unplaced: readonly string[];
};

/**
 * Which of these characters the font could build as composites now.
 *
 * Not ones that are already drawn: a composite is a starting point, and
 * replacing somebody's hand-drawn `é` with one would be throwing their work
 * away. An *empty* glyph for the character is built into, though — which is what
 * the "add the missing glyphs" button leaves behind, and the natural thing to do
 * next.
 *
 * The ones whose accent has no anchor to land on are kept apart, so they can be
 * named instead of built: an acute sitting at the origin of every letter it was
 * meant for is worse than no acute.
 */
export function compositePlan(
  document: FontDocument,
  codePoints: readonly number[],
): {
  readonly buildable: readonly CompositeBuild[];
  readonly problems: readonly CompositeProblem[];
} {
  const glyphOf: GlyphLookup = (name) => document.glyphs[name] ?? null;
  const buildable: CompositeBuild[] = [];
  const problems: CompositeProblem[] = [];

  for (const codePoint of codePoints) {
    const existing = glyphForCodePoint(document, codePoint);
    if (existing !== null && drawn(existing)) continue;

    const parts = compositeParts(document, codePoint);
    if (parts === null) continue;

    const name = existing?.name ?? glyphNameForCodePoint(codePoint);
    // Placed once here with throwaway ids, to know whether it can be.
    const trial = glyph(name, {
      anchors: existing?.anchors ?? [],
      components: parts.map((part, i) => component(`trial${String(i)}`, part)),
    });
    const { unplaced } = attachComponents(trial, glyphOf);

    if (unplaced.length === 0)
      buildable.push({ codePoint, into: existing?.name ?? null, name, parts });
    else problems.push({ codePoint, name, unplaced });
  }

  return { buildable, problems };
}

/**
 * Build one composite into the document.
 *
 * Spaced from its letter by a width key rather than by a copied number, so a
 * change to the `e`'s advance reaches the `é` — which is the whole reason for it
 * to be a composite.
 */
export function buildComposite(
  document: FontDocument,
  build: CompositeBuild,
  ids: IdFactory,
): FontDocument {
  const glyphOf: GlyphLookup = (name) => document.glyphs[name] ?? null;
  const base = glyphOf(build.parts[0] ?? "");
  if (base === null) return document;

  const existing = build.into === null ? null : glyphOf(build.into);
  const draft: Glyph = {
    ...(existing ?? glyph(build.name, { unicodes: [build.codePoint] })),
    advance: base.advance,
    components: build.parts.map((part) => component(ids.component(), part)),
    metricKeys: { ...(existing?.metricKeys ?? NO_METRIC_KEYS), width: base.name },
  };

  return putGlyph(document, { ...draft, components: attachComponents(draft, glyphOf).components });
}
