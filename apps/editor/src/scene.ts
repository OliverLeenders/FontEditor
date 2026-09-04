import {
  type ComponentSource,
  type FontDocument,
  type Glyph,
  metricLines,
  randomIds,
  resolveGlyphComponents,
} from "@fonteditor/font-model";
import type { NeighbourGlyph, SnapGuide } from "@fonteditor/render";
import {
  DARK_PALETTE,
  DEFAULT_METRICS,
  LIGHT_PALETTE,
  type RenderPalette,
  type Scene,
  scene as buildScene,
} from "@fonteditor/render";
import {
  type EditorState,
  knifeStroke,
  marqueeRect,
  shownMeasurement,
  penPreview,
  shapePreview,
  snapHold,
  tunniSegments,
} from "@fonteditor/tools";

import { isDarkNow } from "./scheme.js";
import type { StoreState } from "./store.js";

const EMPTY: Glyph = { name: "", unicodes: [], advance: 0, contours: [], components: [] };

/** Resolved component outlines are throwaway; their ids never leave the frame. */
const outlineIds = randomIds();

export function palette(): RenderPalette {
  return isDarkNow() ? DARK_PALETTE : LIGHT_PALETTE;
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
export function sceneFor(state: StoreState, size: { width: number; height: number }): Scene {
  const editor = state.session.editor;
  const glyph = editor.document.glyphs[editor.currentGlyph] ?? EMPTY;

  const source: ComponentSource = { glyphOf: (name) => editor.document.glyphs[name] ?? null };

  return buildScene({
    glyph,
    componentOutlines:
      glyph.components.length === 0
        ? []
        : resolveGlyphComponents(source, glyph.name, glyph.components, outlineIds),
    view: editor.view,
    viewport: size,
    palette: palette(),
    // The same list a drag snaps to. Drawn and snapped must not part company:
    // a line you can catch on but cannot see is indistinguishable from a bug.
    // Everything else keeps the renderer's own sizes; only the stroke is a
    // preference, so only the stroke is overridden.
    metrics: { ...DEFAULT_METRICS, outlineWidth: state.outlineWidth },
    // The names come with the lines; the renderer writes them at the edge.
    guides: metricLines(editor.document.info).map((line) => ({
      y: line.y,
      // Spread rather than assigned: an absent `emphasis` and one set to
      // `undefined` are different types here, and only the first is a guide
      // that simply is not emphasised.
      ...(line.emphasis === true ? { emphasis: true } : {}),
      label: line.name,
    })),
    snapGuides: snapGuidesFor(editor),
    tunniSegments: tunniSegments(editor),
    selection: editor.selection,
    marquee: marqueeRect(editor),
    penPreview: penPreview(editor),
    shapePreview: shapePreview(editor, outlineIds),
    knifeStroke: knifeStroke(editor),
    measurement: measurementFor(state),
    neighbours: state.showNeighbours
      ? neighboursFor(editor.document, editor.currentGlyph, state.stripText)
      : [],
    options: {
      showControls: !state.previewing,
      autoHideHandles: handlesAutoHidden(state),
    },
  });
}

/**
 * The lines the drag in progress is caught on, as the renderer wants them.
 *
 * One per axis at most, which is the whole of it: a drag catches on one line
 * horizontally and one vertically, and drawing every candidate it could have
 * caught would be the noise the candidate set exists to avoid.
 */
function snapGuidesFor(editor: EditorState): SnapGuide[] {
  const hold = snapHold(editor);
  const guides: SnapGuide[] = [];
  if (hold.x !== null) guides.push({ axis: "x", at: hold.x.at, from: hold.x.from });
  if (hold.y !== null) guides.push({ axis: "y", at: hold.y.at, from: hold.y.from });
  return guides;
}

/**
 * The measurement to draw, and whether it was pinned.
 *
 * Only while the measure tool is active. A reading left on the canvas by a tool
 * you have put down is a number about a shape you may since have changed.
 */
function measurementFor(state: StoreState): Scene["measurement"] {
  const editor = state.session.editor;
  if (editor.activeTool !== "measure") return null;

  const m = shownMeasurement(editor);
  if (m === null) return null;
  return { from: m.from, to: m.to, distance: m.distance, pinned: editor.measure !== null };
}
