import { vec } from "@typewright/geometry";
import {
  DEFAULT_FONT_INFO,
  setKept,
  type FontDocument,
  EMPTY_KERNING,
  addContour,
  contour,
  counterIds,
  fontDocument,
  glyph,
  groupKey,
  node,
  setFeatures,
  setKern,
  setKerning,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { MemoryFileStore } from "../src/file-store.js";
import {
  KEEP,
  documentOf,
  listSnapshots,
  pruneSnapshots,
  readSnapshot,
  snapshotOf,
  writeSnapshot,
} from "../src/snapshots.js";

/**
 * Copies of the whole font, and getting one back.
 *
 * What is being checked is not that a file appears but that a document survives
 * the round trip whole: undo dies with the tab, and a snapshot that came back
 * missing its kerning would be worse than none, since it would be trusted.
 */

const ids = counterIds("s");

function font(): FontDocument {
  const ring = contour(
    ids.contour(),
    [
      node(ids.node(), vec(0, 250), { type: "smooth", in: vec(-140, 250), out: vec(140, 250) }),
      node(ids.node(), vec(250, 0), { type: "smooth", in: vec(250, 140), out: vec(250, -140) }),
      node(ids.node(), vec(0, -250), { type: "smooth", in: vec(140, -250), out: vec(-140, -250) }),
    ],
    true,
  );

  const document = fontDocument(
    [
      addContour(glyph("o", { unicodes: [0x6f], advance: 600 }), ring),
      glyph("space", { unicodes: [0x20], advance: 250 }),
    ],
    { ...DEFAULT_FONT_INFO, familyName: "Kept" },
  );

  const kerned = setKerning(document, setKern(EMPTY_KERNING, "o", groupKey("A"), -30));
  const featured = setFeatures(kerned, "feature liga { sub f i by fi; } liga;");
  return setKept(featured, { fontInfo: { note: "kept" }, lib: { "com.someone.tool": true } });
}

const at = (n: number) => 1_700_000_000_000 + n * 60_000;

describe("snapshots", () => {
  it("brings a whole document back: glyphs, order, kerning and features", async () => {
    const store = new MemoryFileStore();
    const before = font();

    await writeSnapshot(store, snapshotOf(before, at(0)));
    const stored = await readSnapshot(store, at(0));
    expect(stored).not.toBeNull();

    const { document, problems } = documentOf(stored!);
    expect(problems).toEqual([]);
    expect(document.glyphOrder).toEqual(before.glyphOrder);
    expect(document.info).toEqual(before.info);
    expect(document.features).toBe(before.features);
    expect(document.kerning).toEqual(before.kerning);
    // Including what the font carries and this editor does not understand: a
    // copy that came back without it would strip somebody's source the next
    // time they saved from it.
    expect(document.kept).toEqual(before.kept);
    expect(document.glyphs["o"]!.contours[0]!.nodes).toHaveLength(3);
  });

  it("lists them newest first, with the size in each", async () => {
    const store = new MemoryFileStore();
    await writeSnapshot(store, snapshotOf(font(), at(0)));
    await writeSnapshot(store, snapshotOf(font(), at(2)));
    await writeSnapshot(store, snapshotOf(font(), at(1)));

    const entries = await listSnapshots(store);
    expect(entries.map((e) => e.at)).toEqual([at(2), at(1), at(0)]);
    // Read from the filename, so a list of a thousand costs one directory read.
    expect(entries.every((e) => e.glyphs === 2)).toBe(true);
  });

  it("drops the oldest once there are too many", async () => {
    const store = new MemoryFileStore();
    for (let i = 0; i < KEEP + 3; i++) await writeSnapshot(store, snapshotOf(font(), at(i)));

    const dropped = await pruneSnapshots(store);
    expect(dropped.map((e) => e.at)).toEqual([at(2), at(1), at(0)]);

    const left = await listSnapshots(store);
    expect(left).toHaveLength(KEEP);
    expect(left[left.length - 1]!.at).toBe(at(3));
  });

  it("says nothing is there rather than throwing, for one that has gone", async () => {
    const store = new MemoryFileStore();
    expect(await readSnapshot(store, at(0))).toBeNull();
  });

  it("treats a corrupt copy as a missing one", async () => {
    // The answer to a copy that will not parse is the next copy down the list,
    // not an exception in the middle of trying to recover.
    const store = new MemoryFileStore();
    await store.write(`snapshots/${String(at(0))}-2.json`, "{ this is not json");
    expect(await readSnapshot(store, at(0))).toBeNull();
  });

  it("keeps the glyphs it can read when one of them is broken", async () => {
    const snapshot = snapshotOf(font(), at(0));
    const damaged = {
      ...snapshot,
      glyphs: [...snapshot.glyphs, { schema: 1, name: "bad" } as (typeof snapshot.glyphs)[number]],
    };

    const { document, problems } = documentOf(damaged);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("bad");
    expect(document.glyphOrder).toContain("o");
  });
});
