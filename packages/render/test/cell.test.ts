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
    // The sample between them: the character as the system draws it, since the
    // font has not drawn it yet.
    expect(ctx.texts()).toEqual(["A", "A", "U+0041"]);
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

/**
 * The character a cell stands for, shown where the font has not drawn it.
 *
 * Adding the missing glyphs of a block fills the browser with empty boxes at
 * once, and which box is which is the only question being asked of them.
 */
/**
 * A cell for a code point the font has no glyph for.
 *
 * It has to be told apart at a glance from a glyph that exists and has simply
 * not been drawn yet — the two look alike otherwise, and one can be opened while
 * the other has to be made first.
 */
describe("a cell the font has nothing for", () => {
  it("draws its border dashed, where a glyph's is solid", () => {
    expect(draw(null, { missing: true }).all("stroke")[0]!.lineDash).toEqual([3, 3]);
    expect(draw(null).all("stroke")[0]!.lineDash).toEqual([]);
  });

  it("gives the character less ink than an undrawn glyph's", () => {
    const missing = draw(null, { missing: true });
    const undrawn = draw(null);
    const alphaOf = (ctx: typeof missing): number =>
      ctx.all("fillText").find((each) => each.text === "A")?.globalAlpha ?? 1;

    expect(alphaOf(missing)).toBeLessThan(alphaOf(undrawn));
  });

  it("says the code point and not a name the font has not given", () => {
    // What it would be called is a guess, and a cell should not state a guess
    // as a fact.
    expect(draw(null, { missing: true }).texts()).toEqual(["A", "U+0041"]);
  });

  it("is still outlined by the focus, which is about where the keyboard is", () => {
    const ctx = draw(null, { missing: true, focused: true });
    expect(ctx.strokedIn(LIGHT_PALETTE.marqueeStroke)).toHaveLength(1);
    expect(ctx.all("stroke")[0]!.lineDash).toEqual([]);
  });
});

describe("the sample in an undrawn cell", () => {
  const sample = (ctx: RecordingContext) =>
    ctx.all("fillText").find((o) => o.fillStyle === LIGHT_PALETTE.cellSample)?.text ?? null;

  it("draws the character, and only where there is no outline", () => {
    expect(sample(draw(null))).toBe("A");
    expect(sample(draw(square))).toBeNull();
  });

  it("puts a combining mark on the dotted circle it is always shown on", () => {
    // U+0308, the diaeresis: on its own it is a speck in the middle of a cell.
    expect(sample(draw(null, { name: "uni0308", codePoint: 0x308 }))).toBe("\u25CC\u0308");
  });

  it("draws nothing for a glyph with no code point, a space or a control", () => {
    expect(sample(draw(null, { name: "a.alt", codePoint: null }))).toBeNull();
    expect(sample(draw(null, { name: "space", codePoint: 0x20 }))).toBeNull();
    expect(sample(draw(null, { name: "uni0009", codePoint: 0x09 }))).toBeNull();
  });

  /**
   * What the sample covers, from the same measurement the drawing used.
   *
   * A cell is 62 pixels tall above its labels, and a capital with an accent on
   * it measures taller than the em it is set in — which is how one came to be
   * drawn over the top edge of its cell.
   */
  const covers = (ctx: RecordingContext) => {
    const op = ctx.all("fillText").find((o) => o.fillStyle === LIGHT_PALETTE.cellSample)!;
    const size = Number.parseFloat(op.font ?? "0");
    const baseline = op.args[1] ?? 0;
    const metrics = new RecordingContext();
    metrics.font = op.font ?? "";
    const { actualBoundingBoxAscent, actualBoundingBoxDescent } = metrics.measureText(
      op.text ?? "",
    );
    return {
      top: baseline - actualBoundingBoxAscent,
      bottom: baseline + actualBoundingBoxDescent,
      size,
    };
  };

  it("keeps the sample inside the cell, above the labels", () => {
    for (const code of [0x41, 0xcb, 0x308, 0x67]) {
      const { top, bottom } = covers(draw(null, { codePoint: code }));
      expect(top).toBeGreaterThanOrEqual(box.y);
      expect(bottom).toBeLessThanOrEqual(box.y + box.height - 30);
    }
  });

  it("shrinks a sample the font draws taller than the cell", () => {
    // A font whose letters reach twice the size they are set at — Devanagari
    // and Thai marks come close, and it is the case that overflowed a cell.
    class Tall extends RecordingContext {
      override measureText(sample: string): {
        width: number;
        actualBoundingBoxAscent: number;
        actualBoundingBoxDescent: number;
      } {
        const size = Number.parseFloat(this.font) || 10;
        return {
          width: sample.length * size,
          actualBoundingBoxAscent: size * 2,
          actualBoundingBoxDescent: size * 0.2,
        };
      }
    }
    const ctx = new Tall();
    drawGlyphCell(ctx, null, box, LIGHT_PALETTE, metrics, {
      name: "uni00CB",
      codePoint: 0xcb,
      focused: false,
      current: false,
    });

    const op = ctx.all("fillText").find((o) => o.fillStyle === LIGHT_PALETTE.cellSample)!;
    const size = Number.parseFloat(op.font ?? "0");
    const baseline = op.args[1] ?? 0;
    expect(size).toBeLessThan(32);
    expect(baseline - size * 2).toBeGreaterThanOrEqual(box.y);
    expect(baseline + size * 0.2).toBeLessThanOrEqual(box.y + box.height - 30);
  });

  it("keeps the sample inside the cell sideways as well", () => {
    const ctx = draw(null);
    const op = ctx.all("fillText").find((o) => o.fillStyle === LIGHT_PALETTE.cellSample)!;
    expect(op.args[2]).toBeLessThanOrEqual(box.width);
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
