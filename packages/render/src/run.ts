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
  readonly glyphs: readonly { readonly glyph: Glyph; readonly x: number }[];
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
    const right = toScreen(s.view, { x: placed.x + placed.glyph.advance, y: 0 }).x;
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
    boundaries.add(
      Math.round(toScreen(s.view, { x: placed.x + placed.glyph.advance, y: 0 }).x),
    );
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

export function drawGlyphs(ctx: Canvas2D, s: RunScene): void {
  ctx.fillStyle = s.palette.outline;

  for (const placed of s.glyphs) {
    const drawable = placed.glyph.contours.filter((c) => c.nodes.length >= 2);
    if (drawable.length === 0) continue;

    // Shift the view rather than the glyph: the outline is model data and has no
    // business being copied and moved in order to be previewed.
    const shifted: ViewTransform = { ...s.view, tx: s.view.tx + placed.x * s.view.scale };
    ctx.beginPath();
    for (const c of drawable) traceContour(ctx, shifted, c);
    ctx.fill();
  }
}
