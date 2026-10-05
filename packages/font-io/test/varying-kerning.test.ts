import {
  DEFAULT_FONT_INFO,
  type FontDocument,
  type Kerning,
  contour,
  counterIds,
  fontDocument,
  glyph,
  groupKey,
  node,
} from "@typewright/font-model";
import { Blob, Face, Font } from "harfbuzzjs";
import { describe, expect, it } from "vitest";

import { exportVariableTrueType } from "../src/variable-truetype.js";
import { type VariableMaster, exportVariableFont } from "../src/variable.js";
import { set } from "./real-fonts.js";

/**
 * Kerning that is not the same in every master of a variable font.
 *
 * A bold is kerned more tightly than its light, or kerns a pair the light
 * leaves alone. The font was kerned as its default master is at every weight;
 * it is kerned at each master's place as that master is, and between two of
 * them by what lies between — each pair's value at the default, and what it
 * changes by, kept in a store beside the font's classes and pointed at from
 * the pair. HarfBuzz is asked, since it did not write any of it.
 */

const ids = counterIds("vk");
const WEIGHT = { tag: "wght", name: "Weight", min: 400, default: 400, max: 900 };
const LETTERS = ["A", "B", "T", "V", "W"];

const drawn = (width: number) =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: 0 }),
      node(ids.node(), { x: width, y: 0 }),
      node(ids.node(), { x: width / 2, y: 100 }),
    ],
    true,
  );

/** A and B open alike on the left of a pair; V and W close alike on the right. */
const GROUPS = {
  firstGroups: { round: ["A", "B"] },
  secondGroups: { slanted: ["V", "W"] },
};
const L = groupKey("round");
const R = groupKey("slanted");

function master(name: string, weight: number, kerning: Kerning): VariableMaster {
  const document: FontDocument = {
    ...fontDocument(
      [
        glyph(".notdef", { advance: 500 }),
        ...LETTERS.map((letter) =>
          glyph(letter, {
            unicodes: [letter.charCodeAt(0)],
            advance: 500,
            contours: [drawn(weight / 4)],
          }),
        ),
      ],
      { ...DEFAULT_FONT_INFO, unitsPerEm: 1000 },
    ),
    kerning,
  };
  return { name, location: { wght: weight }, document };
}

/** How far the second of two letters is pulled towards the first, at a weight. */
function kernAt(font: Font, pair: string, weight: number): number {
  const [together] = set(font, pair, [], { wght: weight });
  const [alone] = set(font, pair.charAt(0), [], { wght: weight });
  return (together?.advance ?? 0) - (alone?.advance ?? 0);
}

describe.each([
  ["cubic outlines", exportVariableFont],
  ["quadratic outlines", exportVariableTrueType],
] as const)("kerning that changes with the weight, in a font with %s", (_, exporter) => {
  // The regular kerns the two groups against each other. The bold kerns them
  // more, pulls T under A by a pair of its own, and lets B and W alone, which
  // the groups would kern.
  const regular = master("Regular", 400, { ...GROUPS, pairs: { [L]: { [R]: -40 } } });
  const bold = master("Bold", 900, {
    ...GROUPS,
    pairs: { [L]: { [R]: -90 }, A: { T: -60 }, B: { W: 0 } },
  });
  const made = exporter([WEIGHT], [regular, bold], []);
  const font = new Font(new Face(new Blob(made.bytes)));

  it("says nothing of it, there being nothing left behind", () => {
    expect(made.warnings).toEqual([]);
  });

  it("is each master's kerning at that master's weight", () => {
    // Group against group, which is a matrix by class.
    expect(kernAt(font, "AV", 400)).toBe(-40);
    expect(kernAt(font, "AV", 900)).toBe(-90);
    expect(kernAt(font, "BV", 900)).toBe(-90);
    // A pair only the bold names: nothing at the regular, and all of it there.
    expect(kernAt(font, "AT", 400)).toBe(0);
    expect(kernAt(font, "AT", 900)).toBe(-60);
    // A pair the bold names to say it is not kerned, over groups that are: as
    // the groups kern it where the pair is not named, and not at all where it is.
    expect(kernAt(font, "BW", 400)).toBe(-40);
    expect(kernAt(font, "BW", 900)).toBe(0);
    // And a pair nobody kerns, anywhere.
    expect(kernAt(font, "TT", 400)).toBe(0);
    expect(kernAt(font, "TT", 900)).toBe(0);
  });

  it("is what lies between them, between them", () => {
    expect(kernAt(font, "AV", 650)).toBe(-65);
    expect(kernAt(font, "AT", 650)).toBe(-30);
    expect(kernAt(font, "BW", 650)).toBe(-20);
  });

  it("is one kerning, written once, where the masters are kerned alike", () => {
    const same = exporter([WEIGHT], [regular, master("Bold", 900, regular.document.kerning)], []);
    expect(same.warnings).toEqual([]);
    const plain = new Font(new Face(new Blob(same.bytes)));
    expect(kernAt(plain, "AV", 400)).toBe(-40);
    expect(kernAt(plain, "AV", 900)).toBe(-40);
    // Nothing that varies, and so no store for it to be kept in: a smaller font.
    expect(same.bytes.byteLength).toBeLessThan(made.bytes.byteLength);
  });

  it("is the default master's, and says so, where the masters' groups are not the same", () => {
    const other = master("Bold", 900, {
      firstGroups: { round: ["A"] },
      secondGroups: GROUPS.secondGroups,
      pairs: { [L]: { [R]: -90 } },
    });
    const out = exporter([WEIGHT], [regular, other], []);
    expect(out.warnings).toEqual([
      "the masters do not have the same kerning groups, and the font is kerned as Regular is " +
        "at every weight and width",
    ]);
    const plain = new Font(new Face(new Blob(out.bytes)));
    expect(kernAt(plain, "AV", 900)).toBe(-40);
  });
});
