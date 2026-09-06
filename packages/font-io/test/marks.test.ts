import { addAnchor, anchor, glyph, rectContour, counterIds } from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { layoutTable } from "../src/layout.js";
import { compileMarks } from "../src/marks.js";

/**
 * Mark attachment, read back out of the bytes.
 *
 * The tables are offsets into offsets, so the assertions walk them the way a
 * shaper does rather than checking lengths: a subtable whose byte count is right
 * and whose anchor offsets are wrong is exactly the bug this has to catch.
 */

const ids = counterIds("m");

const box = (w: number, h: number) => rectContour(ids, { minX: 0, minY: 0, maxX: w, maxY: h });

/** A letter offering a place on top, and an accent that attaches by one. */
function letter(name = "a") {
  return addAnchor(
    glyph(name, { advance: 500, contours: [box(400, 600)] }),
    anchor(`${name}-top`, "top", { x: 250, y: 620 }),
  );
}

function accent(name = "acutecomb") {
  return addAnchor(
    glyph(name, { advance: 0, contours: [box(80, 60)] }),
    anchor(`${name}-mark`, "_top", { x: 40, y: 0 }),
  );
}

const u16 = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const i16 = (b: Uint8Array, at: number) => {
  const v = u16(b, at);
  return v >= 0x8000 ? v - 0x10000 : v;
};

/** Every glyph a coverage table covers, in the order it gives them. */
function covered(bytes: Uint8Array, at: number): number[] {
  const format = u16(bytes, at);
  const count = u16(bytes, at + 2);
  const out: number[] = [];
  if (format === 1) {
    for (let i = 0; i < count; i++) out.push(u16(bytes, at + 4 + i * 2));
    return out;
  }
  for (let i = 0; i < count; i++) {
    const first = u16(bytes, at + 4 + i * 6);
    const last = u16(bytes, at + 6 + i * 6);
    for (let g = first; g <= last; g++) out.push(g);
  }
  return out;
}

const ORDER = new Map([
  ["a", 1],
  ["acutecomb", 2],
  ["gravecomb", 3],
]);
const idOf = (name: string) => ORDER.get(name);

describe("compiling anchors into GPOS", () => {
  it("writes nothing at all when no glyph attaches by an anchor", () => {
    // A letter's `top` on its own is a place for a component to land, which is
    // the editor's business and not a rule a shaper can use.
    const out = compileMarks([letter()], idOf);
    expect(out.lookups).toEqual([]);
    expect(out.gdef).toHaveLength(0);
  });

  it("writes a mark-to-base lookup, and the anchors it was given", () => {
    const out = compileMarks([letter(), accent()], idOf);

    expect(out.features).toEqual(["mark"]);
    expect(out.lookups[0]!.type).toBe(4);

    const sub = out.lookups[0]!.subtables[0]!;
    expect(u16(sub, 0)).toBe(1); // format 1
    expect(u16(sub, 6)).toBe(1); // one class: `top`

    // The accent is the mark; the letter is the base.
    expect(covered(sub, u16(sub, 2))).toEqual([2]);
    expect(covered(sub, u16(sub, 4))).toEqual([1]);

    // The mark's own anchor, through the MarkArray.
    const markArrayAt = u16(sub, 8);
    expect(u16(sub, markArrayAt)).toBe(1);
    expect(u16(sub, markArrayAt + 2)).toBe(0); // class 0
    const markAnchorAt = markArrayAt + u16(sub, markArrayAt + 4);
    expect(u16(sub, markAnchorAt)).toBe(1); // anchor format 1
    expect(i16(sub, markAnchorAt + 2)).toBe(40);
    expect(i16(sub, markAnchorAt + 4)).toBe(0);

    // And the letter's, through the BaseArray.
    const baseArrayAt = u16(sub, 10);
    expect(u16(sub, baseArrayAt)).toBe(1);
    const baseAnchorAt = baseArrayAt + u16(sub, baseArrayAt + 2);
    expect(i16(sub, baseAnchorAt + 2)).toBe(250);
    expect(i16(sub, baseAnchorAt + 4)).toBe(620);
  });

  it("gives a base with no anchor for a class a null offset there", () => {
    // Two classes, and a letter that only offers one of them.
    const ogonek = addAnchor(
      glyph("gravecomb", { advance: 0 }),
      anchor("g1", "_ogonek", { x: 5, y: 0 }),
    );
    const out = compileMarks([letter(), accent(), ogonek], idOf);

    const sub = out.lookups[0]!.subtables[0]!;
    expect(u16(sub, 6)).toBe(2);

    const baseArrayAt = u16(sub, 10);
    const offsets = [u16(sub, baseArrayAt + 2), u16(sub, baseArrayAt + 4)];
    // One real anchor and one null: the letter takes a `top` and no `ogonek`.
    expect(offsets.filter((o) => o === 0)).toHaveLength(1);
    expect(offsets.filter((o) => o !== 0)).toHaveLength(1);
  });

  it("stacks a mark on a mark when the accent offers a place of its own", () => {
    const stackable = addAnchor(accent(), anchor("acute-top", "top", { x: 40, y: 80 }));
    const out = compileMarks([letter(), stackable], idOf);

    expect(out.features).toEqual(["mark", "mkmk"]);
    expect(out.lookups[1]!.type).toBe(6);

    // The accent is in both: a mark in each, and the thing stacked onto in the
    // second. The letter is only a base.
    const mkmk = out.lookups[1]!.subtables[0]!;
    expect(covered(mkmk, u16(mkmk, 2))).toEqual([2]);
    expect(covered(mkmk, u16(mkmk, 4))).toEqual([2]);
    expect(covered(out.lookups[0]!.subtables[0]!, u16(out.lookups[0]!.subtables[0]!, 4))).toEqual([
      1,
    ]);
  });

  it("declares the glyph classes, because a shaper needs them to apply this", () => {
    const out = compileMarks([letter(), accent()], idOf);

    expect(u16(out.gdef, 0)).toBe(1); // version 1.0
    expect(u16(out.gdef, 4)).toBe(12); // class definitions follow the header

    const classes = out.gdef.subarray(12);
    const format = u16(classes, 0);
    // Whichever format it took, the accent is a mark (3) and the letter is a
    // base (1).
    const classOf = (id: number): number => {
      if (format === 1) {
        const start = u16(classes, 2);
        const count = u16(classes, 4);
        return id < start || id >= start + count ? 0 : u16(classes, 6 + (id - start) * 2);
      }
      const count = u16(classes, 2);
      for (let i = 0; i < count; i++) {
        const first = u16(classes, 4 + i * 6);
        const last = u16(classes, 6 + i * 6);
        if (id >= first && id <= last) return u16(classes, 8 + i * 6);
      }
      return 0;
    };

    expect(classOf(1)).toBe(1);
    expect(classOf(2)).toBe(3);
  });

  it("uses one anchor of a mark that has several, and says which", () => {
    const twice = addAnchor(accent(), anchor("second", "_bottom", { x: 10, y: 20 }));
    const out = compileMarks([letter(), twice], idOf);

    expect(out.warnings[0]).toContain("acutecomb");
    expect(out.warnings[0]).toContain("_top");
  });

  it("leaves out a glyph the font does not have", () => {
    const out = compileMarks([letter(), accent(), letter("missing")], idOf);
    // `missing` has no id, so it is in no coverage table.
    expect(covered(out.lookups[0]!.subtables[0]!, u16(out.lookups[0]!.subtables[0]!, 4))).toEqual([
      1,
    ]);
  });
});

describe("the whole table, walked the way a shaper walks it", () => {
  it("finds the mark anchor through the header, the lookup list and the subtable", () => {
    // The subtable's own offsets are checked above; this is the other half —
    // that the table around it points at the right place. Everything between a
    // font's GPOS header and an anchor is offsets into offsets, and a length
    // that is right with an offset that is wrong reads as a font with no
    // attachment rather than as a broken one.
    const out = compileMarks([letter(), accent()], idOf);
    const table = layoutTable(
      out.features.map((tag, i) => ({ tag, lookups: [i] })),
      out.lookups,
    );

    const lookupListAt = u16(table, 8);
    expect(u16(table, lookupListAt)).toBe(1);

    const lookupAt = lookupListAt + u16(table, lookupListAt + 2);
    expect(u16(table, lookupAt)).toBe(4); // mark-to-base
    expect(u16(table, lookupAt + 4)).toBe(1); // one subtable

    const subAt = lookupAt + u16(table, lookupAt + 6);
    expect(u16(table, subAt)).toBe(1); // subtable format 1

    const markArrayAt = subAt + u16(table, subAt + 8);
    const anchorAt = markArrayAt + u16(table, markArrayAt + 4);
    expect(i16(table, anchorAt + 2)).toBe(40);
    expect(i16(table, anchorAt + 4)).toBe(0);

    // And the feature that names it is `mark`, spelled as a tag.
    const featureListAt = u16(table, 6);
    const tag = String.fromCharCode(...table.subarray(featureListAt + 2, featureListAt + 6));
    expect(tag).toBe("mark");
  });
});
