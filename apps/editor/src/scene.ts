import type { Glyph } from "@fonteditor/font-model";
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
    options: { showControls: !state.previewing },
  });
}
