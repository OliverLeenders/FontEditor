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
