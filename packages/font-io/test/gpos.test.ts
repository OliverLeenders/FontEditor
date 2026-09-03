import {
  EMPTY_KERNING,
  type Kerning,
  contour,
  counterIds,
  fontDocument,
  glyph,
  groupKey,
  kernIndex,
  kernValue,
  node,
  setKern,
  setKernGroup,
  setKerning,
} from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { importFont } from "../src/import.js";
import { buildKerningGpos, classDef, coverage } from "../src/gpos.js";
import { opentype } from "../src/opentype.js";
import { tableChecksum, withTable } from "../src/sfnt.js";

const ids = counterIds();

const box = (name: string, code: number) =>
  glyph(name, {
    unicodes: [code],
    advance: 500,
    contours: [
      contour(
        ids.contour(),
        [
          node(ids.node(), { x: 50, y: 0 }),
          node(ids.node(), { x: 450, y: 0 }),
          node(ids.node(), { x: 450, y: 700 }),
        ],
        true,
      ),
    ],
  });

const INFO = {
  familyName: "Kern Test",
  styleName: "Regular",
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  xHeight: 500,
  capHeight: 700,
};

/** O and Q on the left, A and B on the right: one class rule and one exception. */
function kerned(): Kerning {
  let k = setKernGroup(EMPTY_KERNING, "first", "O", ["O", "Q"]);
  k = setKernGroup(k, "second", "A", ["A", "B"]);
  k = setKern(k, groupKey("O"), groupKey("A"), -40);
  k = setKern(k, "T", "A", -95);
  return k;
}

const document = () =>
  setKerning(
    fontDocument(
      [
        glyph(".notdef", { advance: 500 }),
        box("O", 0x4f),
        box("Q", 0x51),
        box("T", 0x54),
        box("A", 0x41),
        box("B", 0x42),
      ],
      INFO,
    ),
    kerned(),
  );

/**
 * Parse an export back with opentype.js.
 *
 * It cannot write GPOS but it can read it, so its parser is an implementation of
 * the specification that is not ours — which is the only kind of check worth
 * much on a binary format.
 */
function reread(doc = document()) {
  const font = opentype.parse(exportFont(doc).bytes);
  font.position.init();
  return font;
}

function idOf(font: ReturnType<typeof reread>, name: string): number {
  for (let i = 0; i < font.glyphs.length; i++) {
    if (font.glyphs.get(i).name === name) return i;
  }
  throw new Error(`no glyph ${name}`);
}

describe("the exported font kerns", () => {
  it("is read back by a GPOS parser that is not ours", () => {
    const font = reread();
    expect(font.getKerningValue(idOf(font, "O"), idOf(font, "A"))).toBe(-40);
  });

  it("applies a class rule to every member of both groups", () => {
    const font = reread();
    for (const left of ["O", "Q"]) {
      for (const right of ["A", "B"]) {
        expect(font.getKerningValue(idOf(font, left), idOf(font, right))).toBe(-40);
      }
    }
  });

  it("lets an exception beat the class it overlaps", () => {
    const font = reread();
    expect(font.getKerningValue(idOf(font, "T"), idOf(font, "A"))).toBe(-95);
  });

  it("leaves unkerned pairs at zero", () => {
    const font = reread();
    expect(font.getKerningValue(idOf(font, "A"), idOf(font, "O"))).toBe(0);
    expect(font.getKerningValue(idOf(font, "B"), idOf(font, "B"))).toBe(0);
  });

  it("writes no GPOS at all for a font with no kerning", () => {
    const plain = fontDocument([glyph(".notdef", { advance: 500 }), box("A", 0x41)], INFO);
    const font = opentype.parse(exportFont(plain).bytes);
    // A kern feature matching nothing is worse than no feature: it stops a
    // shaper falling back to anything else.
    expect(font.tables.gpos).toBeUndefined();
  });

  it("still parses in every other respect", () => {
    const font = reread();
    expect(font.unitsPerEm).toBe(1000);
    expect(font.glyphs.length).toBe(6);
    expect(font.charToGlyph("A").name).toBe("A");
  });
});

describe("buildKerningGpos", () => {
  it("is empty when there is nothing to say", () => {
    expect(buildKerningGpos(kernIndex(EMPTY_KERNING), () => 0)).toHaveLength(0);
  });

  it("skips a group whose glyphs are not in the font", () => {
    let k = setKernGroup(EMPTY_KERNING, "first", "ghost", ["nope"]);
    k = setKernGroup(k, "second", "A", ["A"]);
    k = setKern(k, groupKey("ghost"), groupKey("A"), -20);
    expect(buildKerningGpos(kernIndex(k), (n) => (n === "A" ? 1 : undefined))).toHaveLength(0);
  });
});

describe("coverage", () => {
  it("uses the list form for scattered glyphs", () => {
    const bytes = coverage([9, 3, 40]);
    expect(bytes[1]).toBe(1);
    expect(bytes[3]).toBe(3);
    expect(bytes[5]).toBe(3);
  });

  it("uses the range form when it is smaller", () => {
    const bytes = coverage(Array.from({ length: 40 }, (_, i) => i + 10));
    expect(bytes[1]).toBe(2);
    expect(bytes[3]).toBe(1);
  });

  it("drops duplicates", () => {
    expect(coverage([5, 5, 5])[3]).toBe(1);
  });
});

describe("classDef", () => {
  it("collapses consecutive glyphs of one class into a single range", () => {
    const bytes = classDef(
      new Map([
        [1, 1],
        [2, 1],
        [3, 1],
        [10, 2],
      ]),
    );
    expect(bytes[1]).toBe(2);
    expect(bytes[3]).toBe(2);
  });
});

describe("withTable", () => {
  const font = (): Uint8Array => new Uint8Array(exportFont(document()).bytes);

  it("keeps the file readable after inserting a table", () => {
    const out = withTable(font(), "TEST", new Uint8Array([1, 2, 3, 4]));
    const parsed = opentype.parse(out.buffer.slice(0) as ArrayBuffer);
    expect(parsed.glyphs.length).toBe(6);
  });

  it("sorts the directory by tag, as the format requires", () => {
    const out = withTable(font(), "ZZZZ", new Uint8Array([0]));
    const view = new DataView(out.buffer);
    const tags: string[] = [];
    for (let i = 0; i < view.getUint16(4); i++) {
      const at = 12 + i * 16;
      tags.push(String.fromCharCode(out[at]!, out[at + 1]!, out[at + 2]!, out[at + 3]!));
    }
    expect([...tags].sort()).toEqual(tags);
  });

  it("records a checksum that matches the bytes it wrote", () => {
    const out = withTable(font(), "TEST", new Uint8Array([9, 9, 9, 9]));
    const view = new DataView(out.buffer);

    for (let i = 0; i < view.getUint16(4); i++) {
      const at = 12 + i * 16;
      const tag = String.fromCharCode(out[at]!, out[at + 1]!, out[at + 2]!, out[at + 3]!);
      const offset = view.getUint32(at + 8);
      const length = view.getUint32(at + 12);
      const data = out.subarray(offset, offset + length);

      if (tag === "head") {
        // head is the one exception, and deliberately so: its checksum is
        // defined over its own bytes with checkSumAdjustment zeroed, because
        // that field is a checksum of the whole file and would otherwise
        // depend on itself.
        const zeroed = data.slice();
        new DataView(zeroed.buffer).setUint32(8, 0);
        expect(view.getUint32(at + 4)).toBe(tableChecksum(zeroed));
        continue;
      }
      expect(view.getUint32(at + 4)).toBe(tableChecksum(data));
    }
  });

  it("makes the whole-file checksum come out to the constant the format names", () => {
    const out = withTable(font(), "TEST", new Uint8Array([1]));
    const view = new DataView(out.buffer);

    let headAt = 0;
    for (let i = 0; i < view.getUint16(4); i++) {
      const at = 12 + i * 16;
      const tag = String.fromCharCode(out[at]!, out[at + 1]!, out[at + 2]!, out[at + 3]!);
      if (tag === "head") headAt = view.getUint32(at + 8);
    }

    const adjustment = view.getUint32(headAt + 8);
    const copy = out.slice();
    new DataView(copy.buffer).setUint32(headAt + 8, 0);
    expect((tableChecksum(copy) + adjustment) >>> 0).toBe(0xb1b0afba);
  });

  it("replaces a table of the same tag rather than adding a second", () => {
    const once = withTable(font(), "TEST", new Uint8Array([1, 2, 3, 4]));
    const twice = withTable(once, "TEST", new Uint8Array([5, 6, 7, 8]));
    expect(new DataView(twice.buffer).getUint16(4)).toBe(new DataView(once.buffer).getUint16(4));
  });

  it("removes a table when given nothing to write", () => {
    const added = withTable(font(), "TEST", new Uint8Array([1]));
    const removed = withTable(added, "TEST", new Uint8Array(0));
    const before = new DataView(font().buffer).getUint16(4);
    expect(new DataView(removed.buffer).getUint16(4)).toBe(before);
  });
});

describe("kerning survives a round trip", () => {
  const back = () => importFont(exportFont(document()).bytes, counterIds("r")).document;

  it("comes back with the same values for the same pairs", () => {
    const index = kernIndex(back().kerning);
    // The group rule reaches every member on both sides.
    expect(kernValue(index, "O", "A")).toBe(-40);
    expect(kernValue(index, "Q", "B")).toBe(-40);
    // The exception still beats it.
    expect(kernValue(index, "T", "A")).toBe(-95);
  });

  it("recovers the classes as groups rather than as loose pairs", () => {
    const kerning = back().kerning;
    const groups = Object.values(kerning.firstGroups);
    expect(groups.length).toBeGreaterThan(0);
    // O and Q were one class in the file and must be one group again, or the
    // next edit would move only the letter that was touched.
    expect(groups.some((g) => g.includes("O") && g.includes("Q"))).toBe(true);
  });

  it("names recovered groups, since a font carries no names for them", () => {
    const kerning = back().kerning;
    expect(Object.keys(kerning.firstGroups)[0]).toMatch(/^kern1\./);
    expect(Object.keys(kerning.secondGroups)[0]).toMatch(/^kern2\./);
  });

  it("brings back nothing for a font that kerns nothing", () => {
    const plain = fontDocument([glyph(".notdef", { advance: 500 }), box("A", 0x41)], INFO);
    const kerning = importFont(exportFont(plain).bytes, counterIds("p")).document.kerning;
    expect(kerning).toEqual(EMPTY_KERNING);
  });

  it("survives a second trip without multiplying groups", () => {
    const once = back();
    const twice = importFont(exportFont(once).bytes, counterIds("s")).document;
    expect(Object.keys(twice.kerning.firstGroups).length).toBe(
      Object.keys(once.kerning.firstGroups).length,
    );
    expect(kernValue(kernIndex(twice.kerning), "O", "A")).toBe(-40);
  });
});
