import { describe, expect, it } from "vitest";

import { layoutTable, mergeFeatures, shiftFeatures } from "../src/layout.js";

/**
 * The scaffolding GSUB and GPOS share: a script list, a feature list and a
 * lookup list.
 *
 * Read back here with a small reader written against the spec rather than
 * against the writer, so a mistake made in both directions cannot pass.
 */

const subtable = (byte: number) => Uint8Array.of(0, byte);

function read16(bytes: Uint8Array, at: number): number {
  return (bytes[at]! << 8) | bytes[at + 1]!;
}

/** The tags in the feature list, in the order the table lists them. */
function featureTags(table: Uint8Array): string[] {
  const featureListAt = read16(table, 6);
  const count = read16(table, featureListAt);
  const tags: string[] = [];
  for (let i = 0; i < count; i++) {
    const record = featureListAt + 2 + i * 6;
    tags.push(String.fromCharCode(...table.slice(record, record + 4)));
  }
  return tags;
}

/** Which lookups a feature names, by its position in the feature list. */
function lookupsOfFeature(table: Uint8Array, index: number): number[] {
  const featureListAt = read16(table, 6);
  const record = featureListAt + 2 + index * 6;
  const featureAt = featureListAt + read16(table, record + 4);
  const count = read16(table, featureAt + 2);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(read16(table, featureAt + 4 + i * 2));
  return out;
}

describe("wrapping lookups in a layout table", () => {
  it("writes a version, and the three lists in the order the format wants", () => {
    const table = layoutTable(
      [{ tag: "kern", lookups: [0] }],
      [{ type: 2, subtables: [subtable(1)] }],
    );

    expect(read16(table, 0)).toBe(1);
    expect(read16(table, 2)).toBe(0);
    // Script list, feature list, lookup list: each after the one before it.
    expect(read16(table, 4)).toBeLessThan(read16(table, 6));
    expect(read16(table, 6)).toBeLessThan(read16(table, 8));
  });

  it("lists features in tag order, whatever order they arrived in", () => {
    // Not a tidiness: a shaper is entitled to binary-search the list, and an
    // unsorted one reads as a font with features missing.
    const table = layoutTable(
      [
        { tag: "liga", lookups: [1] },
        { tag: "kern", lookups: [0] },
        { tag: "calt", lookups: [1] },
      ],
      [
        { type: 2, subtables: [subtable(1)] },
        { type: 1, subtables: [subtable(2)] },
      ],
    );
    expect(featureTags(table)).toEqual(["calt", "kern", "liga"]);
    // And each one still points at its own lookups after the sort.
    expect(lookupsOfFeature(table, featureTags(table).indexOf("kern"))).toEqual([0]);
    expect(lookupsOfFeature(table, featureTags(table).indexOf("liga"))).toEqual([1]);
  });

  it("writes each lookup's type, flags and subtable count", () => {
    const table = layoutTable(
      [{ tag: "kern", lookups: [0] }],
      [{ type: 2, flags: 8, subtables: [subtable(1), subtable(2)] }],
    );
    const lookupListAt = read16(table, 8);
    expect(read16(table, lookupListAt)).toBe(1);
    const lookupAt = lookupListAt + read16(table, lookupListAt + 2);
    expect(read16(table, lookupAt)).toBe(2);
    // IgnoreMarks, which is what keeps an accent from breaking a kern pair.
    expect(read16(table, lookupAt + 2)).toBe(8);
    expect(read16(table, lookupAt + 4)).toBe(2);
  });

  it("writes nothing at all when there is nothing to say", () => {
    // A table whose feature list matches nothing is worse than no table: it
    // tells a shaper there is something to apply and stops it falling back.
    expect(layoutTable([], [{ type: 2, subtables: [subtable(1)] }])).toHaveLength(0);
    expect(layoutTable([{ tag: "kern", lookups: [0] }], [])).toHaveLength(0);
    expect(
      layoutTable([{ tag: "kern", lookups: [] }], [{ type: 2, subtables: [subtable(1)] }]),
    ).toHaveLength(0);
    expect(layoutTable([{ tag: "kern", lookups: [0] }], [{ type: 2, subtables: [] }])).toHaveLength(
      0,
    );
  });
});

describe("putting two sets of features together", () => {
  it("gathers the lookups of a tag both sides use", () => {
    expect(
      mergeFeatures([{ tag: "kern", lookups: [0] }], [{ tag: "kern", lookups: [3, 4] }]),
    ).toEqual([{ tag: "kern", lookups: [0, 3, 4] }]);
  });

  it("keeps tags only one side has", () => {
    expect(mergeFeatures([{ tag: "kern", lookups: [0] }], [{ tag: "liga", lookups: [1] }])).toEqual(
      [
        { tag: "kern", lookups: [0] },
        { tag: "liga", lookups: [1] },
      ],
    );
  });

  it("shifts lookup numbers, which is what makes two lists into one", () => {
    // Appending one lookup list to another moves every index in the second by
    // the length of the first.
    expect(shiftFeatures([{ tag: "liga", lookups: [0, 2] }], 3)).toEqual([
      { tag: "liga", lookups: [3, 5] },
    ]);
  });
});
