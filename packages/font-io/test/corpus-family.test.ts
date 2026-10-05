import {
  type FontDocument,
  counterIds,
  defaultLocation,
  kernIndex,
  kernValue,
} from "@typewright/font-model";
import { Blob, Face, Font } from "harfbuzzjs";
import { beforeAll, describe, expect, it } from "vitest";

import { type FamilyImport, familyFiles, readFamily } from "../src/family.js";
import { exportVariableTrueType } from "../src/variable-truetype.js";
import { type VariableResult, exportVariableFont } from "../src/variable.js";
import { entryBytes } from "../src/zip.js";
import { filesUnder, set } from "./real-fonts.js";

/**
 * A real family of sources, taken round: MutatorSans, which is what every tool
 * that reads a designspace is tried on.
 *
 * Two axes with a master at each corner, three more drawn as layers of one of
 * them — a few glyphs each, at places between the corners — rules that swap a
 * glyph for another over part of the designspace, and sixteen named styles.
 * Read as its makers wrote it, by Glyphs-and-RoboFont-shaped tools and not by
 * this one.
 *
 * What is asked: that all of it is read; that written out as a family again it
 * is read the same; and that a variable font made of it is, at each corner of
 * its designspace, the master that was drawn there — which HarfBuzz is asked,
 * since it did not make the font.
 */

const CORNERS = [
  { name: "LightCondensed", at: { wdth: 0, wght: 0 } },
  { name: "BoldCondensed", at: { wdth: 0, wght: 1000 } },
  { name: "LightWide", at: { wdth: 1000, wght: 0 } },
  { name: "BoldWide", at: { wdth: 1000, wght: 1000 } },
] as const;

describe("MutatorSans, read from its sources", () => {
  let family: FamilyImport;

  beforeAll(() => {
    const read = readFamily(filesUnder("mutator-sans"), counterIds("in"));
    if ("reason" in read) throw new Error(read.reason);
    family = read;
  });

  /** The masters drawn whole, by the name the test knows them by. */
  const whole = (name: string): FontDocument => {
    const found = family.masters.find((m) => m.sparse === undefined && m.name === name);
    if (found === undefined) throw new Error(`no master ${name}`);
    return found.document;
  };

  it("is read whole, with nothing to say about it", () => {
    expect(family.warnings).toEqual([]);
    expect(family.axes.map((a) => [a.tag, a.min, a.default, a.max])).toEqual([
      ["wdth", 0, 0, 1000],
      ["wght", 0, 0, 1000],
    ]);
    expect(family.instances).toHaveLength(16);
    expect(family.rules.map((r) => r.swaps)).toEqual([[["I", "I.narrow"]], [["S", "S.closed"]]]);
  });

  it("has a master at each corner, and three drawn as layers of the first", () => {
    const drawn = family.masters.filter((m) => m.sparse === undefined);
    expect(drawn.map((m) => [m.name, m.location])).toEqual(CORNERS.map((c) => [c.name, c.at]));
    for (const m of drawn) expect(m.document.glyphOrder, m.name).toHaveLength(49);

    const layers = family.masters.filter((m) => m.sparse !== undefined);
    expect(
      layers.map((m) => [m.sparse?.layer, m.sparse?.of, m.document.glyphOrder.length]),
    ).toEqual([
      ["support.crossbar", 0, 4],
      ["support.S.wide", 0, 2],
      ["support.S.middle", 0, 1],
    ]);
    // The sketches behind the drawing are carried, and are not masters.
    expect(drawn[0]?.layers.map((l) => l.name)).toContain("background");
  });

  it("is read the same again, written out as a family", () => {
    const files = familyFiles(family.axes, family.masters, family.instances, {
      rules: family.rules,
      rulesProcessing: family.rulesProcessing,
      kept: family.kept,
    }).map((e) => ({ path: e.path, bytes: entryBytes(e) }));
    const again = readFamily(files, counterIds("again"));
    if ("reason" in again) throw new Error(again.reason);

    expect(again.warnings).toEqual([]);
    expect(again.axes).toEqual(family.axes);
    expect(again.rules.map((r) => [r.name, r.conditionSets, r.swaps])).toEqual(
      family.rules.map((r) => [r.name, r.conditionSets, r.swaps]),
    );
    expect(again.instances.map((i) => [i.name, i.location])).toEqual(
      family.instances.map((i) => [i.name, i.location]),
    );
    expect(again.masters.map((m) => [m.name, m.location, m.sparse?.layer])).toEqual(
      family.masters.map((m) => [m.name, m.location, m.sparse?.layer]),
    );

    // Each master the same font, to the last point. These sources are not on
    // whole units: the layers were made by a tool that worked them out between
    // the masters, and hold points at 45.68544. Saved, they once came back at
    // 46 — somebody's sources, changed by being opened and kept.
    const plain = (d: FontDocument): string =>
      JSON.stringify(d, (key, value: unknown) => (key === "id" ? undefined : value));
    for (const [i, m] of family.masters.entries()) {
      expect(plain(again.masters[i]!.document), m.name).toBe(plain(m.document));
    }
  });

  describe.each([
    ["with cubic outlines", exportVariableFont],
    ["with quadratic outlines", exportVariableTrueType],
  ] as const)("as a variable font %s", (_, exporter) => {
    let made: VariableResult;
    let font: Font;

    beforeAll(() => {
      // The default first and whole: everything in the file is a delta from it.
      const home = defaultLocation(family.axes);
      const first = (m: (typeof family.masters)[number]): boolean =>
        m.sparse === undefined &&
        family.axes.every((a) => (m.location[a.tag] ?? a.default) === home[a.tag]);
      const ordered = [...family.masters.filter(first), ...family.masters.filter((m) => !first(m))];
      made = exporter(
        family.axes,
        ordered.map((m) => ({
          name: m.name,
          location: m.location,
          document: m.document,
          sparse: m.sparse !== undefined,
        })),
        family.instances,
        { rules: family.rules, rulesProcessing: family.rulesProcessing },
      );
      font = new Font(new Face(new Blob(made.bytes)));
    });

    it("is made with every glyph varying, and nothing to say", () => {
      expect(made.warnings).toEqual([]);
      expect(made.notVarying).toEqual([]);
    });

    it.each(CORNERS)("is $name at its corner", ({ name, at }) => {
      const master = whole(name);
      // Letters with nothing between them that the kerning or the rules touch.
      for (const letter of ["A", "V", "H", "O", "E"]) {
        const [placed] = set(font, letter, [], at);
        expect(placed?.name, letter).toBe(letter);
        expect(placed?.advance, `${letter} at ${name}`).toBe(master.glyphs[letter]?.advance);
      }
    });

    /** How far HarfBuzz pulls the second of two letters towards the first, at a place. */
    const kernAt = (pair: string, at: Readonly<Record<string, number>>): number => {
      const [together] = set(font, pair, [], at);
      const [alone] = set(font, pair.charAt(0), [], at);
      return (together?.advance ?? 0) - (alone?.advance ?? 0);
    };
    // But I and S, which the family's rules swap for another glyph over part of
    // its designspace: set there, the letter is not the glyph its kerning names.
    const CAPITALS = [..."ABCDEFGHJKLMNOPQRTUVWXYZ"];

    it.each(CORNERS)(
      "is kerned as $name is at its corner, every pair of capitals",
      ({ name, at }) => {
        // The masters are not kerned alike: the bold condensed pulls V fifty
        // units under A by a pair of its own, and the light condensed does not
        // kern the two at all. The font was once kerned as its default master
        // is, everywhere; it is kerned at each corner as the master drawn there.
        const index = kernIndex(whole(name).kerning);
        const wrong: string[] = [];
        let kerned = 0;
        for (const left of CAPITALS) {
          for (const right of CAPITALS) {
            const want = kernValue(index, left, right);
            if (want !== 0) kerned += 1;
            const got = kernAt(left + right, at);
            if (got !== want) wrong.push(`${left}${right}: ${String(got)}, not ${String(want)}`);
          }
        }
        expect(wrong).toEqual([]);
        expect(kerned, `pairs ${name} kerns`).toBeGreaterThan(0);
      },
    );

    it("is kerned between two masters by what lies between their kerning", () => {
      // Half way from the light condensed, which pulls V fifteen under A by the
      // group A is in, to the bold condensed, which pulls it fifty by a pair of
      // its own: two kinds of rule, and one value changing between them.
      const light = kernValue(kernIndex(whole("LightCondensed").kerning), "A", "V");
      const bold = kernValue(kernIndex(whole("BoldCondensed").kerning), "A", "V");
      expect([light, bold]).toEqual([-15, -50]);
      expect(kernAt("AV", { wdth: 0, wght: 0 })).toBe(light);
      expect(kernAt("AV", { wdth: 0, wght: 1000 })).toBe(bold);
      expect(
        Math.abs(kernAt("AV", { wdth: 0, wght: 500 }) - (light + bold) / 2),
      ).toBeLessThanOrEqual(1);
    });

    it("swaps a glyph where its rules say, and nowhere else", () => {
      // The serifs of I fold away where the width is narrow.
      expect(set(font, "I", [], { wdth: 100, wght: 0 }).map((g) => g.name)).toEqual(["I.narrow"]);
      expect(set(font, "I", [], { wdth: 800, wght: 0 }).map((g) => g.name)).toEqual(["I"]);
      // And S closes where the weight is light, at any width.
      expect(set(font, "S", [], { wdth: 800, wght: 200 }).map((g) => g.name)).toEqual(["S.closed"]);
      expect(set(font, "S", [], { wdth: 800, wght: 900 }).map((g) => g.name)).toEqual(["S"]);
    });
  });
});
