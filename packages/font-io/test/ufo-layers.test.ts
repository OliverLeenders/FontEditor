import { counterIds, fontDocument, glyph } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { readUfo } from "../src/ufo-import.js";
import {
  defaultLayer,
  extraLayers,
  layerContentsPlist,
  parseLayerContents,
} from "../src/ufo-layers.js";
import { ufoFiles } from "../src/ufo.js";
import type { ZipFile } from "../src/unzip.js";
import { entryText } from "../src/zip.js";

const ids = counterIds("layers");

/**
 * The layers of a source that are not the one being drawn.
 *
 * A designer's UFO holds more than the drawing: a sketch traced over, a
 * previous version, shapes being fitted. This editor edits exactly one of them
 * and used to write a `layercontents.plist` that named only that one — so the
 * other directories stayed on disk with nothing pointing at them, which every
 * tool that opened the font afterwards read as their having been deleted.
 *
 * They are carried through unread now, which is the rule already followed for
 * the `fontinfo` keys the model has no field for and for the whole of a `lib`.
 */

const LISTING = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<plist version="1.0">',
  "<array>",
  "\t<array>",
  "\t\t<string>public.default</string>",
  "\t\t<string>glyphs</string>",
  "\t</array>",
  "\t<array>",
  "\t\t<string>sketch</string>",
  "\t\t<string>glyphs.sketch</string>",
  "\t</array>",
  "</array>",
  "</plist>",
].join("\n");

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A UFO with one glyph in the default layer and two files in a second one. */
function source(root = ""): ZipFile[] {
  return [
    { path: `${root}metainfo.plist`, bytes: bytes("<plist><dict/></plist>") },
    { path: `${root}layercontents.plist`, bytes: bytes(LISTING) },
    {
      path: `${root}glyphs/contents.plist`,
      bytes: bytes('<plist version="1.0"><dict><key>a</key><string>a.glif</string></dict></plist>'),
    },
    {
      path: `${root}glyphs/a.glif`,
      bytes: bytes(
        '<?xml version="1.0"?><glyph name="a" format="2"><advance width="500"/></glyph>',
      ),
    },
    {
      path: `${root}glyphs.sketch/contents.plist`,
      bytes: bytes('<plist version="1.0"><dict><key>a</key><string>a.glif</string></dict></plist>'),
    },
    {
      path: `${root}glyphs.sketch/a.glif`,
      bytes: bytes(
        '<?xml version="1.0"?><glyph name="a" format="2"><advance width="999"/></glyph>',
      ),
    },
  ];
}

describe("reading what layercontents.plist says", () => {
  it("gives every pair, not only the default one", () => {
    expect(parseLayerContents(LISTING)).toEqual([
      { name: "public.default", directory: "glyphs" },
      { name: "sketch", directory: "glyphs.sketch" },
    ]);
  });

  it("takes glyphs as the default layer when there is no file", () => {
    expect(defaultLayer(null)).toBe("glyphs");
    expect(parseLayerContents(null)).toEqual([]);
  });

  it("finds the default layer wherever the file puts it", () => {
    const moved = LISTING.replace("<string>glyphs</string>", "<string>foreground</string>");
    expect(defaultLayer(moved)).toBe("foreground");
  });
});

describe("gathering the layers that are not being edited", () => {
  it("takes everything in the directory, not only the glyphs", () => {
    const [only, ...rest] = extraLayers(source(), "", LISTING);

    expect(rest).toEqual([]);
    expect(only?.name).toBe("sketch");
    expect(only?.directory).toBe("glyphs.sketch");
    // The contents.plist as well as the glif: a layer put back without the file
    // that names its glyphs is a layer no other tool can read.
    expect(only?.files.map((f) => f.path).sort()).toEqual(["a.glif", "contents.plist"]);
  });

  it("leaves the default layer alone, whatever it is called", () => {
    const paths = extraLayers(source(), "", LISTING).flatMap((l) => l.files.map((f) => f.path));
    expect(paths.some((p) => p.includes("glyphs/"))).toBe(false);
  });

  it("skips a directory the listing names and the archive does not hold", () => {
    // A stale line in the plist. Writing it back would name a directory that is
    // not there, which is worse than dropping the line.
    const stale = LISTING.replace("glyphs.sketch", "glyphs.gone");
    expect(extraLayers(source(), "", stale)).toEqual([]);
  });

  it("reads a UFO nested inside a folder in the archive", () => {
    // Which is what a zipped UFO usually is: one directory holding the font.
    const inside = extraLayers(source("Font.ufo/"), "Font.ufo/", LISTING);
    expect(inside[0]?.files).toHaveLength(2);
  });
});

describe("writing the listing back", () => {
  it("names the default layer and every layer being carried", () => {
    const written = layerContentsPlist([{ name: "sketch", directory: "glyphs.sketch", files: [] }]);

    expect(written).toContain("<string>public.default</string>");
    expect(written).toContain("<string>glyphs</string>");
    expect(written).toContain("<string>sketch</string>");
    expect(written).toContain("<string>glyphs.sketch</string>");
  });

  it("names only the default layer for a font that has one", () => {
    expect(parseLayerContents(layerContentsPlist([]))).toEqual([
      { name: "public.default", directory: "glyphs" },
    ]);
  });

  it("escapes a name, which is the designer's to choose", () => {
    const written = layerContentsPlist([{ name: "a & b", directory: "glyphs.2", files: [] }]);
    expect(written).toContain("a &amp; b");
  });
});

describe("a source with a second layer, opened and written back", () => {
  it("comes out with the layer still listed and still there", () => {
    const read = readUfo(source(), ids);
    if ("reason" in read) throw new Error(read.reason);

    expect(read.layers).toHaveLength(1);

    const files = ufoFiles(read.document, new Map(), read.layers);
    const byPath = new Map(files.map((f) => [f.path, entryText(f)]));

    expect(parseLayerContents(byPath.get("layercontents.plist") ?? null)).toEqual([
      { name: "public.default", directory: "glyphs" },
      { name: "sketch", directory: "glyphs.sketch" },
    ]);
    // Byte for byte what was read: nothing here has looked inside it.
    expect(byPath.get("glyphs.sketch/a.glif")).toContain('width="999"');
    expect(byPath.has("glyphs.sketch/contents.plist")).toBe(true);
  });

  it("edits the default layer and leaves the other one untouched", () => {
    const read = readUfo(source(), ids);
    if ("reason" in read) throw new Error(read.reason);

    const edited = { ...read.document, glyphs: { a: glyph("a", { advance: 123 }) } };
    const byPath = new Map(
      ufoFiles(edited, new Map(), read.layers).map((f) => [f.path, entryText(f)]),
    );

    expect(byPath.get("glyphs/a.glif")).toContain('width="123"');
    expect(byPath.get("glyphs.sketch/a.glif")).toContain('width="999"');
  });

  it("writes no layer directory for a font that was given none", () => {
    const plain = ufoFiles(fontDocument([glyph("a", { advance: 500 })]));
    expect(plain.some((f) => f.path.startsWith("glyphs."))).toBe(false);
  });
});
