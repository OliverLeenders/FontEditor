import type { Vec2 } from "@typewright/geometry";

import type { AnchorId } from "./ids.js";

/**
 * A named place in a glyph, for putting another glyph on.
 *
 * The convention every font tool shares: a base letter carries `top`, an accent
 * carries `_top`, and a composite built from the two lands the accent by making
 * the pair coincide. Move the `top` of every letter once and every accent on
 * every one of them follows — which is the whole reason to place accents this
 * way rather than by typing an offset per composite.
 *
 * A name, not an id, is what the matching goes by: an accent and the letters it
 * sits on are separate glyphs that have never heard of each other, and the
 * agreement between them is the word. The id is for this editor — so a selected
 * anchor survives being renamed, and a rename survives being undone.
 *
 * Anchors are also where mark-to-base positioning comes from when a font is
 * compiled. Nothing here compiles them yet; they are stored, drawn, and written
 * to the UFO, which is where the rest of the world keeps them.
 */
export type Anchor = {
  readonly id: AnchorId;
  /** `top`, `bottom`, `_top` on an accent. Empty is allowed but means nothing. */
  readonly name: string;
  readonly pt: Vec2;
};

export function anchor(id: AnchorId, name: string, pt: Vec2): Anchor {
  return { id, name, pt };
}

export function movedAnchor(a: Anchor, dx: number, dy: number): Anchor {
  if (dx === 0 && dy === 0) return a;
  return { ...a, pt: { x: a.pt.x + dx, y: a.pt.y + dy } };
}

export function renamedAnchor(a: Anchor, name: string): Anchor {
  return a.name === name ? a : { ...a, name };
}

/**
 * Whether an anchor is the one an accent attaches *by*, rather than one a base
 * offers.
 *
 * The underscore is the convention, and it is the only thing that tells the two
 * apart: `top` on an `a` is where an accent goes, `_top` on an `acute` is the
 * part of the accent that lands there.
 */
export function isMarkAnchor(a: Anchor): boolean {
  return a.name.startsWith("_");
}

/**
 * The part of a ligature an anchor is on, where its name says one.
 *
 * A ligature is several letters in one glyph, and an accent typed after the
 * second of them belongs over the second. So a ligature offers a place for
 * each part: `top_1` over the first, `top_2` over the second — the name the
 * accents attach by, and which part, counted from one. That is the convention
 * the sources of other tools keep, and it is all that says a glyph is a
 * ligature as far as its anchors go.
 *
 * Only the spelling is read here. Whether `top` is a name anything attaches
 * by is for whoever asks to know.
 */
export function ligaturePart(
  name: string,
): { readonly stem: string; readonly part: number } | null {
  const found = /^([^_].*)_([1-9][0-9]*)$/.exec(name);
  if (found === null) return null;
  return { stem: found[1]!, part: Number(found[2]) };
}

/** The base-side name an accent's mark anchor pairs with, or `null`. */
export function pairedName(a: Anchor): string | null {
  return isMarkAnchor(a) ? a.name.slice(1) : null;
}
