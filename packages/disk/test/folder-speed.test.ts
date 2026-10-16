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

/**
 * A disk that refuses some writes: each file named in `refused` that many
 * times, and then takes it. What Chrome says when the file it is writing over
 * is held by something else as it lands.
 */
function refusing(inner: DiskFolder, refused: Map<string, number>, at = ""): DiskFolder {
  return {
    kind: "directory",
    name: inner.name,
    entries: () => inner.entries(),
    getFileHandle: async (name, options) => {
      const file = await inner.getFileHandle(name, options);
      const path = `${at}${name}`;
      return {
        kind: "file",
        name: file.name,
        getFile: () => file.getFile(),
        createWritable: async () => {
          const writable = await file.createWritable();
          return {
            write: (data) => writable.write(data),
            close: async () => {
              const left = refused.get(path) ?? 0;
              if (left > 0) {
                refused.set(path, left - 1);
                throw new DOMException(
                  "An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk.",
                  "InvalidStateError",
                );
              }
              await writable.close();
            },
          };
        },
      };
    },
    getDirectoryHandle: async (name, options) =>
      refusing(await inner.getDirectoryHandle(name, options), refused, `${at}${name}/`),
    removeEntry: (name, options) => inner.removeEntry(name, options),
  };
}

describe("a font written to a disk that refuses a file now and then", () => {
  it("is written whole, the refused files tried again", async () => {
    const folder = new FakeFolder("Held.ufo");
    const entries = ufoFiles(font(40));
    const glifs = entries.filter((e) => e.path.endsWith(".glif")).map((e) => e.path);
    // Three glyphs refused once, one twice, and a file that is not a glyph once.
    const refused = new Map<string, number>([
      [glifs[0]!, 1],
      [glifs[7]!, 2],
      [glifs[20]!, 1],
      ["fontinfo.plist", 1],
    ]);

    const report = await writeFolder(refusing(folder, refused), entries);

    expect(report.written).toBe(entries.length);
    expect([...refused.values()].every((left) => left === 0)).toBe(true);
    const written = folder.all();
    for (const entry of entries) expect(written.has(entry.path), entry.path).toBe(true);
  });

  it("names the file, where it is refused every time", async () => {
    const folder = new FakeFolder("Stuck.ufo");
    const entries = ufoFiles(font(10));
    const stuck = entries.find((e) => e.path.endsWith(".glif"))!.path;

    await expect(writeFolder(refusing(folder, new Map([[stuck, 99]])), entries)).rejects.toThrow(
      new RegExp(
        `^${stuck.replace(/[.]/g, "\\.")} could not be written: An operation that depends on state cached`,
      ),
    );
  });
});
