import { describe, expect, it } from "vitest";

import { MemoryFileStore } from "../src/file-store.js";
import {
  IMAGES_PREFIX,
  allImages,
  listImages,
  pruneImages,
  readImage,
  removeImage,
  usableImageName,
  writeImage,
} from "../src/images.js";

/**
 * The pictures beside the font.
 *
 * Kept out of the document on purpose — a scan is megabytes that never change,
 * and the document is a value history copies on every edit — so this is the
 * other half of that arrangement, and the half that has to be there when a
 * glyph asks for the file it names.
 */

const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);

describe("keeping pictures", () => {
  it("writes one and reads it back byte for byte", async () => {
    const store = new MemoryFileStore();
    const entry = await writeImage(store, "sheet.png", PICTURE);

    expect(entry).toEqual({ name: "sheet.png", bytes: PICTURE.length });
    expect(await readImage(store, "sheet.png")).toEqual(PICTURE);
  });

  it("puts them where the format keeps them", async () => {
    const store = new MemoryFileStore();
    await writeImage(store, "sheet.png", PICTURE);

    expect(store.has(`${IMAGES_PREFIX}sheet.png`)).toBe(true);
  });

  it("replaces one of the same name, which is how a scan is swapped", async () => {
    const store = new MemoryFileStore();
    await writeImage(store, "sheet.png", PICTURE);
    await writeImage(store, "sheet.png", new Uint8Array([1, 2, 3]));

    // Every glyph tracing from it follows, because the name is the whole link.
    expect(await readImage(store, "sheet.png")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("says nothing is there rather than throwing", async () => {
    expect(await readImage(new MemoryFileStore(), "missing.png")).toBeNull();
  });

  it("lists what it holds, with sizes, in name order", async () => {
    const store = new MemoryFileStore();
    await writeImage(store, "two.png", new Uint8Array([1, 2]));
    await writeImage(store, "one.png", PICTURE);

    expect(await listImages(store)).toEqual([
      { name: "one.png", bytes: PICTURE.length },
      { name: "two.png", bytes: 2 },
    ]);
  });

  it("hands them all over for an export", async () => {
    const store = new MemoryFileStore();
    await writeImage(store, "one.png", PICTURE);
    await writeImage(store, "two.png", new Uint8Array([9]));

    const all = await allImages(store);
    expect([...all.keys()].sort()).toEqual(["one.png", "two.png"]);
    expect(all.get("one.png")).toEqual(PICTURE);
  });

  it("takes one away", async () => {
    const store = new MemoryFileStore();
    await writeImage(store, "sheet.png", PICTURE);
    await removeImage(store, "sheet.png");

    expect(await readImage(store, "sheet.png")).toBeNull();
    expect(await listImages(store)).toEqual([]);
  });
});

describe("names a picture may have", () => {
  it("refuses one that would put the file somewhere else", () => {
    expect(usableImageName("sheet.png")).toBe(true);
    expect(usableImageName("old/sheet.png")).toBe(false);
    expect(usableImageName("..\\\\secrets")).toBe(false);
    expect(usableImageName(".hidden")).toBe(false);
    expect(usableImageName("")).toBe(false);
  });

  it("will not write one, and reads nothing for one", async () => {
    const store = new MemoryFileStore();
    await expect(writeImage(store, "old/sheet.png", PICTURE)).rejects.toThrow(/usable/);
    expect(await readImage(store, "old/sheet.png")).toBeNull();
  });
});

describe("tidying up", () => {
  it("removes what no glyph is using, and keeps what is", async () => {
    const store = new MemoryFileStore();
    await writeImage(store, "used.png", PICTURE);
    await writeImage(store, "forgotten.png", PICTURE);

    const gone = await pruneImages(store, new Set(["used.png"]));

    expect(gone).toEqual(["forgotten.png"]);
    expect(await readImage(store, "used.png")).toEqual(PICTURE);
    expect(await readImage(store, "forgotten.png")).toBeNull();
  });
});
