import { contour, glyph, node } from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { LIGHT_PALETTE } from "../src/palette.js";
import { type RunScene, drawRun } from "../src/run.js";
import { RecordingContext } from "./recording-context.js";

const box = (name: string, advance: number) =>
  glyph(name, {
    advance,
    contours: [
      contour(
        `c-${name}`,
        [
          node(`${name}1`, { x: 40, y: 0 }),
          node(`${name}2`, { x: advance - 40, y: 0 }),
          node(`${name}3`, { x: advance - 40, y: 700 }),
        ],
        true,
      ),
    ],
  });

const base: RunScene = {
  glyphs: [
    { glyph: box("n", 500), x: 0 },
    { glyph: box("o", 600), x: 500 },
    { glyph: box("n", 500), x: 1100 },
  ],
  view: { scale: 1, tx: 0, ty: 0 },
  viewport: { width: 2000, height: 900 },
  palette: LIGHT_PALETTE,
  metrics: { unitsPerEm: 1000, ascender: 800, descender: -200 },
  selected: [],
  allMargins: false,
};

const render = (scene: Partial<RunScene> = {}) => {
  const ctx = new RecordingContext();
  drawRun(ctx, { ...base, ...scene });
  return ctx;
};


/**
 * The x of every line actually stroked in the margin colour.
 *
 * Pairing each `stroke` with the `moveTo` that began it, rather than filtering
 * `moveTo`s by their recorded strokeStyle: canvas state persists, so the glyph
 * outlines still carry whatever stroke colour was set last even though they are
 * only ever filled.
 */
function strokedLineXs(ctx: RecordingContext, colour: string): number[] {
  const xs: number[] = [];
  ctx.ops.forEach((op, i) => {
    if (op.op !== "stroke" || op.strokeStyle !== colour) return;
    for (let j = i - 1; j >= 0; j--) {
      const candidate = ctx.ops[j]!;
      if (candidate.op === "moveTo") {
        xs.push(candidate.args[0]!);
        return;
      }
    }
  });
  return xs;
}

describe("drawRun", () => {
  it("fills one path per glyph", () => {
    expect(render().filledIn(LIGHT_PALETTE.outline)).toHaveLength(3);
  });

  it("places each glyph at its own pen position", () => {
    const starts = render()
      .all("moveTo")
      .filter((o) => o.fillStyle === LIGHT_PALETTE.outline)
      .map((o) => o.args[0]);
    // Each outline starts 40 units in from its own origin: 0, 500, 1100.
    expect(starts).toEqual([40, 540, 1140]);
  });

  it("skips a glyph with nothing to draw", () => {
    const ctx = render({
      glyphs: [{ glyph: glyph("space", { advance: 250 }), x: 0 }],
    });
    expect(ctx.filledIn(LIGHT_PALETTE.outline)).toHaveLength(0);
  });

  it("draws the baseline once, across the whole viewport", () => {
    const ctx = render();
    const baseline = ctx.strokedIn(LIGHT_PALETTE.guideEmphasis);
    expect(baseline).toHaveLength(1);
    const move = ctx.all("moveTo").find((o) => o.strokeStyle === LIGHT_PALETTE.guideEmphasis);
    expect(move?.args).toEqual([0, 0.5]);
  });

  it("draws no margin lines until something is selected", () => {
    expect(render().strokedIn(LIGHT_PALETTE.margin)).toHaveLength(0);
  });

  it("draws both edges of the selected glyph's advance", () => {
    const ctx = render({ selected: [1] });
    expect(strokedLineXs(ctx, LIGHT_PALETTE.margin)).toEqual([500.5, 1100.5]);
  });

  it("draws each boundary once when neighbours share it", () => {
    // Glyph 0 ends where glyph 1 begins; that edge is one line, not two.
    const ctx = render({ allMargins: true });
    expect(strokedLineXs(ctx, LIGHT_PALETTE.margin)).toEqual([0.5, 500.5, 1100.5, 1600.5]);
  });

  it("bands every position showing the selected glyph, not just one", () => {
    // Editing 'n' moves both of them, so both are marked.
    const ctx = render({ selected: [0, 2] });
    expect(ctx.filledIn(LIGHT_PALETTE.cellCurrent)).toHaveLength(2);
  });

  it("spans the band across the advance, not the outline", () => {
    const ctx = render({ selected: [1] });
    const rect = ctx.all("rect").find((o) => o.fillStyle === LIGHT_PALETTE.cellCurrent);
    // Glyph 1 owns x 500 to 1100, though its outline only covers 540 to 1060.
    expect(rect?.args[0]).toBe(500);
    expect(rect?.args[2]).toBe(600);
  });

  it("draws the band under the glyph, never over it", () => {
    const ctx = render({ selected: [0] });
    const band = ctx.indexWhere(
      (o) => o.op === "fill" && o.fillStyle === LIGHT_PALETTE.cellCurrent,
    );
    const outline = ctx.indexWhere(
      (o) => o.op === "fill" && o.fillStyle === LIGHT_PALETTE.outline,
    );
    expect(band).toBeLessThan(outline);
  });

  it("follows the view transform", () => {
    const ctx = render({ view: { scale: 0.5, tx: 100, ty: 0 }, selected: [1] });
    expect(strokedLineXs(ctx, LIGHT_PALETTE.margin)).toEqual([350.5, 650.5]);
  });

  it("leaves the context balanced", () => {
    const ctx = render({ selected: [0] });
    expect(ctx.all("save").length).toBe(ctx.all("restore").length);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("draws nothing but a background and a baseline for an empty run", () => {
    const ctx = render({ glyphs: [] });
    expect(ctx.filledIn(LIGHT_PALETTE.outline)).toHaveLength(0);
    expect(ctx.strokedIn(LIGHT_PALETTE.guideEmphasis)).toHaveLength(1);
  });
});
