import type { Anchor } from "./anchor.js";
import type { Component } from "./component.js";
import type { Contour } from "./contour.js";
import { type FontDocument, updateGlyph } from "./document.js";
import type { Glyph } from "./glyph.js";
import type { Guide } from "./guide.js";
import type { ImageRef } from "./image.js";

/**
 * The other drawings of a glyph: a background, a sketch, an earlier version.
 *
 * A UFO keeps several sets of glyphs beside the one that is the font, and a
 * designer keeps things in them — the outline copied aside before it is
 * reworked, a rough shape traced over, the version before the client's notes.
 * Each is a *layer*, and a glyph's drawing in one is kept on the glyph itself,
 * beside its main drawing. That is what makes a layer follow its glyph: renamed
 * with it, deleted with it, saved in the same file, undone in the same step.
 *
 * What a layer drawing holds is what a drawing is — the outline, the
 * components, the anchors, the guides, a picture, the advance — and nothing
 * that belongs to the glyph as a whole: a glyph has one name, one set of
 * characters, one colour mark and one spacing rule, whichever of its drawings
 * is being looked at.
 *
 * The font's list of layers — their names, their order, and what their files
 * carried that nothing here reads — is on the document. A layer is in that list
 * whether or not any glyph draws in it.
 */

/** A glyph's drawing in one layer. */
export type LayerDrawing = {
  readonly advance: number;
  readonly contours: readonly Contour[];
  readonly components: readonly Component[];
  readonly anchors: readonly Anchor[];
  readonly guides: readonly Guide[];
  readonly image: ImageRef | null;
  /** What the layer's `.glif` carried that this editor cannot model. */
  readonly kept: readonly string[];
};

/** One of the font's layers other than the main drawing. */
export type LayerInfo = {
  readonly name: string;
  /** The directory it was read from, so it is written back to the same one. `null` for a new layer. */
  readonly directory: string | null;
  /** Its `layerinfo.plist` — a colour, a lib — carried unread, or `null`. */
  readonly info: string | null;
  /**
   * Glyphs only this layer draws — a `.glif` for a name the font has no glyph
   * of — carried as they were, with the name the layer's contents gave them.
   */
  readonly orphans: readonly {
    readonly name: string;
    readonly path: string;
    readonly text: string;
  }[];
};

/** The layer the UFO convention keeps a glyph's background in. */
export const BACKGROUND = "public.background";

/** A layer's name as a person reads it: the background called that, others as they are. */
export function layerLabel(name: string): string {
  return name === BACKGROUND ? "background" : name;
}

export function layerInfo(name: string): LayerInfo {
  return { name, directory: null, info: null, orphans: [] };
}

/** A glyph's main drawing, as a layer drawing. */
export function drawingOf(g: Glyph): LayerDrawing {
  return {
    advance: g.advance,
    contours: g.contours,
    components: g.components,
    anchors: g.anchors,
    guides: g.guides,
    image: g.image,
    kept: g.kept,
  };
}

/**
 * A glyph as it is drawn in a layer: its own name, characters and marks, and
 * the layer's drawing. Where the glyph draws nothing in the layer yet, an empty
 * drawing as wide as the main one, which is what drawing into it starts from.
 *
 * `null` for the main drawing, which is the glyph itself.
 */
export function inLayer(g: Glyph, layer: string | null): Glyph {
  if (layer === null) return g;
  const drawing = g.layers[layer];
  if (drawing === undefined) {
    // The same empty lists every time, so an edit that changed nothing hands
    // back what it was given and is seen to have changed nothing.
    return {
      ...g,
      contours: NONE,
      components: NONE,
      anchors: NONE,
      guides: NONE,
      image: null,
      kept: NONE,
    };
  }
  return { ...g, ...drawing };
}

const NONE: readonly never[] = Object.freeze([]);

/**
 * A glyph with an edit to how it is drawn in a layer put back.
 *
 * `edited` is what `inLayer` handed out, changed: its drawing goes into the
 * layer and everything else stays the glyph's own. Hands back the same glyph
 * where nothing changed, so an edit that did nothing is not a step.
 */
export function withLayer(g: Glyph, layer: string | null, edited: Glyph): Glyph {
  if (layer === null) return edited;
  if (sameDrawing(inLayer(g, layer), edited)) return g;
  return { ...g, layers: { ...g.layers, [layer]: drawingOf(edited) } };
}

/**
 * Apply an edit to how a glyph is drawn in a layer — or in the main drawing,
 * for `null` — and hand back the document, or `null` where the glyph is not
 * there or the edit declined. What every tool writes through.
 */
export function updateGlyphInLayer(
  document: FontDocument,
  name: string,
  layer: string | null,
  operation: (g: Glyph) => Glyph | null,
): FontDocument | null {
  if (layer === null) return updateGlyph(document, name, operation);
  return updateGlyph(document, name, (g) => {
    const edited = operation(inLayer(g, layer));
    return edited === null ? null : withLayer(g, layer, edited);
  });
}

/** Copy a glyph's main drawing into a layer, over whatever it had there. */
export function copyToLayer(g: Glyph, layer: string): Glyph {
  return { ...g, layers: { ...g.layers, [layer]: drawingOf(g) } };
}

/**
 * Trade a glyph's main drawing and its drawing in a layer.
 *
 * The drawing that was reworked in the background becomes the letter, and the
 * letter as it was goes to the background. A layer the glyph draws nothing in
 * trades as an empty drawing of the same width.
 */
export function swapWithLayer(g: Glyph, layer: string): Glyph {
  const there = inLayer(g, layer);
  return {
    ...g,
    advance: there.advance,
    contours: there.contours,
    components: there.components,
    anchors: there.anchors,
    guides: there.guides,
    image: there.image,
    kept: there.kept,
    layers: { ...g.layers, [layer]: drawingOf(g) },
  };
}

/** Take a glyph's drawing out of a layer. */
export function clearLayer(g: Glyph, layer: string): Glyph {
  if (g.layers[layer] === undefined) return g;
  const layers = { ...g.layers };
  delete layers[layer];
  return { ...g, layers };
}

/** The font with another list of layers, as read from a file or from storage. */
export function setLayers(document: FontDocument, layers: readonly LayerInfo[]): FontDocument {
  return document.layers === layers ? document : { ...document, layers };
}

/** Whether the font has a layer of this name. */
export const hasLayer = (document: FontDocument, name: string): boolean =>
  document.layers.some((l) => l.name === name);

/** Why a layer could not be added, or `null`. */
export type LayerProblem = "no-name" | "taken";

export function layerProblem(document: FontDocument, name: string): LayerProblem | null {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed === "public.default") return "no-name";
  if (hasLayer(document, trimmed)) return "taken";
  return null;
}

export function layerProblemSays(problem: LayerProblem): string {
  return problem === "no-name"
    ? "A layer needs a name."
    : "There is already a layer with that name.";
}

/** Add a layer to the font's list. The same document where it is there already. */
export function addLayer(document: FontDocument, name: string): FontDocument {
  const trimmed = name.trim();
  if (layerProblem(document, trimmed) !== null) return document;
  return { ...document, layers: [...document.layers, layerInfo(trimmed)] };
}

/** Remove a layer from the font, and every glyph's drawing in it. */
export function removeLayer(document: FontDocument, name: string): FontDocument {
  if (!hasLayer(document, name)) return document;
  const glyphs: Record<string, Glyph> = {};
  for (const [key, g] of Object.entries(document.glyphs)) glyphs[key] = clearLayer(g, name);
  return { ...document, layers: document.layers.filter((l) => l.name !== name), glyphs };
}

function sameDrawing(one: Glyph, two: Glyph): boolean {
  return (
    one.advance === two.advance &&
    one.contours === two.contours &&
    one.components === two.components &&
    one.anchors === two.anchors &&
    one.guides === two.guides &&
    one.image === two.image &&
    one.kept === two.kept
  );
}
