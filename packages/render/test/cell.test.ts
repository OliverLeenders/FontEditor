import { contour, glyph, node } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { drawGlyphCell, formatCodePoint } from "../src/draw.js";
import { LIGHT_PALETTE } from "../src/palette.js";
import { RecordingContext } from "./recording-context.js";

const metrics = { unitsPerEm: 1000, ascender: 800, descender: -200 };
const box = { x: 10, y: 20, width: 76, height: 92 };

const square = glyph("A", {
  unicodes: [0x41],
  advance: 500,
  contours: [
    contour(
      "c1",
      [node("n1", { x: 100, y: 0 }), node("n2", { x: 400, y: 0 }), node("n3", { x: 400, y: 700 })],
      true,
    ),
  ],
});

const draw = (
  g: typeof square | null,
  state: Partial<Parameters<typeof drawGlyphCell>[5]> = {},
) => {
  const ctx = new RecordingContext();
  drawGlyphCell(ctx, g, box, LIGHT_PALETTE, metrics, {
    name: "A",
    codePoint: 0x41,
    focused: false,
    current: false,
    ...state,
  });
  return ctx;
};

describe("drawGlyphCell", () => {
  it("draws a border, the outline and both labels", () => {
    const ctx = draw(square);
    expect(ctx.strokedIn(LIGHT_PALETTE.cellRule)).toHaveLength(1);
    expect(ctx.filledIn(LIGHT_PALETTE.outline)).toHaveLength(1);
    expect(ctx.texts()).toEqual(["A", "U+0041"]);
  });

  it("still draws a labelled cell for a glyph with no outline", () => {
    const ctx = draw(null);
    expect(ctx.filledIn(LIGHT_PALETTE.outline)).toHaveLength(0);
    expect(ctx.texts()).toEqual(["A", "U+0041"]);
    expect(ctx.strokedIn(LIGHT_PALETTE.cellRule)).toHaveLength(1);
  });

  it("omits the code point for an unencoded glyph", () => {
    const ctx = draw(square, { codePoint: null });
    expect(ctx.texts()).toEqual(["A"]);
  });

  it("marks the focused cell with the accent border, not the plain rule", () => {
    const ctx = draw(square, { focused: true });
    expect(ctx.strokedIn(LIGHT_PALETTE.cellRule)).toHaveLength(0);
    expect(ctx.strokedIn(LIGHT_PALETTE.marqueeStroke)).toHaveLength(1);
    expect(ctx.filledIn(LIGHT_PALETTE.cellFocus)).toHaveLength(1);
  });

  it("distinguishes the glyph open in the editor from the one focused", () => {
    expect(draw(square, { current: true }).filledIn(LIGHT_PALETTE.cellCurrent)).toHaveLength(1);
    // Current wins the background; focus still owns the border.
    const both = draw(square, { current: true, focused: true });
    expect(both.filledIn(LIGHT_PALETTE.cellCurrent)).toHaveLength(1);
    expect(both.strokedIn(LIGHT_PALETTE.marqueeStroke)).toHaveLength(1);
  });

  it("paints no background for an ordinary cell", () => {
    const ctx = draw(square);
    expect(ctx.filledIn(LIGHT_PALETTE.cellFocus)).toHaveLength(0);
    expect(ctx.filledIn(LIGHT_PALETTE.cellCurrent)).toHaveLength(0);
  });

  it("keeps the outline clear of the label strip", () => {
    const ctx = draw(square);
    const ys = ctx
      .all("moveTo")
      .concat(ctx.all("lineTo"))
      .map((o) => o.args[1] ?? 0);
    // 30px of the 92px cell is reserved for the name, the code point and the mark.
    expect(Math.max(...ys)).toBeLessThanOrEqual(box.y + box.height - 30);
  });

  it("constrains label width so a long name cannot spill out of its cell", () => {
    const ctx = draw(square, { name: "averyLongGlyphNameIndeed" });
    for (const op of ctx.all("fillText")) {
      expect(op.args[2]).toBeLessThanOrEqual(box.width);
    }
  });
});

describe("formatCodePoint", () => {
  it("pads to four digits and goes wider when it must", () => {
    expect(formatCodePoint(0x41)).toBe("U+0041");
    expect(formatCodePoint(0x1f600)).toBe("U+1F600");
  });
});

/**
 * A colour-marked cell: a bar along its foot, clear of the code point, and a
 * faint wash of the same colour behind the letter that stops at the labels.
 */
describe("a colour-marked cell", () => {
  const BAR = "rgba(255, 0, 0, 1)";
  const WASH = "rgba(255, 0, 0, 0.15)";
  const rectIn = (ctx: RecordingContext, colour: string) =>
    ctx.all("rect").find((o) => o.fillStyle === colour)!;

  it("draws the bar, and a faint wash of the same colour behind the letter", () => {
    const ctx = draw(square, { markColor: "1,0,0,1" });
    expect(ctx.filledIn(BAR)).toHaveLength(1);
    expect(ctx.filledIn(WASH)).toHaveLength(1);
  });

  it("keeps the wash off the labels", () => {
    const wash = rectIn(draw(square, { markColor: "1,0,0,1" }), WASH);
    const [, top = 0, , height = 0] = wash.args;
    expect(top + height).toBeLessThanOrEqual(box.y + box.height - 30);
  });

  it("leaves room between the code point and the bar", () => {
    const ctx = draw(square, { markColor: "1,0,0,1" });
    const code = ctx.all("fillText").find((o) => o.text === "U+0041")!;
    const barTop = rectIn(ctx, BAR).args[1] ?? 0;
    expect((code.args[1] ?? 0) + 4).toBeLessThanOrEqual(barTop);
  });

  it("draws neither for a cell with no mark", () => {
    const ctx = draw(square);
    expect(ctx.all("fill").some((o) => o.fillStyle.startsWith("rgba(255, 0, 0"))).toBe(false);
  });
});
