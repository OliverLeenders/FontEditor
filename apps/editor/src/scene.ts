import type { Vec2 } from "@fonteditor/geometry";
import {
  type ComponentSource,
  type Contour,
  type FontDocument,
  type Glyph,
  filledContours,
  glyphBounds,
  glyphForCodePoint,
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
  selectionBox,
  shownMeasurement,
  penPreview,
  shapePreview,
  shownSection,
  snapHold,
  tunniSegments,
} from "@fonteditor/tools";

import { isDarkNow } from "./scheme.js";
import type { StoreState } from "./store/index.js";

const EMPTY: Glyph = {
  name: "",
  unicodes: [],
  advance: 0,
  contours: [],
  components: [],
  anchors: [],
};

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
  // The model's own lookup rather than a scan written out again here: it is
  // indexed, and this runs once per character on every frame.
  const names: string[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    const found = glyphForCodePoint(document, codePoint);
    if (found !== null) names.push(found.name);
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
 * The neighbour the point falls in, if any.
 *
 * By the advance rather than by the drawing: the band is what the glyph
 * occupies in the line, and a comma should be as easy to reach as an `m`. Bands
 * do not overlap, so the first match is the answer.
 *
 * Says nothing about the glyph being edited — whether *that* has a claim on the
 * point is the caller's question, and it is the one that has to be asked first,
 * because a glyph may overshoot well outside its own sidebearings and what is
 * drawn there is still the thing being drawn.
 */
export function neighbourAt(neighbours: readonly NeighbourGlyph[], p: Vec2): NeighbourGlyph | null {
  for (const neighbour of neighbours) {
    if (p.x >= neighbour.x && p.x <= neighbour.x + neighbour.glyph.advance) return neighbour;
  }
  return null;
}

/**
 * Whether a point is within the drawing of the glyph being edited.
 *
 * Its ink rather than its advance, and the box round that ink rather than the
 * ink itself: an overshoot, a swash or an accent leaning over the next letter is
 * still this glyph, and a double-click there means what it means everywhere
 * else on it.
 */
export function withinGlyph(glyph: Glyph, p: Vec2): boolean {
  const box = glyphBounds(glyph);
  if (box === null) return false;
  return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
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
    // What the exported font will fill, rather than the contours exactly as
    // drawn: the compiler corrects their directions, and a preview that showed
    // a notch the font will not have would be lying in the other direction.
    filled: filledContours(glyph),
    // The one being worked on is resolved apart from the others, so the
    // renderer can outline it without having to know which contour came
    // from which reference.
    componentOutlines: resolvedComponents(glyph, source, (c) => c.id !== editor.selectedComponent),
    selectedComponentOutlines:
      editor.selectedComponent === null
        ? []
        : resolvedComponents(glyph, source, (c) => c.id === editor.selectedComponent),
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
    hoveredAnchor: editor.hoveredAnchor,
    selectedAnchor: editor.selectedAnchor,
    tunniSegments: tunniSegments(editor),
    selection: editor.selection,
    marquee: marqueeRect(editor),
    // Only under the select tool. The box moves what is selected, and every
    // other tool is in the middle of making something rather than moving it.
    transformBox: editor.activeTool === "select" ? selectionBox(editor) : null,
    penPreview: penPreview(editor),
    shapePreview: shapePreview(editor, outlineIds),
    knifeStroke: knifeStroke(editor),
    measurement: measurementFor(state),
    section: sectionFor(state),
    neighbours: state.showNeighbours
      ? neighboursFor(editor.document, editor.currentGlyph, state.stripText)
      : [],
    options: {
      showControls: !state.previewing,
      autoHideHandles: handlesAutoHidden(state),
      showAnchors: state.showAnchors,
    },
  });
}

/** What some of a glyph's components draw, resolved for one frame. */
function resolvedComponents(
  glyph: Glyph,
  source: ComponentSource,
  wanted: (c: Glyph["components"][number]) => boolean,
): Contour[] {
  const chosen = glyph.components.filter(wanted);
  if (chosen.length === 0) return [];
  return resolveGlyphComponents(source, glyph.name, chosen, outlineIds);
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
 * The ruler to draw, if the section tool is the one in hand.
 *
 * Only then, for the reason the measurement is only drawn under the measure
 * tool: a line left on the canvas by a tool you have put down is a reading about
 * a shape you may since have changed.
 */
function sectionFor(state: StoreState): Scene["section"] {
  const editor = state.session.editor;
  if (editor.activeTool !== "section") return null;
  return shownSection(editor);
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
