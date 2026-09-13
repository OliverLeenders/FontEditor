import type { Affine, Cubic, Rect, Vec2 } from "@typewright/geometry";
import type { AnchorId, Contour, Glyph, Guide, GuideId } from "@typewright/font-model";
import type { BoxFrame, Comb, Selection, SegmentRef, ViewTransform } from "@typewright/view";

import type { RenderPalette } from "./palette.js";

/** A horizontal metric line: baseline, x-height, cap-height and so on. */
/**
 * A guide as the canvas needs it: the line, and where it came from.
 *
 * The scope is carried because it is the one thing about a guide that changes
 * how it is drawn — a font's guide appears in every glyph and is a heavier
 * commitment than one belonging to the letter in front of you.
 */
/** A decoded picture, where it goes, and how strongly it shows through. */
export type SceneImage = {
  /**
   * Whatever the canvas will draw — an `ImageBitmap` in a browser.
   *
   * Unknown here on purpose: this package is tested in Node, where that type
   * does not exist, and the only thing drawing asks of it is that the canvas
   * accepts it.
   */
  readonly bitmap: unknown;
  /** Its size in its own pixels, which the transform is written against. */
  readonly width: number;
  readonly height: number;
  /** Image pixels to design units. */
  readonly transform: Affine;
  /** 0 to 1. A tracing you cannot see through is a tracing you draw over. */
  readonly opacity: number;
};

export type SceneGuide = {
  readonly guide: Guide;
  readonly scope: "font" | "glyph";
};

export type MetricLine = {
  /** Position in design units. */
  readonly y: number;
  /** Drawn heavier. The baseline usually wants this; x-height usually does not. */
  readonly emphasis?: boolean;
  /**
   * What the line is, written at the edge of the canvas.
   *
   * Optional because a guide can be a bare rule — but a font's own lines all
   * have names, and four unlabelled rules across a glyph are four rules you have
   * to work out from where they sit.
   */
  readonly label?: string;
};

/**
 * A line a drag is currently caught on.
 *
 * `from` is the point that produced it, and `null` for a line the font itself
 * defines — the baseline, the advance. Those already span the canvas and are
 * already drawn, so there is nothing to point at: the guide over them says
 * "this one is live" and that is all it needs to say.
 */
export type SnapGuide = {
  readonly axis: "x" | "y";
  /** Position in design units, on that axis. */
  readonly at: number;
  readonly from: Vec2 | null;
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
  /** The anchors of the glyph being edited. */
  readonly showAnchors: boolean;
  /** The curvature comb along the outline. Off by default: it is an instrument. */
  readonly showCurvature: boolean;
};

export const DEFAULT_OPTIONS: RenderOptions = {
  showFilledPreview: true,
  showControls: true,
  showHandleIntersection: false,
  showAnchors: true,
  showCurvature: false,
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
  readonly metricLines: readonly MetricLine[];
  /**
   * The lines the designer put there: the font's and this glyph's together.
   *
   * Flattened into one list on the way in, because drawing does not care which
   * scope a line came from — only what it is called and whether it is the one
   * being dragged.
   */
  /**
   * The picture behind the glyph, decoded and placed.
   *
   * The bitmap is passed in rather than fetched: decoding is asynchronous and
   * belongs to whoever owns the images, and a renderer that could wait for one
   * would be a renderer that sometimes draws a frame late.
   */
  readonly image: SceneImage | null;
  /**
   * A weight nobody drew, worked out between the masters.
   *
   * Outlines rather than a glyph, because that is all drawing needs and because
   * an instance is not something anything else may pick up, select or edit: it
   * is a reading of the design at a place, and the points on the canvas belong
   * to the master in front of you.
   */
  readonly instance: readonly Contour[];
  readonly guides: readonly SceneGuide[];
  /** The guide under the pointer, and the one selected, by id. */
  readonly hoveredGuide: GuideId | null;
  readonly selectedGuide: GuideId | null;
  /** Lines the drag in progress is caught on. Empty when nothing is caught. */
  readonly snapGuides: readonly SnapGuide[];
  /**
   * The curvature comb, one entry per contour, each hair carrying how long to
   * draw it.
   *
   * Built where the view transform is known, since the hairs are spaced in
   * screen pixels and their length is normalised across the whole glyph — see
   * `combFor` in the view package.
   */
  readonly comb: readonly Comb[];
  /**
   * The anchor the pointer is over, and the one being worked on.
   *
   * The name is written out only for the hovered one. A glyph carries two or
   * three anchors and they sit where accents go — over the letter, under it —
   * which is exactly where a permanent label would cover the drawing.
   */
  readonly hoveredAnchor: AnchorId | null;
  readonly selectedAnchor: AnchorId | null;
  /**
   * The outlines of the component being worked on, drawn apart from the rest.
   *
   * Kept beside `componentOutlines` rather than marked within it: what is
   * selected is the reference, and the renderer is handed shapes rather than
   * references. Splitting them at the source is simpler than teaching the
   * drawing code which contour belongs to which component.
   */
  readonly selectedComponentOutlines: readonly Contour[];
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
   * The box round the selection, in design units, when there is one to show.
   *
   * Already stood off from the selection by whoever worked it out: how far is a
   * question about pixels, and this scene is handed answers rather than asked to
   * work them out. It carries the angle it is held at, so a turned selection has
   * a box that lies along it rather than an upright one shrugging round it.
   */
  readonly transformBox: BoxFrame | null;
  /**
   * The glyph's own contours as the fill sees them, directions corrected.
   *
   * A rasteriser fills one path by the non-zero winding rule, so two contours
   * running opposite ways subtract where they overlap — and which way a contour
   * runs is an accident of the order its points were placed. The compiler puts
   * that right on the way into a font; this is the same list, so what is drawn
   * here is what the exported font will draw.
   *
   * Handed in rather than worked out per frame: it costs a containment test
   * between every pair of contours, and the answer only changes when the glyph
   * does.
   */
  readonly filled: readonly Contour[];
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
  /**
   * Outlines the glyph's components draw, already resolved and transformed.
   *
   * Resolved before the frame rather than here: following references, composing
   * transforms and refusing to loop is the model's work, and the renderer stays
   * a pure function of what it is handed. They are drawn but never editable —
   * the way to change one is to change the glyph it comes from.
   */
  readonly componentOutlines: readonly Contour[];
  /**
   * The shape a rectangle or ellipse drag would make, before it exists.
   *
   * A contour rather than a rectangle, because an ellipse is not one and because
   * the preview and the commit must be built by the same code — otherwise the
   * shape you let go of is not the shape you were shown.
   */
  readonly shapePreview: Contour | null;
  /** The knife's stroke while it is being drawn, in design units. */
  readonly knifeStroke: readonly [Vec2, Vec2] | null;
  /**
   * The measurement on show, if any.
   *
   * Carried as two points and a number rather than as something to work out
   * here: the drawing and the status bar have to be showing one measurement, and
   * the surest way is for there to be only one.
   */
  /**
   * The ruler laid across the glyph, and what it passes through.
   *
   * Spans rather than a line: what makes this worth drawing is the numbers, and
   * which stretches are ink is a question about the outline that the renderer
   * has no business asking twice.
   */
  readonly section: {
    readonly from: Vec2;
    readonly to: Vec2;
    readonly crossings: readonly Vec2[];
    /** Everything the line stops at — edges and guides — with the angle it meets each at. */
    readonly stops: readonly {
      readonly point: Vec2;
      readonly kind: "outline" | "guide";
      readonly angle: number | null;
    }[];
    readonly spans: readonly {
      readonly from: Vec2;
      readonly to: Vec2;
      readonly distance: number;
      readonly ink: boolean;
    }[];
  } | null;
  readonly measurement: {
    readonly from: Vec2;
    readonly to: Vec2;
    readonly distance: number;
    /** Pinned readings are drawn a little more firmly than passing ones. */
    readonly pinned: boolean;
  } | null;
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
  readonly metricLines?: readonly MetricLine[];
  readonly image?: SceneImage | null;
  readonly instance?: readonly Contour[];
  readonly guides?: readonly SceneGuide[];
  readonly hoveredGuide?: GuideId | null;
  readonly selectedGuide?: GuideId | null;
  readonly snapGuides?: readonly SnapGuide[];
  readonly comb?: readonly Comb[];
  readonly section?: Scene["section"];
  readonly hoveredAnchor?: AnchorId | null;
  readonly selectedAnchor?: AnchorId | null;
  readonly selectedComponentOutlines?: readonly Contour[];
  readonly tunniSegments?: readonly SegmentRef[];
  readonly selection?: Selection;
  readonly marquee?: Rect | null;
  readonly transformBox?: BoxFrame | null;
  readonly filled?: readonly Contour[];
  readonly penPreview?: Cubic | null;
  readonly neighbours?: readonly NeighbourGlyph[];
  readonly componentOutlines?: readonly Contour[];
  readonly shapePreview?: Contour | null;
  readonly knifeStroke?: readonly [Vec2, Vec2] | null;
  readonly measurement?: Scene["measurement"];
};

export function scene(init: SceneInit): Scene {
  return {
    glyph: init.glyph,
    view: init.view,
    viewport: init.viewport,
    palette: init.palette,
    metrics: init.metrics ?? DEFAULT_METRICS,
    options: { ...DEFAULT_OPTIONS, ...init.options },
    metricLines: init.metricLines ?? [],
    image: init.image ?? null,
    instance: init.instance ?? [],
    guides: init.guides ?? [],
    hoveredGuide: init.hoveredGuide ?? null,
    selectedGuide: init.selectedGuide ?? null,
    snapGuides: init.snapGuides ?? [],
    comb: init.comb ?? [],
    section: init.section ?? null,
    hoveredAnchor: init.hoveredAnchor ?? null,
    selectedAnchor: init.selectedAnchor ?? null,
    selectedComponentOutlines: init.selectedComponentOutlines ?? [],
    tunniSegments: init.tunniSegments ?? [],
    selection: init.selection ?? [],
    marquee: init.marquee ?? null,
    transformBox: init.transformBox ?? null,
    filled: init.filled ?? init.glyph.contours,
    penPreview: init.penPreview ?? null,
    neighbours: init.neighbours ?? [],
    componentOutlines: init.componentOutlines ?? [],
    shapePreview: init.shapePreview ?? null,
    knifeStroke: init.knifeStroke ?? null,
    measurement: init.measurement ?? null,
  };
}
