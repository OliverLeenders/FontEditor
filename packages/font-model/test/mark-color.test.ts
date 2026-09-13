import { describe, expect, it } from "vitest";

import { glyph } from "../src/glyph.js";
import { MARK_COLORS, parseMarkColor, sameMarkColor } from "../src/mark-color.js";

/**
 * Colour marks, as the UFO writes them: four numbers from 0 to 1.
 */

describe("colour marks", () => {
  it("reads the four numbers of a mark", () => {
    expect(parseMarkColor("1,0,0.5,1")).toEqual([1, 0, 0.5, 1]);
    expect(parseMarkColor(" 1 , 0 , 0 , 1 ")).toEqual([1, 0, 0, 1]);
  });

  it("refuses a mark that is not four numbers from 0 to 1", () => {
    expect(parseMarkColor("1,0,0")).toBeNull();
    expect(parseMarkColor("red")).toBeNull();
    expect(parseMarkColor("2,0,0,1")).toBeNull();
  });

  it("counts two spellings of one colour as the same mark", () => {
    expect(sameMarkColor("1,0,0,1", "1.0,0.0,0.0,1.0")).toBe(true);
    expect(sameMarkColor("1,0,0,1", "0,0,1,1")).toBe(false);
    expect(sameMarkColor(null, null)).toBe(true);
    expect(sameMarkColor("1,0,0,1", null)).toBe(false);
  });

  it("offers only colours that parse", () => {
    for (const mark of MARK_COLORS) expect(parseMarkColor(mark.value)).not.toBeNull();
  });

  it("leaves a glyph unmarked unless it is given one", () => {
    expect(glyph("a").markColor).toBeNull();
    expect(glyph("a", { markColor: "1,0,0,1" }).markColor).toBe("1,0,0,1");
  });
});
