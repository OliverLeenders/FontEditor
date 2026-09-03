import { contour, glyph, node } from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { drawScene } from "../src/draw.js";
import { LIGHT_PALETTE } from "../src/palette.js";
import { scene } from "../src/scene.js";
import { RecordingContext } from "./recording-context.js";

const box = (name: string, x0: number, x1: number, advance: number) =>
  glyph(name, {
    advance,
    contours: [
      contour(
        `c-${name}`,
        [
          node(`${name}1`, { x: x0, y: 0 }),
          node(`${name}2`, { x: x1, y: 0 }),
          node(`${name}3`, { x: x1, y: 700 }),
        ],
        true,
      ),
    ],
  });

const render = (init: Parameters<typeof scene>[0]) => {
  const ctx = new RecordingContext();
  drawScene(ctx, scene(init));
  return ctx;
};

const base = {
  glyph: box("n", 100, 400, 500),
  view: { scale: 1, tx: 0, ty: 0 },
  viewport: { width: 800, height: 600 },
  palette: LIGHT_PALETTE,
};

describe("margins", () => {
  it("draws a line at the origin and at the advance", () => {
    const ctx = render(base);
    const xs = ctx.strokedIn(LIGHT_PALETTE.margin).map((_, i) => i);
    expect(xs).toHaveLength(2);

    // Both are full-height verticals at x=0 and x=advance.
    const moves = ctx.all("moveTo").filter((o) => o.strokeStyle === LIGHT_PALETTE.margin);
    expect(moves.map((o) => o.args[0])).toEqual([0.5, 500.5]);
    expect(moves.every((o) => o.args[1] === 0)).toBe(true);
  });

  it("follows the view transform", () => {
    const ctx = render({ ...base, view: { scale: 2, tx: 30, ty: 0 } });
    const moves = ctx.all("moveTo").filter((o) => o.strokeStyle === LIGHT_PALETTE.margin);
    expect(moves.map((o) => o.args[0])).toEqual([30.5, 1030.5]);
  });

  it("can be switched off", () => {
    const ctx = render({ ...base, options: { margins: false } });
    expect(ctx.strokedIn(LIGHT_PALETTE.margin)).toHaveLength(0);
  });
});

describe("neighbours", () => {
  it("draws nothing when there are none", () => {
    expect(render(base).filledIn(LIGHT_PALETTE.neighbour)).toHaveLength(0);
  });

  it("fills each neighbour once, at its offset", () => {
    const ctx = render({
      ...base,
      neighbours: [
        { glyph: box("a", 50, 300, 350), x: -350 },
        { glyph: box("b", 50, 300, 350), x: 500 },
      ],
    });
    expect(ctx.filledIn(LIGHT_PALETTE.neighbour)).toHaveLength(2);

    const moves = ctx.all("moveTo").filter((o) => o.fillStyle === LIGHT_PALETTE.neighbour);
    // First point of each: x0 (50) shifted by the neighbour's offset.
    expect(moves.map((o) => o.args[0])).toEqual([-300, 550]);
  });

  it("skips a neighbour with no drawable contour", () => {
    const ctx = render({
      ...base,
      neighbours: [{ glyph: glyph("space", { advance: 250 }), x: -250 }],
    });
    expect(ctx.filledIn(LIGHT_PALETTE.neighbour)).toHaveLength(0);
  });

  it("draws neighbours beneath the edited glyph, not over it", () => {
    const ctx = render({
      ...base,
      neighbours: [{ glyph: box("a", 50, 300, 350), x: -350 }],
    });
    const neighbourAt = ctx.indexWhere(
      (o) => o.op === "fill" && o.fillStyle === LIGHT_PALETTE.neighbour,
    );
    const outlineAt = ctx.indexWhere(
      (o) => o.op === "stroke" && o.strokeStyle === LIGHT_PALETTE.outline,
    );
    expect(neighbourAt).toBeGreaterThanOrEqual(0);
    expect(neighbourAt).toBeLessThan(outlineAt);
  });
});
