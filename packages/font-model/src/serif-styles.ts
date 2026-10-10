import type { Contour } from "./contour.js";
import type { FontDocument } from "./document.js";
import type { Glyph } from "./glyph.js";
import {
  type EndSerif,
  type SerifStyle,
  restyled,
  sameSerif,
  serifNumbers,
  soundSerif,
} from "./serif.js";

/**
 * The font's serif styles, and the ends of strokes that have them.
 *
 * An end carries its serif's numbers itself, so what a stroke draws depends on
 * nothing but the stroke — which is what lets a stroke's ink be remembered by
 * the stroke. A style is therefore changed in two places at once, here: in the
 * font's list, and on every end in every glyph and layer that has it. A number
 * that was set on an end itself is that end's own and is left.
 */

/** The style of this name, or `null`. */
export function serifStyleNamed(document: FontDocument, name: string): SerifStyle | null {
  return document.serifs.find((style) => style.name === name) ?? null;
}

/** A name for a new style that no style has yet: the one asked for, or it with a number. */
export function freeSerifStyleName(document: FontDocument, wanted: string): string {
  const base = wanted.trim() === "" ? "Serif" : wanted.trim();
  if (serifStyleNamed(document, base) === null) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${String(n)}`;
    if (serifStyleNamed(document, name) === null) return name;
  }
}

/** The font with one more serif style, or `null` where the name is taken or is nothing. */
export function addedSerifStyle(document: FontDocument, style: SerifStyle): FontDocument | null {
  const name = style.name.trim();
  if (name === "" || serifStyleNamed(document, name) !== null) return null;
  return {
    ...document,
    serifs: [...document.serifs, { name, ...soundSerif(serifNumbers(style)) }],
  };
}

/**
 * The font with a serif style changed — its numbers, its name, or both — and
 * every end that has it changed with it. `null` where there is no such style,
 * or the new name is nothing or another style's. The same font back where
 * nothing is different.
 */
export function changedSerifStyle(
  document: FontDocument,
  name: string,
  next: SerifStyle,
): FontDocument | null {
  const now = serifStyleNamed(document, name);
  const renamed = next.name.trim();
  if (now === null || renamed === "") return null;
  if (renamed !== name && serifStyleNamed(document, renamed) !== null) return null;
  const style: SerifStyle = { name: renamed, ...soundSerif(serifNumbers(next)) };
  if (renamed === name && sameSerif(now, style)) return document;
  return {
    ...withEndSerifs(document, (serif) => (serif.style === name ? restyled(serif, style) : serif)),
    serifs: document.serifs.map((each) => (each.name === name ? style : each)),
  };
}

/**
 * The font without a serif style. The ends that had it keep the serif they
 * have, as numbers of their own: taking a name away is not taking the serifs
 * off the letters.
 */
export function removedSerifStyle(document: FontDocument, name: string): FontDocument {
  if (serifStyleNamed(document, name) === null) return document;
  return {
    ...withEndSerifs(document, (serif) => (serif.style === name ? serifNumbers(serif) : serif)),
    serifs: document.serifs.filter((style) => style.name !== name),
  };
}

/**
 * A master with a serif style renamed as another master renamed it: the style
 * in its list, with the numbers it has here, and every end that has it. A
 * master that has no such style in its list still has its ends renamed — a
 * master that is a layer of another has no list of its own. Left as it is
 * where the new name is already a style here.
 */
export function carriedSerifRename(document: FontDocument, from: string, to: string): FontDocument {
  if (from === to || serifStyleNamed(document, to) !== null) return document;
  const next = withEndSerifs(document, (serif) =>
    serif.style === from ? { ...serif, style: to } : serif,
  );
  if (serifStyleNamed(document, from) === null) return next;
  return {
    ...next,
    serifs: document.serifs.map((style) => (style.name === from ? { ...style, name: to } : style)),
  };
}

/**
 * A master with a serif style taken out as another master took it out: out of
 * its list, and off the ends that have it, which keep their serifs as numbers
 * of their own — in a master with no list of its own too.
 */
export function carriedSerifRemoval(document: FontDocument, name: string): FontDocument {
  const next = withEndSerifs(document, (serif) =>
    serif.style === name ? serifNumbers(serif) : serif,
  );
  if (serifStyleNamed(document, name) === null) return next;
  return { ...next, serifs: document.serifs.filter((style) => style.name !== name) };
}

/** How many ends of strokes, in every glyph and layer, have a style. */
export function serifStyleUses(document: FontDocument, name: string): number {
  let uses = 0;
  const count = (contours: readonly Contour[]): void => {
    for (const c of contours) {
      for (const n of c.nodes) if (n.end?.serif?.style === name) uses++;
    }
  };
  for (const g of Object.values(document.glyphs)) {
    count(g.contours);
    for (const drawing of Object.values(g.layers)) count(drawing.contours);
  }
  return uses;
}

/**
 * The font with every end's serif put through `change`. A glyph nothing
 * changes in is the same glyph, and a font nothing changes in the same font.
 */
function withEndSerifs(
  document: FontDocument,
  change: (serif: EndSerif) => EndSerif,
): FontDocument {
  const contours = (all: readonly Contour[]): readonly Contour[] => {
    const out = all.map((c) => {
      const nodes = c.nodes.map((n) => {
        const serif = n.end?.serif;
        if (n.end === undefined || serif === undefined) return n;
        const next = change(serif);
        return next === serif ? n : { ...n, end: { ...n.end, serif: next } };
      });
      return nodes.some((n, i) => n !== c.nodes[i]) ? { ...c, nodes } : c;
    });
    return out.some((c, i) => c !== all[i]) ? out : all;
  };

  let any = false;
  const glyphs: Record<string, Glyph> = {};
  for (const [name, g] of Object.entries(document.glyphs)) {
    const main = contours(g.contours);
    let layersChanged = false;
    const layers: Glyph["layers"] = {};
    for (const [layer, drawing] of Object.entries(g.layers)) {
      const drawn = contours(drawing.contours);
      if (drawn !== drawing.contours) layersChanged = true;
      (layers as Record<string, Glyph["layers"][string]>)[layer] =
        drawn === drawing.contours ? drawing : { ...drawing, contours: drawn };
    }
    if (main === g.contours && !layersChanged) {
      glyphs[name] = g;
      continue;
    }
    any = true;
    glyphs[name] = { ...g, contours: main, ...(layersChanged ? { layers } : {}) };
  }
  return any ? { ...document, glyphs } : document;
}
