import {
  EMPTY_KERNING,
  contour,
  fontDocument,
  glyph,
  node,
  setKern,
  setKerning,
} from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import {
  EMPTY_RUN,
  type Positioner,
  type Shaper,
  glyphAtX,
  layoutParagraph,
  layoutRun,
  occurrencesOf,
  placedAt,
} from "../src/run.js";

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

/** A font with an "no" ligature, which is easier to see in a test than "fi". */
const ligatured = fontDocument([
  box("n", 0x6e, 500),
  box("o", 0x6f, 600),
  box("n_o", 0x0, 800),
  glyph("space", { unicodes: [0x20], advance: 250 }),
]);

/** Stands in for the real shaper: this package never learns what `.fea` is. */
const joinNO: Shaper = (names) => {
  const out: string[] = [];
  for (let i = 0; i < names.length; i++) {
    if (names[i] === "n" && names[i + 1] === "o") {
      out.push("n_o");
      i += 1;
    } else {
      out.push(names[i]!);
    }
  }
  return out;
};

describe("shaped layout", () => {
  it("sets the glyphs the shaper asks for", () => {
    const run = layoutRun(ligatured, "non", joinNO);
    expect(run.glyphs.map((p) => p.name)).toEqual(["n_o", "n"]);
  });

  it("measures the ligature's own advance, not the letters it replaced", () => {
    expect(layoutRun(ligatured, "no", joinNO).width).toBe(800);
    expect(layoutRun(ligatured, "no").width).toBe(1100);
  });

  it("kerns the pair the ligature makes, not the pair it came from", () => {
    // The kern is looked up after substitution: an n_o followed by an n is an
    // n_o/n pair, and the o/n pair that used to be there is simply not in the
    // line any more.
    const kerned = setKerning(ligatured, {
      firstGroups: {},
      secondGroups: {},
      pairs: { o: { n: -100 }, n_o: { n: -50 } },
    });
    expect(layoutRun(kerned, "non", joinNO).glyphs[1]?.kern).toBe(-50);
    expect(layoutRun(kerned, "non").glyphs[2]?.kern).toBe(-100);
  });

  it("drops a name the font has no glyph for", () => {
    // A rule naming a glyph that was since deleted costs that glyph, not the
    // line it was in.
    const gone: Shaper = () => ["n", "nothing-here", "o"];
    expect(layoutRun(ligatured, "no", gone).glyphs.map((p) => p.name)).toEqual(["n", "o"]);
  });

  it("carries the shaper through every line of a paragraph", () => {
    const lines = layoutParagraph(ligatured, "no no", 10_000, 1000, joinNO);
    expect(lines[0]?.run.glyphs.map((p) => p.name)).toEqual(["n_o", "space", "n_o"]);
  });

  it("wraps on the shaped width, since that is what will be set", () => {
    // One "no" is 800 shaped and 1100 unshaped, so a measure of 1000 fits the
    // ligature and not the pair.
    expect(layoutParagraph(ligatured, "no no", 1000, 1000, joinNO)).toHaveLength(2);
    expect(layoutParagraph(ligatured, "no", 1000, 1000, joinNO)).toHaveLength(1);
    expect(layoutParagraph(ligatured, "no", 1000, 1000)).toHaveLength(1);
  });
});

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

/** Stands in for the real one: twenty units after every o, drawn five up. */
const nudgeO: Positioner = (names) =>
  names.map((name) => (name === "o" ? { x: 3, y: 5, xAdvance: 20, yAdvance: 0 } : null));

describe("positioned layout", () => {
  it("leaves the run alone without a positioner", () => {
    const run = layoutRun(doc, "no");
    expect(run.glyphs.map((p) => [p.dx, p.dy])).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(run.glyphs.map((p) => p.advance)).toEqual([500, 600]);
  });

  it("records the offset without moving the pen", () => {
    // The two are different facts: where the glyph is drawn, and where the line
    // has got to. Only the second decides where the next glyph starts.
    const run = layoutRun(doc, "no", undefined, nudgeO);
    expect(run.glyphs[1]).toMatchObject({ name: "o", x: 500, dx: 3, dy: 5 });
  });

  it("lets an advance adjustment move everything after it", () => {
    const run = layoutRun(doc, "ono", undefined, nudgeO);
    expect(run.glyphs.map((p) => p.x)).toEqual([0, 620, 1120]);
    expect(run.width).toBe(1740);
  });

  it("measures the line by what was drawn", () => {
    const run = layoutRun(doc, "o", undefined, nudgeO);
    expect(run.glyphs[0]?.advance).toBe(620);
    expect(run.width).toBe(620);
  });

  it("hit tests against the advance the glyph actually took", () => {
    // Clicking the gap a rule opened up has to select the letter that owns it.
    const run = layoutRun(doc, "on", undefined, nudgeO);
    expect(glyphAtX(run, 610)?.name).toBe("o");
    expect(glyphAtX(run, 625)?.name).toBe("n");
  });

  it("positions the glyphs a substitution left behind, not the ones it took", () => {
    // The rule is about the "n_o" that is there, and there is no o any more.
    const run = layoutRun(ligatured, "no", joinNO, nudgeO);
    expect(run.glyphs).toHaveLength(1);
    expect(run.glyphs[0]).toMatchObject({ name: "n_o", dx: 0, advance: 800 });
  });

  it("adds the adjustment on top of the kern rather than instead of it", () => {
    const kerned = setKerning(doc, setKern(EMPTY_KERNING, "o", "n", -30));
    const run = layoutRun(kerned, "on", undefined, nudgeO);
    expect(run.glyphs[1]).toMatchObject({ name: "n", kern: -30, x: 590 });
  });

  it("carries positioning into a paragraph", () => {
    const lines = layoutParagraph(doc, "oo", 100000, 1200, undefined, nudgeO);
    expect(lines[0]?.run.width).toBe(1240);
  });
});
