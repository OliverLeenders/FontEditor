import {
  DEFAULT_FONT_INFO,
  counterIds,
  fontDocument,
  glyph,
  glyphNamed,
  imageRef,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { ufoFiles } from "../src/ufo.js";
import { readUfo } from "../src/ufo-import.js";
import type { ZipFile } from "../src/unzip.js";
import { entryBytes, entryText } from "../src/zip.js";

/**
 * The pictures a font is traced from, through the format.
 *
 * Two halves that have to agree: the glyph says which file and where it sits,
 * and the file itself lives in the font's `images` directory. A reader that got
 * one without the other would show a letter with no picture or carry megabytes
 * nothing points at.
 */

const ids = counterIds("img");

const file = (path: string, text: string): ZipFile => ({
  path,
  bytes: new TextEncoder().encode(text),
});

const bytes = (path: string, data: Uint8Array): ZipFile => ({ path, bytes: data });

const plist = (body: string): string =>
  ['<?xml version="1.0" encoding="UTF-8"?>', '<plist version="1.0">', body, "</plist>"].join("\n");

const glif = (inner: string): string =>
  [
    '<?xml version="1.0"?>',
    '<glyph name="a" format="2">',
    '\t<advance width="500"/>',
    inner,
    "\t<outline/>",
    "</glyph>",
    "",
  ].join("\n");

/** Not a real PNG: nothing here decodes one, which is itself worth proving. */
const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 250]);

function ufo(extra: readonly ZipFile[] = []): ZipFile[] {
  const base = [
    file("metainfo.plist", plist("<dict><key>formatVersion</key><integer>3</integer></dict>")),
    file("fontinfo.plist", plist("<dict><key>familyName</key><string>Traced</string></dict>")),
    file("glyphs/contents.plist", plist("<dict><key>a</key><string>a.glif</string></dict>")),
    file("glyphs/a.glif", glif("")),
  ];
  return [...base.filter((f) => !extra.some((e) => e.path === f.path)), ...extra];
}

function read(files: readonly ZipFile[]) {
  const out = readUfo(files, ids);
  if ("reason" in out) throw new Error(out.reason);
  return out;
}

describe("a glyph's picture", () => {
  it("reads the file it names and where it sits", () => {
    const { document } = read(
      ufo([
        file(
          "glyphs/a.glif",
          glif(
            '\t<image fileName="sheet.png" xScale="0.5" yScale="0.5" xOffset="20" yOffset="-8"/>',
          ),
        ),
      ]),
    );
    const image = glyphNamed(document, "a")?.image;

    expect(image?.name).toBe("sheet.png");
    expect(image?.transform.xScale).toBe(0.5);
    expect(image?.transform.xOffset).toBe(20);
    expect(image?.transform.yOffset).toBe(-8);
  });

  it("takes the defaults for a picture placed as it comes", () => {
    const { document } = read(
      ufo([file("glyphs/a.glif", glif('\t<image fileName="sheet.png"/>'))]),
    );
    const image = glyphNamed(document, "a")?.image;

    // One pixel to the unit, sitting on the origin.
    expect(image?.transform.xScale).toBe(1);
    expect(image?.transform.yScale).toBe(1);
    expect(image?.transform.xOffset).toBe(0);
  });

  it("ignores an image element that names no file", () => {
    const { document } = read(ufo([file("glyphs/a.glif", glif("\t<image/>"))]));
    expect(glyphNamed(document, "a")?.image).toBeNull();
  });

  it("writes it back, in full, and reads its own file as the same placement", () => {
    const document = fontDocument(
      [
        glyph("a", {
          advance: 500,
          image: imageRef("sheet.png", {
            xScale: 0.5,
            xyScale: 0,
            yxScale: 0,
            yScale: 0.5,
            xOffset: 20,
            yOffset: -8,
          }),
        }),
      ],
      DEFAULT_FONT_INFO,
    );

    const out =
      new Map(ufoFiles(document).map((e) => [e.path, entryText(e)])).get("glyphs/a.glif") ?? "";
    expect(out).toContain('fileName="sheet.png"');
    expect(out).toContain('xScale="0.5"');
    expect(out).toContain('xOffset="20"');

    const again = read(ufo([file("glyphs/a.glif", out)]));
    expect(glyphNamed(again.document, "a")?.image?.transform.yOffset).toBe(-8);
  });

  it("keeps the image element out of what is kept verbatim", () => {
    const { document } = read(
      ufo([file("glyphs/a.glif", glif('\t<image fileName="sheet.png"/>'))]),
    );
    // Modelled, so it is written from the model. In `kept` as well it would be
    // written twice, and a glyph with two images is not a glyph.
    expect(glyphNamed(document, "a")?.kept.join("")).not.toContain("image");
  });
});

describe("the font's pictures", () => {
  it("reads them out of the images directory, whatever they are", () => {
    const { images } = read(ufo([bytes("images/sheet.png", PICTURE)]));

    expect([...images.keys()]).toEqual(["sheet.png"]);
    expect(images.get("sheet.png")).toEqual(PICTURE);
  });

  it("does not go looking inside them", () => {
    // Not a PNG at all. A format we cannot read is still the designer's file,
    // and refusing to carry it would lose it on the next save.
    const { images } = read(ufo([bytes("images/notes.tif", new Uint8Array([1, 2, 3]))]));
    expect(images.get("notes.tif")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("ignores anything nested under images", () => {
    const { images } = read(ufo([bytes("images/old/sheet.png", PICTURE)]));
    expect(images.size).toBe(0);
  });

  it("writes them back where they were, as bytes", () => {
    const document = fontDocument([glyph("a", { advance: 500 })], DEFAULT_FONT_INFO);
    const files = ufoFiles(document, new Map([["sheet.png", PICTURE]]));

    const written = files.find((f) => f.path === "images/sheet.png");
    expect(written).toBeDefined();
    if (written === undefined) return;
    expect(entryBytes(written)).toEqual(PICTURE);
  });

  it("comes back byte for byte through an archive", () => {
    const document = fontDocument([glyph("a", { advance: 500 })], DEFAULT_FONT_INFO);
    const files = ufoFiles(document, new Map([["sheet.png", PICTURE]]));

    // Straight back through the reader, as a zip would deliver them.
    const asRead = files.map((f) => ({ path: f.path, bytes: entryBytes(f) }));
    const { images } = read(asRead);
    expect(images.get("sheet.png")).toEqual(PICTURE);
  });
});
