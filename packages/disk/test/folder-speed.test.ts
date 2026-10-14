import { readUfo, ufoFiles } from "@typewright/font-io";
import { DEFAULT_FONT_INFO, fontDocument, glyph, randomIds } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { readFolder, writeFolder } from "../src/folder.js";
import type { DiskFile, DiskFolder } from "../src/handles.js";
import { FakeFolder } from "./fake-folder.js";

/**
 * A font written to a folder on a disk that is slow to take each file.
 *
 * Chrome on Windows takes about a tenth of a second for each file written to a
 * disk of somebody's own, whatever is in it: written beside the real one,
 * checked, moved into place, and looked at by the virus scanner as it lands.
 * Written one after another, a font of four thousand glyphs was seven minutes
 * at ten glyphs a second. These ask that the glyphs' files are written several
 * at once, and that nothing else about the folder changes for it: the files
 * that are not glyphs still in the order they were handed in, and the font
 * read back the same.
 */

const font = (count: number) =>
  fontDocument(
    Array.from({ length: count }, (_, i) =>
      glyph(`g${String(i)}`, { advance: 500 + i, unicodes: [0xe000 + i] }),
    ),
    DEFAULT_FONT_INFO,
  );

/**
 * A folder whose every file takes a while to land, and which keeps account of
 * how many were landing at once and in what order they landed.
 */
class SlowDisk {
  inFlight = 0;
  most = 0;
  readonly landed: string[] = [];

  constructor(private readonly wait: number) {}

  folder(inner: DiskFolder, at = ""): DiskFolder {
    return {
      kind: "directory",
      name: inner.name,
      entries: () => inner.entries(),
      getFileHandle: async (name, options) =>
        this.file(await inner.getFileHandle(name, options), `${at}${name}`),
      getDirectoryHandle: async (name, options) =>
        this.folder(await inner.getDirectoryHandle(name, options), `${at}${name}/`),
      removeEntry: (name, options) => inner.removeEntry(name, options),
    };
  }

  private file(inner: DiskFile, path: string): DiskFile {
    return {
      kind: "file",
      name: inner.name,
      getFile: () => inner.getFile(),
      createWritable: async () => {
        const writable = await inner.createWritable();
        return {
          write: (data) => writable.write(data),
          close: async () => {
            this.inFlight += 1;
            this.most = Math.max(this.most, this.inFlight);
            await new Promise((resolve) => setTimeout(resolve, this.wait));
            await writable.close();
            this.inFlight -= 1;
            this.landed.push(path);
          },
        };
      },
    };
  }
}

describe("a font written to a disk slow to take each file", () => {
  it("writes its glyphs several at once, in a fraction of the time one by one would take", async () => {
    const disk = new SlowDisk(20);
    const folder = new FakeFolder("Slow.ufo");
    const glyphs = 200;

    const began = Date.now();
    const report = await writeFolder(disk.folder(folder), ufoFiles(font(glyphs)));
    const took = Date.now() - began;

    expect(report.written).toBeGreaterThan(glyphs);
    expect(disk.most).toBeGreaterThan(1);
    // One by one this is four seconds and more; several at once, well under one.
    expect(took).toBeLessThan((glyphs * 20) / 4);
  });

  it("still writes the files that are not glyphs in the order they were handed in, and alone", async () => {
    const disk = new SlowDisk(2);
    const folder = new FakeFolder("Order.ufo");
    const entries = ufoFiles(font(40));

    await writeFolder(disk.folder(folder), entries);

    const others = (paths: readonly string[]): string[] =>
      paths.filter((path) => !path.endsWith(".glif"));
    expect(others(disk.landed)).toEqual(others(entries.map((e) => e.path)));
    // And each of them after every glyph handed in before it, and before every
    // one handed in after it.
    for (const path of others(entries.map((e) => e.path))) {
      const handed = entries.findIndex((e) => e.path === path);
      const landed = disk.landed.indexOf(path);
      const glyphsBefore = entries.slice(0, handed).filter((e) => e.path.endsWith(".glif"));
      for (const g of glyphsBefore) expect(disk.landed.indexOf(g.path), path).toBeLessThan(landed);
    }
  });

  it("is read back the same font it was", async () => {
    const disk = new SlowDisk(1);
    const folder = new FakeFolder("Same.ufo");
    const before = font(60);

    await writeFolder(disk.folder(folder), ufoFiles(before));

    const read = readUfo(await readFolder(folder), randomIds());
    if ("reason" in read) throw new Error(read.reason);
    const after = read.document;
    expect(after.glyphOrder).toEqual(before.glyphOrder);
    expect(after.glyphOrder.map((name) => after.glyphs[name]?.advance)).toEqual(
      before.glyphOrder.map((name) => before.glyphs[name]?.advance),
    );
  });
});
