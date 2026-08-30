import type { Cubic, Rect } from "@fonteditor/geometry";
import type { Glyph } from "@fonteditor/font-model";
import type { Selection, SegmentRef, ViewTransform } from "@fonteditor/view";

import type { RenderPalette } from "./palette.js";

/** A horizontal metric line: baseline, x-height, cap-height and so on. */
export type HorizontalGuide = {
  /** Position in design units. */
  readonly y: number;
  /** Drawn heavier. The baseline usually wants this; x-height usually does not. */
  readonly emphasis?: boolean;
};

/**
 * Sizes in *screen* pixels, so a control stays the same size on screen however
 * far the view is zoomed. This is the counterpart of expressing hit tolerance in
 * pixels: both are facts about screens and fingers, not about the font.
 */
export type RenderMetrics = {
  readonly outlineWidth: number;
  readonly nodeRadius: number;
  readonly handleRadius: number;
  readonly tunniPointRadius: number;
  readonly tunniLineWidth: number;
  readonly handleLineWidth: number;
  readonly haloWidth: number;
};

export const DEFAULT_METRICS: RenderMetrics = {
  outlineWidth: 2,
  nodeRadius: 5.5,
  handleRadius: 4.5,
  tunniPointRadius: 6,
  tunniLineWidth: 3,
  handleLineWidth: 1,
  haloWidth: 2,
};

export type RenderOptions = {
  /** Draw the origin and advance lines that bound the glyph's advance width. */
  readonly margins: boolean;
  /**
   * Show handles only where they are being worked on.
   *
   * A glyph's on-curve points are its skeleton and are always drawn; it is the
   * handles and their lines that turn a shape into a thicket. With this on they
   * appear for the segment under the cursor or being worked on, and for any
   * point that is selected, and stay out of the way otherwise.
   *
   * The host decides when it applies — the pen tool, for one, does not maintain
   * the awake set, so hiding handles mid-draw would blind you exactly while
   * drawing.
   */
  readonly autoHideHandles: boolean;
  /** The translucent glyph body. On by default; the decided design keeps it on. */
  readonly showFilledPreview: boolean;
  /**
   * All editing controls. Setting this false leaves guides, fill and outline —
   * the clean preview that holding space gives you.
   */
  readonly showControls: boolean;
  /** The dashed handle-extension lines meeting at `s`. A diagnostic, off by default. */
  readonly showHandleIntersection: boolean;
};

export const DEFAULT_OPTIONS: RenderOptions = {
  showFilledPreview: true,
  showControls: true,
  showHandleIntersection: false,
  margins: true,
  autoHideHandles: false,
};

/**
 * Everything one frame needs, and nothing else.
 *
 * A plain value with no methods and no hidden state, so drawing a frame is a
 * pure function of this object. Anything that changes between frames — which
 * segment is awake, what is selected, where the view is — arrives here rather
 * than being remembered by the renderer.
 *
 * Note what is absent: the cursor. Deciding which segments show their Tunni
 * controls is settled before a scene exists — `hoveredSegment` in the view
 * package answers the proximity half, and the tools layer keeps the focus half.
 */
export type Scene = {
  readonly glyph: Glyph;
  readonly view: ViewTransform;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly palette: RenderPalette;
  readonly metrics: RenderMetrics;
  readonly options: RenderOptions;
  readonly guides: readonly HorizontalGuide[];
  /**
   * Segments currently showing their Tunni controls — typically the one under
   * the cursor and the one being worked on, which are often but not always the
   * same. Duplicates are tolerated and drawn once.
   */
  readonly tunniSegments: readonly SegmentRef[];
  readonly selection: Selection;
  /** The marquee rectangle in design units, while one is being dragged. */
  readonly marquee: Rect | null;
  /**
   * The pen's rubber band: the segment that would exist if the next click landed
   * where the cursor is.
   */
  readonly penPreview: Cubic | null;
  /**
   * Glyphs shown either side of the one being edited, dimmed and untouchable.
   *
   * Spacing is meaningless in isolation — a sidebearing is only right relative
   * to whatever sits beside it — so judging one without neighbours means
   * guessing. Each carries the x offset at which to draw it, already accumulated
   * from the advances, because that sum is a spacing decision rather than a
   * drawing one.
   */
  readonly neighbours: readonly NeighbourGlyph[];
};

/** A glyph drawn for context, at a given offset, not for editing. */
export type NeighbourGlyph = {
  readonly glyph: Glyph;
  readonly x: number;
};

export type SceneInit = {
  readonly glyph: Glyph;
  readonly view: ViewTransform;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly palette: RenderPalette;
  readonly metrics?: RenderMetrics;
  readonly options?: Partial<RenderOptions>;
  readonly guides?: readonly HorizontalGuide[];
  readonly tunniSegments?: readonly SegmentRef[];
  readonly selection?: Selection;
  readonly marquee?: Rect | null;
  readonly penPreview?: Cubic | null;
  readonly neighbours?: readonly NeighbourGlyph[];
};

export function scene(init: SceneInit): Scene {
  return {
    glyph: init.glyph,
    view: init.view,
    viewport: init.viewport,
    palette: init.palette,
    metrics: init.metrics ?? DEFAULT_METRICS,
    options: { ...DEFAULT_OPTIONS, ...init.options },
    guides: init.guides ?? [],
    tunniSegments: init.tunniSegments ?? [],
    selection: init.selection ?? [],
    marquee: init.marquee ?? null,
    penPreview: init.penPreview ?? null,
    neighbours: init.neighbours ?? [],
  };
}
