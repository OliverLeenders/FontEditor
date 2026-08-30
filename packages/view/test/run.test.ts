import { contour, fontDocument, glyph, node } from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { EMPTY_RUN, glyphAtX, layoutRun, occurrencesOf, placedAt } from "../src/run.js";

const box = (name: string, code: number, advance: number) =>
  glyph(name, {
    unicodes: [code],
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

// n is 500 wide, o is 600, space is 250 and blank.
const doc = fontDocument([
  box("n", 0x6e, 500),
  box("o", 0x6f, 600),
  glyph("space", { unicodes: [0x20], advance: 250 }),
]);

describe("layoutRun", () => {
  it("places each glyph at the running pen position", () => {
    const run = layoutRun(doc, "non");
    expect(run.glyphs.map((p) => [p.name, p.x])).toEqual([
      ["n", 0],
      ["o", 500],
      ["n", 1100],
    ]);
  });

  it("finishes at the sum of the advances", () => {
    expect(layoutRun(doc, "non").width).toBe(1600);
    expect(layoutRun(doc, "").width).toBe(0);
  });

  it("counts a blank glyph's advance like any other", () => {
    const run = layoutRun(doc, "n o");
    expect(run.glyphs.map((p) => p.name)).toEqual(["n", "space", "o"]);
    expect(run.glyphs[2]?.x).toBe(750);
  });

  it("skips characters the font has no glyph for, without leaving a gap", () => {
    // "z" is absent: the run must not invent a width for it.
    const run = layoutRun(doc, "nzo");
    expect(run.glyphs.map((p) => p.name)).toEqual(["n", "o"]);
    expect(run.glyphs[1]?.x).toBe(500);
  });

  it("numbers placements by run position, not by character position", () => {
    const run = layoutRun(doc, "nzo");
    expect(run.glyphs.map((p) => p.index)).toEqual([0, 1]);
  });

  it("handles a string of only unknown characters", () => {
    expect(layoutRun(doc, "zzz")).toEqual(EMPTY_RUN);
  });

  it("reads astral characters as one character", () => {
    // Not in the font, so the run is empty rather than two broken halves.
    expect(layoutRun(doc, "\u{1F600}").glyphs).toHaveLength(0);
  });
});

describe("glyphAtX", () => {
  const run = layoutRun(doc, "non");

  it("finds the glyph whose advance contains the point", () => {
    expect(glyphAtX(run, 0)?.index).toBe(0);
    expect(glyphAtX(run, 499)?.index).toBe(0);
    expect(glyphAtX(run, 500)?.index).toBe(1);
    expect(glyphAtX(run, 1099)?.index).toBe(1);
    expect(glyphAtX(run, 1100)?.index).toBe(2);
  });

  it("selects the owner of the space beside a letter, not a miss", () => {
    // x = 460 is past the 'n' outline but inside its advance: still the 'n',
    // because that trailing space is exactly what spacing edits.
    expect(glyphAtX(run, 460)?.name).toBe("n");
  });

  it("returns null outside the run", () => {
    expect(glyphAtX(run, -1)).toBeNull();
    expect(glyphAtX(run, 1600)).toBeNull();
    expect(glyphAtX(EMPTY_RUN, 0)).toBeNull();
  });
});

describe("occurrencesOf", () => {
  it("finds every position showing the same glyph", () => {
    // Editing 'n' moves both of them, so both must be marked.
    expect(occurrencesOf(layoutRun(doc, "non"), "n")).toEqual([0, 2]);
    expect(occurrencesOf(layoutRun(doc, "non"), "o")).toEqual([1]);
    expect(occurrencesOf(layoutRun(doc, "non"), "x")).toEqual([]);
  });
});

describe("placedAt", () => {
  it("returns the placement or null", () => {
    const run = layoutRun(doc, "no");
    expect(placedAt(run, 1)?.name).toBe("o");
    expect(placedAt(run, 2)).toBeNull();
    expect(placedAt(run, -1)).toBeNull();
  });
});
