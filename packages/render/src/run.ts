import type { Glyph } from "@typewright/font-model";
import { type ViewTransform, toScreen } from "@typewright/view";

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
export type ProofLines = readonly {
  readonly glyphs: readonly { readonly glyph: Glyph; readonly x: number }[];
  /** Design units below the first line's baseline. */
  readonly y: number;
}[];

/**
 * What a block's rule says, and where it is drawn.
 *
 * Screen pixels rather than design units, because a rule belongs to the page and
 * not to the type on it: it runs the width of the measure whatever size the block
 * is set at, and two blocks an inch apart are an inch apart at 8 pt and at 72.
 */
export type ProofCaption = {
  readonly text: string;
  readonly y: number;
  readonly left: number;
  readonly right: number;
};

/**
 * One block of set text: its lines, the transform that puts them on the page, and
 * the rule that says what it is.
 *
 * A block has its own scale because it has its own size, which is the whole of
 * what a waterfall is. `null` for the caption is a proof set at one size, where a
 * rule saying "12 pt" would be telling the reader what the size slider already
 * says.
 */
export type ProofBlockScene = {
  readonly lines: ProofLines;
  readonly view: ViewTransform;
  readonly caption: ProofCaption | null;
};

export type ProofScene = {
  readonly blocks: readonly ProofBlockScene[];
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

  for (const block of s.blocks) {
    if (block.caption !== null) drawCaption(ctx, s, block.caption);

    for (const line of block.lines) {
      // Each line is the same view moved down its own baseline, which is exactly
      // what `drawGlyphs` already does per glyph along the other axis. Drawing a
      // line is then drawing a run, and there is one piece of glyph-drawing code.
      const view: ViewTransform = { ...block.view, ty: block.view.ty + line.y * block.view.scale };
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
  }

  ctx.restore();
}

/**
 * The rule above a block, with its size at the left end of it.
 *
 * The one thing drawn on a proof that is not the font, and it earns its place:
 * a waterfall whose rungs are not labelled is a page somebody has to count down
 * to read, and two blocks at one size with different features set are
 * indistinguishable without it. Drawn in the colours the glyph browser labels its
 * cells with, which is the same job — furniture between specimens, faint enough
 * to be looked past.
 *
 * The rule starts after the text rather than under it, so the label is never
 * struck through, and stops at the right margin, so the page has a measure.
 */
function drawCaption(ctx: Canvas2D, s: ProofScene, caption: ProofCaption): void {
  ctx.font = CAPTION_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = s.palette.cellLabel;
  ctx.fillText(caption.text, caption.left, caption.y);

  const after = caption.left + ctx.measureText(caption.text).width + CAPTION_GAP;
  if (after >= caption.right) return;

  ctx.strokeStyle = s.palette.cellRule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  // Half a pixel, so a one-pixel rule lands on a pixel instead of across two.
  ctx.moveTo(after, Math.round(caption.y) + 0.5);
  ctx.lineTo(caption.right, Math.round(caption.y) + 0.5);
  ctx.stroke();
}

/** The same as the browser's cell labels, for the same reason. */
const CAPTION_FONT = "11px ui-sans-serif, system-ui, sans-serif";

/** Space between the label and the rule that carries on from it. */
const CAPTION_GAP = 8;
