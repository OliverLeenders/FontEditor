import { readUfo, ufoFiles } from "@fonteditor/font-io";
import { DEFAULT_FONT_INFO, fontDocument, glyph, randomIds } from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { MAX_DEPTH, readFolder, writeFolder } from "../src/folder.js";
import { FakeFolder } from "./fake-folder.js";

const font = (...names: string[]) =>
  fontDocument(
    names.map((name, i) => glyph(name, { advance: 500 + i, unicodes: [97 + i] })),
    DEFAULT_FONT_INFO,
  );

describe("writing a font to a folder", () => {
  it("writes the same files the archive would have held", async () => {
    const folder = new FakeFolder("Test.ufo");
    const report = await writeFolder(folder, ufoFiles(font("a", "b")));

    const paths = [...folder.all().keys()];
    expect(paths).toContain("metainfo.plist");
    expect(paths).toContain("fontinfo.plist");
    expect(paths).toContain("glyphs/contents.plist");
    expect(paths).toContain("glyphs/a.glif");
    expect(report.written).toBe(paths.length);
    expect(report.removed).toEqual([]);
  });

  it("comes back as the font that was written", async () => {
    const folder = new FakeFolder("Test.ufo");
    await writeFolder(folder, ufoFiles(font("a", "b", "c")));

    const read = readUfo(await readFolder(folder), randomIds());
    if ("reason" in read) throw new Error(read.reason);

    expect(read.document.glyphOrder).toEqual(["a", "b", "c"]);
    expect(read.document.glyphs.b?.advance).toBe(501);
  });

  it("removes a glyph file the font no longer has", async () => {
    const folder = new FakeFolder("Test.ufo");
    await writeFolder(folder, ufoFiles(font("a", "b")));

    const report = await writeFolder(folder, ufoFiles(font("a")));

    expect(report.removed).toEqual(["b.glif"]);
    expect([...folder.all().keys()]).not.toContain("glyphs/b.glif");
  });

  it("leaves alone files it never wrote", async () => {
    const folder = new FakeFolder("Test.ufo");
    // A stray glif the last save did not list, and something that is not a
    // glyph at all: neither is ours to delete.
    folder.put("data/notes.txt", "mine");
    folder.put("glyphs/stray.glif", "not listed");
    await writeFolder(folder, ufoFiles(font("a", "b")));

    const report = await writeFolder(folder, ufoFiles(font("a")));

    expect(report.removed).toEqual(["b.glif"]);
    const paths = [...folder.all().keys()];
    expect(paths).toContain("data/notes.txt");
    expect(paths).toContain("glyphs/stray.glif");
  });

  it("says so when the font kept its glyphs somewhere else", async () => {
    const folder = new FakeFolder("Test.ufo");
    folder.put(
      "layercontents.plist",
      "<array><array><string>public.default</string><string>glyphs.main</string></array></array>",
    );

    const report = await writeFolder(folder, ufoFiles(font("a")));

    expect(report.notes.join(" ")).toContain("glyphs.main");
    // Said, not deleted.
    expect([...folder.all().keys()]).toContain("layercontents.plist");
  });
});

describe("reading a folder", () => {
  it("gives paths relative to the folder, with slashes", async () => {
    const folder = new FakeFolder("Test.ufo");
    folder.put("metainfo.plist", "x");
    folder.put("glyphs/a.glif", "y");

    const files = await readFolder(folder);

    expect(files.map((f) => f.path).sort()).toEqual(["glyphs/a.glif", "metainfo.plist"]);
    expect(new TextDecoder().decode(files.find((f) => f.path === "glyphs/a.glif")?.bytes)).toBe(
      "y",
    );
  });

  it("refuses a folder that goes on for ever", async () => {
    const folder = new FakeFolder("deep");
    folder.put(
      `${Array.from({ length: MAX_DEPTH + 2 }, (_, i) => `d${String(i)}`).join("/")}/f.txt`,
      "x",
    );

    await expect(readFolder(folder)).rejects.toThrow(/deep/);
  });
});

/**
 * Writing only what differs.
 *
 * A UFO is one file per glyph, so moving one point changes one file of several
 * hundred — and writing the rest again is the whole of the wait somebody sees
 * after pressing Ctrl-S. What makes it safe is that the comparison is against
 * what *this* editor last wrote, not against what happens to be on the disk.
 */
describe("saving again", () => {
  it("writes nothing the second time when nothing changed", async () => {
    const folder = new FakeFolder("Test.ufo");
    const entries = ufoFiles(font("a", "b", "c"));

    const first = await writeFolder(folder, entries);
    expect(first.written).toBeGreaterThan(3);
    expect(first.skipped).toBe(0);

    const again = await writeFolder(folder, entries, { known: first.wrote });
    expect(again.written).toBe(0);
    expect(again.skipped).toBe(first.written);
  });

  it("writes the glyph that changed, and only it", async () => {
    const folder = new FakeFolder("Test.ufo");
    const first = await writeFolder(folder, ufoFiles(font("a", "b", "c")));

    // The same font with one different advance: one `.glif` differs, and so
    // does the `fontinfo` this test's font derives from its glyphs — nothing
    // else in the archive has any reason to.
    const moved = fontDocument(
      [
        glyph("a", { advance: 999, unicodes: [97] }),
        glyph("b", { advance: 501, unicodes: [98] }),
        glyph("c", { advance: 502, unicodes: [99] }),
      ],
      DEFAULT_FONT_INFO,
    );

    const again = await writeFolder(folder, ufoFiles(moved), { known: first.wrote });

    expect(again.written).toBe(1);
    expect(again.skipped).toBe(first.written - 1);
    // And the file on disk is the new one, not the old.
    expect(folder.all().get("glyphs/a.glif")).toContain('width="999"');
  });

  it("writes everything when it has no record of what is there", async () => {
    // The first save after a folder is opened: what is on disk is somebody
    // else's, whatever it looks like.
    const folder = new FakeFolder("Test.ufo");
    const entries = ufoFiles(font("a", "b"));
    await writeFolder(folder, entries);

    const again = await writeFolder(folder, entries);
    expect(again.skipped).toBe(0);
    expect(again.written).toBe(entries.length);
  });

  it("still takes away a glyph that has gone, having written nothing else", async () => {
    const folder = new FakeFolder("Test.ufo");
    const first = await writeFolder(folder, ufoFiles(font("a", "b", "c")));

    const fewer = await writeFolder(folder, ufoFiles(font("a", "b")), { known: first.wrote });

    expect(fewer.removed).toEqual(["c.glif"]);
    expect(folder.all().has("glyphs/c.glif")).toBe(false);
  });

  it("counts the files it is about to write, and then each one", async () => {
    const folder = new FakeFolder("Test.ufo");
    const seen: [number, number][] = [];

    const report = await writeFolder(folder, ufoFiles(font("a", "b")), {
      onProgress: (done, total) => seen.push([done, total]),
    });

    // Nought of them before the first, and every step after.
    expect(seen[0]).toEqual([0, report.written]);
    expect(seen[seen.length - 1]).toEqual([report.written, report.written]);
    expect(seen).toHaveLength(report.written + 1);
  });

  it("says there is nothing to do rather than counting to nothing", async () => {
    const folder = new FakeFolder("Test.ufo");
    const entries = ufoFiles(font("a"));
    const first = await writeFolder(folder, entries);

    const seen: [number, number][] = [];
    await writeFolder(folder, entries, {
      known: first.wrote,
      onProgress: (done, total) => seen.push([done, total]),
    });

    expect(seen).toEqual([[0, 0]]);
  });
});
