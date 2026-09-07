import {
  DEFAULT_FONT_INFO,
  counterIds,
  fontDocument,
  glyph,
  glyphNamed,
  guide,
  horizontalGuide,
  setGuides,
  verticalGuide,
} from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { ufoFiles } from "../src/ufo.js";
import { entryText } from "../src/zip.js";
import { readUfo } from "../src/ufo-import.js";
import type { ZipFile } from "../src/unzip.js";

/**
 * Guides through the format, both ways.
 *
 * The format writes a line in three ways — `x` alone, `y` alone, or both with
 * an angle — and the model keeps one. Reading has to accept all three and
 * writing has to produce something every other tool reads back as the same
 * line, which is what these ask.
 */

const ids = counterIds("gio");

const file = (path: string, text: string): ZipFile => ({
  path,
  bytes: new TextEncoder().encode(text),
});

const plist = (body: string): string =>
  ['<?xml version="1.0" encoding="UTF-8"?>', '<plist version="1.0">', body, "</plist>"].join("\n");

const glif = (inner: string): string =>
  [
    '<?xml version="1.0"?>',
    '<glyph name="a" format="2">',
    '\t<advance width="500"/>',
    "\t<outline/>",
    inner,
    "</glyph>",
    "",
  ].join("\n");

function ufo(extra: readonly ZipFile[] = []): ZipFile[] {
  const base = [
    file("metainfo.plist", plist("<dict><key>formatVersion</key><integer>3</integer></dict>")),
    file("fontinfo.plist", plist("<dict><key>familyName</key><string>Guided</string></dict>")),
    file("glyphs/contents.plist", plist("<dict><key>a</key><string>a.glif</string></dict>")),
    file("glyphs/a.glif", glif("")),
  ];
  return [...base.filter((f) => !extra.some((e) => e.path === f.path)), ...extra];
}

function read(files: readonly ZipFile[]) {
  const out = readUfo(files, ids);
  if ("reason" in out) throw new Error(out.reason);
  return out.document;
}

const written = (document: ReturnType<typeof read>): Map<string, string> =>
  new Map(ufoFiles(document).map((e) => [e.path, entryText(e)]));

describe("a glyph's guides", () => {
  it("reads a vertical one written as x alone", () => {
    const document = read(ufo([file("glyphs/a.glif", glif('\t<guideline x="120" name="stem"/>'))]));
    const [g] = glyphNamed(document, "a")?.guides ?? [];

    expect(g?.pt.x).toBe(120);
    expect(g?.angle).toBe(90);
    expect(g?.name).toBe("stem");
  });

  it("reads a horizontal one written as y alone", () => {
    const document = read(ufo([file("glyphs/a.glif", glif('\t<guideline y="512"/>'))]));
    const [g] = glyphNamed(document, "a")?.guides ?? [];

    expect(g?.pt.y).toBe(512);
    expect(g?.angle).toBe(0);
  });

  it("reads a slanted one written in full", () => {
    const document = read(
      ufo([file("glyphs/a.glif", glif('\t<guideline x="0" y="0" angle="12" name="italic"/>'))]),
    );
    const [g] = glyphNamed(document, "a")?.guides ?? [];

    expect(g?.angle).toBe(12);
    expect(g?.name).toBe("italic");
  });

  it("writes one in full, and reads its own file back as the same line", () => {
    const document = read(ufo([file("glyphs/a.glif", glif('\t<guideline x="120" name="stem"/>'))]));
    const out = written(document).get("glyphs/a.glif") ?? "";

    expect(out).toContain('<guideline x="120" y="0" angle="90" name="stem"/>');

    const again = read(ufo([file("glyphs/a.glif", out)]));
    const [g] = glyphNamed(again, "a")?.guides ?? [];
    expect(g?.pt.x).toBe(120);
    expect(g?.angle).toBe(90);
  });

  it("carries a colour it does not understand", () => {
    const document = read(
      ufo([file("glyphs/a.glif", glif('\t<guideline y="10" color="1,0,0,.5"/>'))]),
    );
    expect(written(document).get("glyphs/a.glif")).toContain('color="1,0,0,.5"');
  });

  it("keeps guidelines out of what is kept verbatim", () => {
    const document = read(ufo([file("glyphs/a.glif", glif('\t<guideline y="10"/>'))]));
    // Modelled now, so writing it comes from the model. Carrying it in `kept`
    // as well would write the line twice.
    expect(glyphNamed(document, "a")?.kept.join("")).not.toContain("guideline");
  });
});

describe("the font's guides", () => {
  it("reads them from fontinfo", () => {
    const document = read(
      ufo([
        file(
          "fontinfo.plist",
          plist(
            "<dict>" +
              "<key>familyName</key><string>Guided</string>" +
              "<key>guidelines</key><array>" +
              "<dict><key>y</key><integer>512</integer><key>name</key><string>x-height</string></dict>" +
              "<dict><key>x</key><integer>60</integer></dict>" +
              "</array></dict>",
          ),
        ),
      ]),
    );

    expect(document.guides).toHaveLength(2);
    expect(document.guides[0]?.name).toBe("x-height");
    expect(document.guides[0]?.angle).toBe(0);
    expect(document.guides[1]?.angle).toBe(90);
  });

  it("writes them back", () => {
    const document = setGuides(fontDocument([glyph("a", { advance: 500 })], DEFAULT_FONT_INFO), [
      horizontalGuide("g1", 512, "x-height"),
      verticalGuide("g2", 60),
      guide("g3", { x: 0, y: 0 }, 12, "italic"),
    ]);

    const info = written(document).get("fontinfo.plist") ?? "";
    expect(info).toContain("guidelines");
    expect(info).toContain("x-height");
    expect(info).toContain("<real>12</real>");
  });

  it("does not bring back guides that were deleted", () => {
    const opened = read(
      ufo([
        file(
          "fontinfo.plist",
          plist(
            "<dict><key>familyName</key><string>Guided</string>" +
              "<key>guidelines</key><array><dict><key>y</key><integer>512</integer></dict></array></dict>",
          ),
        ),
      ]),
    );
    expect(opened.guides).toHaveLength(1);

    // The model is what is written. A guide removed here must not reappear from
    // whatever the reader kept of the file it came from.
    const info = written(setGuides(opened, [])).get("fontinfo.plist") ?? "";
    expect(info).not.toContain("guidelines");
  });
});
