import { readUfo, ufoFiles } from "@typewright/font-io";
import {
  DEFAULT_FONT_INFO,
  type FontDocument,
  fontDocument,
  glyph,
  randomIds,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { readFolder, writeFolder } from "../src/folder.js";
import type { DiskFile, DiskFolder } from "../src/handles.js";
import { FakeFolder } from "./fake-folder.js";

/**
 * A save to the folder, stopped after every change to it that it makes.
 *
 * The folder is the file the work is in, and the one other programs read. A
 * save is dozens of files written one after another, and a tab closed, a disk
 * pulled or a laptop out of battery stops it wherever it had got to. What is
 * left has to be a font: one that opens, here and anywhere else, with every
 * glyph it lists there to be read, and each glyph as it was before the save or
 * as it is after it.
 */

/** A folder that lets so many changes through, and then is gone. */
class Stopping {
  changes = 0;
  private stopAt: number | null = null;

  arm(more: number): void {
    this.stopAt = this.changes + more;
  }

  private changing(): void {
    if (this.stopAt !== null && this.changes >= this.stopAt) throw new Error("the disk has gone");
    this.changes += 1;
  }

  folder(inner: DiskFolder): DiskFolder {
    return {
      kind: "directory",
      name: inner.name,
      entries: () => inner.entries(),
      getFileHandle: async (name, options) => {
        // A file made is a change: it is there, and empty, from this moment.
        let there = true;
        try {
          await inner.getFileHandle(name);
        } catch {
          there = false;
        }
        if (!there && options?.create === true) this.changing();
        return this.file(await inner.getFileHandle(name, options));
      },
      getDirectoryHandle: async (name, options) =>
        this.folder(await inner.getDirectoryHandle(name, options)),
      removeEntry: async (name, options) => {
        this.changing();
        await inner.removeEntry(name, options);
      },
    };
  }

  private file(inner: DiskFile): DiskFile {
    return {
      kind: "file",
      name: inner.name,
      getFile: () => inner.getFile(),
      createWritable: async () => {
        const writable = await inner.createWritable();
        return {
          write: (data) => writable.write(data),
          close: async () => {
            this.changing();
            await writable.close();
          },
        };
      },
    };
  }
}

const font = (glyphs: readonly [string, number][]): FontDocument =>
  fontDocument(
    glyphs.map(([name, advance], i) => glyph(name, { advance, unicodes: [97 + i] })),
    DEFAULT_FONT_INFO,
  );

async function copyOf(folder: FakeFolder): Promise<FakeFolder> {
  const copy = new FakeFolder(folder.name);
  for (const [path, text] of folder.all()) copy.put(path, text);
  return await Promise.resolve(copy);
}

describe("a save to the folder, stopped part of the way", () => {
  it("leaves a font that opens, with every glyph it lists as it was or as it is", async () => {
    // Before: four glyphs. After: one changed, one gone, one called something
    // else, and one that was not there.
    const before = font([
      ["a", 500],
      ["b", 510],
      ["c", 520],
      ["d", 530],
    ]);
    const after = font([
      ["a", 501],
      ["b", 510],
      ["c.alt", 520],
      ["e", 540],
    ]);
    const was = new Map(before.glyphOrder.map((name) => [name, before.glyphs[name]!.advance]));
    const is = new Map(after.glyphOrder.map((name) => [name, after.glyphs[name]!.advance]));

    const base = new FakeFolder("Test.ufo");
    const first = await writeFolder(base, ufoFiles(before));

    // To the end once, to learn how many changes a whole save is.
    const whole = new Stopping();
    await writeFolder(whole.folder(await copyOf(base)), ufoFiles(after), { known: first.wrote });
    expect(whole.changes).toBeGreaterThan(4);

    for (let n = 0; n < whole.changes; n++) {
      const left = await copyOf(base);
      const stopping = new Stopping();
      stopping.arm(n);
      await writeFolder(stopping.folder(left), ufoFiles(after), { known: first.wrote }).catch(
        () => undefined,
      );

      const where = `stopped after ${String(n)} of ${String(whole.changes)} changes`;
      const read = readUfo(await readFolder(left), randomIds());
      if ("reason" in read) throw new Error(`${where}: ${read.reason}`);
      expect(read.warnings, `${where}: nothing it lists is missing or unreadable`).toEqual([]);

      for (const name of read.document.glyphOrder) {
        const advance = read.document.glyphs[name]?.advance;
        expect(
          [was.get(name), is.get(name)],
          `${where}: ${name} as it was before the save or as it is after`,
        ).toContain(advance);
      }
    }
  });
});
