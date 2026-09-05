import type { Glyph } from "@fonteditor/font-model";
import { type ViewTransform, toScreen } from "@fonteditor/view";

import type { Canvas2D } from "./context.js";
import type { RenderPalette } from "./palette.js";
import { traceContour } from "./draw.js";

/**
 * A line of text laid out for spacing work.
 *
 * Its own scene rather than a variant of the editing one. The editing scene is
 * about a single glyph and everything you can grab on it; this is about several
 * glyphs and the gaps between them, and folding the two together would give both
 * a pile of fields the other ignores.
 */
export type RunScene = {
  /**
   * What to draw and where.
   *
   * Only the fields this scene uses, so a caller can hand over a laid-out run or
   * build one by hand. The last three are what a positioning rule changed, and
   * are optional because a scene assembled without one has nothing to say about
   * them: the advance is then the glyph's own and the offsets are none.
   */
  readonly glyphs: readonly {
    readonly glyph: Glyph;
    readonly x: number;
    readonly advance?: number;
    readonly dx?: number;
    readonly dy?: number;
  }[];
  readonly view: ViewTransform;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly palette: RenderPalette;
  readonly metrics: {
    readonly unitsPerEm: number;
    readonly ascender: number;
    readonly descender: number;
  };
  /** Run positions to mark as selected. Several, because one glyph may recur. */
  readonly selected: readonly number[];
  /** Draw the origin and advance line of every glyph, not just selected ones. */
  readonly allMargins: boolean;
};

/**
 * Draw the line.
 *
 * Filled, not outlined. Spacing is judged by weighing areas of black against
 * areas of white, and an outline reads as a shape to edit rather than a mass to
 * weigh — the same reason the editing canvas draws its neighbours filled.
 */
export function drawRun(ctx: Canvas2D, s: RunScene): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  ctx.fillStyle = s.palette.background;
  ctx.beginPath();
  ctx.rect(0, 0, s.viewport.width, s.viewport.height);
  ctx.fill();

  drawBaseline(ctx, s);
  drawSelectionBands(ctx, s);
  drawRunMargins(ctx, s);
  drawGlyphs(ctx, s);

  ctx.restore();
}

/** The baseline, which is the one line every glyph in the run shares. */
export function drawBaseline(ctx: Canvas2D, s: RunScene): void {
  const y = Math.round(toScreen(s.view, { x: 0, y: 0 }).y) + 0.5;
  ctx.strokeStyle = s.palette.guideEmphasis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(s.viewport.width, y);
  ctx.stroke();
}

/**
 * A band behind each selected position, spanning its advance.
 *
 * The band is the advance rather than the outline, because the advance is what
 * is being edited: it shows the space the letter owns, which is the thing the
 * arrow keys change.
 */
export function drawSelectionBands(ctx: Canvas2D, s: RunScene): void {
  if (s.selected.length === 0) return;

  const top = toScreen(s.view, { x: 0, y: s.metrics.ascender }).y;
  const bottom = toScreen(s.view, { x: 0, y: s.metrics.descender }).y;

  ctx.fillStyle = s.palette.cellCurrent;
  for (const index of s.selected) {
    const placed = s.glyphs[index];
    if (placed === undefined) continue;
    const left = toScreen(s.view, { x: placed.x, y: 0 }).x;
    const right = toScreen(s.view, { x: placed.x + advanceOf(placed), y: 0 }).x;
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.fill();
  }
}

/**
 * The vertical lines between glyphs.
 *
 * Each glyph's origin doubles as the previous one's advance, so drawing both for
 * every glyph would put two lines on the same pixel the whole way along. The
 * boundaries are collected first and drawn once each.
 */
export function drawRunMargins(ctx: Canvas2D, s: RunScene): void {
  const wanted = s.allMargins ? s.glyphs.map((_, i) => i) : s.selected;
  if (wanted.length === 0) return;

  const boundaries = new Set<number>();
  for (const index of wanted) {
    const placed = s.glyphs[index];
    if (placed === undefined) continue;
    boundaries.add(Math.round(toScreen(s.view, { x: placed.x, y: 0 }).x));
    boundaries.add(Math.round(toScreen(s.view, { x: placed.x + advanceOf(placed), y: 0 }).x));
  }

  ctx.strokeStyle = s.palette.margin;
  ctx.lineWidth = 1;
  for (const x of boundaries) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, s.viewport.height);
    ctx.stroke();
  }
}

/** What the glyph took, which a positioning rule may have changed. */
const advanceOf = (placed: RunScene["glyphs"][number]): number =>
  placed.advance ?? placed.glyph.advance;

export function drawGlyphs(ctx: Canvas2D, s: RunScene): void {
  ctx.fillStyle = s.palette.outline;

  for (const placed of s.glyphs) {
    const drawable = placed.glyph.contours.filter((c) => c.nodes.length >= 2);
    if (drawable.length === 0) continue;

    // Shift the view rather than the glyph: the outline is model data and has no
    // business being copied and moved in order to be previewed. A positioning
    // rule moves the drawing and not the pen, so its offset goes here and
    // nowhere else — screen y grows downward, which is why it is subtracted.
    const shifted: ViewTransform = {
      ...s.view,
      tx: s.view.tx + (placed.x + (placed.dx ?? 0)) * s.view.scale,
      ty: s.view.ty - (placed.dy ?? 0) * s.view.scale,
    };
    ctx.beginPath();
    for (const c of drawable) traceContour(ctx, shifted, c);
    ctx.fill();
  }
}

/**
 * A page of text, for judging a font rather than editing one.
 *
 * Filled and unadorned: no baselines, no margins, no marks. A proof answers
 * "does this read", and every line the editor draws to help you work is a line
 * that stops you seeing the answer.
 */
export type ProofScene = {
  readonly lines: readonly {
    readonly glyphs: readonly { readonly glyph: Glyph; readonly x: number }[];
    /** Design units below the first line's baseline. */
    readonly y: number;
  }[];
  readonly view: ViewTransform;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly palette: RenderPalette;
};

export function drawProof(ctx: Canvas2D, s: ProofScene): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  ctx.fillStyle = s.palette.background;
  ctx.beginPath();
  ctx.rect(0, 0, s.viewport.width, s.viewport.height);
  ctx.fill();

  for (const line of s.lines) {
    // Each line is the same view moved down its own baseline, which is exactly
    // what `drawGlyphs` already does per glyph along the other axis. Drawing a
    // line is then drawing a run, and there is one piece of glyph-drawing code.
    const view: ViewTransform = { ...s.view, ty: s.view.ty + line.y * s.view.scale };
    drawGlyphs(ctx, {
      glyphs: line.glyphs,
      view,
      viewport: s.viewport,
      palette: s.palette,
      metrics: { unitsPerEm: 1000, ascender: 0, descender: 0 },
      selected: [],
      allMargins: false,
    });
  }

  ctx.restore();
}
