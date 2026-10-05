import {
  DEFAULT_FONT_INFO,
  type Kerning,
  contour,
  counterIds,
  fontDocument,
  glyph,
  groupKey,
  kernIndex,
  kernValue,
  node,
} from "@typewright/font-model";
import { Blob, Face, Font } from "harfbuzzjs";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { set } from "./real-fonts.js";

/**
 * Which kerning wins where more than one could, in the editor and in the font.
 *
 * The editor answers by how particular a pair is: one naming both glyphs
 * before one naming a glyph and a group, before one naming a group and a
 * glyph, before one naming two groups. The font has to answer the same, since
 * the Spacing workspace shows the editor's answer and a reader gets the
 * font's. It did not where the kerning listed the less particular pair after
 * the more: each was written as the pairs of glyphs it means, and the later
 * took the place of the earlier.
 */

const ids = counterIds("kern");
const drawn = () =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: 0 }),
      node(ids.node(), { x: 100, y: 0 }),
      node(ids.node(), { x: 50, y: 100 }),
    ],
    true,
  );
const LETTERS = ["A", "B", "V", "W"];
const glyphs = [
  glyph(".notdef", { advance: 500 }),
  ...LETTERS.map((name) =>
    glyph(name, { unicodes: [name.charCodeAt(0)], advance: 500, contours: [drawn()] }),
  ),
];

/** A and B open alike on the left of a pair; V and W close alike on the right. */
const GROUPS = {
  firstGroups: { round: ["A", "B"] },
  secondGroups: { slanted: ["V", "W"] },
};
const L = groupKey("round");
const R = groupKey("slanted");

/** The same four kinds of pair for `A V`, most particular first and last. */
const PAIRS: readonly (readonly [string, string, number])[] = [
  ["A", "V", -10],
  ["A", R, -30],
  [L, "V", -50],
  [L, R, -70],
];

function kerningOf(pairs: readonly (readonly [string, string, number])[]): Kerning {
  const out: Record<string, Record<string, number>> = {};
  for (const [first, second, value] of pairs) (out[first] ??= {})[second] = value;
  return { ...GROUPS, pairs: out };
}

describe("which kerning wins", () => {
  it.each([
    ["listed most particular first", PAIRS],
    ["listed most particular last", [...PAIRS].reverse()],
    ["with only a glyph against a group, and a group against a glyph", [PAIRS[2]!, PAIRS[1]!]],
    ["with only those two, the other way round", [PAIRS[1]!, PAIRS[2]!]],
  ] as const)("is the same in the font as in the editor, %s", (_, pairs) => {
    const kerning = kerningOf(pairs);
    const index = kernIndex(kerning);
    const { bytes } = exportFont({
      ...fontDocument(glyphs, { ...DEFAULT_FONT_INFO, unitsPerEm: 1000 }),
      kerning,
    });
    const font = new Font(new Face(new Blob(bytes)));

    for (const left of LETTERS) {
      for (const right of LETTERS) {
        const [first] = set(font, left + right);
        expect((first?.advance ?? 0) - 500, `${left} ${right}`).toBe(kernValue(index, left, right));
      }
    }
  });

  it("is, for the pair every kind of rule takes in, the most particular of them", () => {
    const index = kernIndex(kerningOf(PAIRS));
    expect(kernValue(index, "A", "V")).toBe(-10);
    expect(kernValue(index, "A", "W")).toBe(-30);
    expect(kernValue(index, "B", "V")).toBe(-50);
    expect(kernValue(index, "B", "W")).toBe(-70);
  });
});
