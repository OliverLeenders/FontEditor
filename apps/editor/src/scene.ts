import type { FontDocument, Glyph } from "@fonteditor/font-model";
import type { NeighbourGlyph } from "@fonteditor/render";
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  type RenderPalette,
  type Scene,
  scene as buildScene,
} from "@fonteditor/render";
import { marqueeRect, penPreview, tunniSegments } from "@fonteditor/tools";

import type { StoreState } from "./store.js";

const EMPTY: Glyph = { name: "", unicodes: [], advance: 0, contours: [] };

export function palette(): RenderPalette {
  return prefersDark() ? DARK_PALETTE : LIGHT_PALETTE;
}

export function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/**
 * The glyphs to show either side, taken from the strip text.
 *
 * The strip is already the sentence you are judging the glyph in, so it is the
 * right source: no second place to type context, and no guessing. The edited
 * glyph is located by its *first* appearance, and the neighbours are the run
 * around it, offset by the advances between.
 *
 * Returns nothing when the glyph is not in the strip at all — better to show no
 * context than context from a word that does not contain the letter.
 */
export function neighboursFor(
  document: FontDocument,
  currentGlyph: string,
  text: string,
  reach = 2,
): NeighbourGlyph[] {
  const names: string[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    const found = Object.values(document.glyphs).find((g) => g.unicodes.includes(codePoint));
    if (found !== undefined) names.push(found.name);
  }

  const at = names.indexOf(currentGlyph);
  if (at < 0) return [];

  const out: NeighbourGlyph[] = [];

  // Leftwards: each step back subtracts that glyph's own advance.
  let x = 0;
  for (let i = at - 1; i >= 0 && at - i <= reach; i--) {
    const g = document.glyphs[names[i]!];
    if (g === undefined) break;
    x -= g.advance;
    out.push({ glyph: g, x });
  }

  // Rightwards: each step starts after everything before it.
  x = document.glyphs[currentGlyph]?.advance ?? 0;
  for (let i = at + 1; i < names.length && i - at <= reach; i++) {
    const g = document.glyphs[names[i]!];
    if (g === undefined) break;
    out.push({ glyph: g, x });
    x += g.advance;
  }

  return out;
}

/**
 * Whether handles are being hidden right now.
 *
 * One definition, read by both the renderer and the hit test. They must agree:
 * a handle drawn but not grabbable is maddening, and one grabbable but not
 * drawn means clicking empty canvas silently does something. Having written
 * this condition out twice once already, it lives here.
 *
 * Never while the pen is out — the pen keeps no hovered or focused segment, so
 * auto-hiding would take the handles away exactly while they are being placed.
 */
export function handlesAutoHidden(state: StoreState): boolean {
  return state.autoHideHandles && state.session.editor.activeTool === "select";
}

/**
 * Turn the store's state into a frame.
 *
 * A pure function of the state and the canvas size, which is what lets the
 * canvas redraw straight from a subscription without React being involved.
 */
export function sceneFor(
  state: StoreState,
  size: { width: number; height: number },
): Scene {
  const editor = state.session.editor;
  const glyph = editor.document.glyphs[editor.currentGlyph] ?? EMPTY;
  const { ascender, descender, xHeight, capHeight } = editor.document.info;

  return buildScene({
    glyph,
    view: editor.view,
    viewport: size,
    palette: palette(),
    guides: [
      { y: 0, emphasis: true },
      { y: xHeight },
      { y: capHeight },
      { y: ascender },
      { y: descender },
    ],
    tunniSegments: tunniSegments(editor),
    selection: editor.selection,
    marquee: marqueeRect(editor),
    penPreview: penPreview(editor),
    neighbours: state.showNeighbours
      ? neighboursFor(editor.document, editor.currentGlyph, state.stripText)
      : [],
    options: {
      showControls: !state.previewing,
      autoHideHandles: handlesAutoHidden(state),
    },
  });
}
