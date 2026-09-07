import { counterIds, glyphNamed } from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { ufoFiles } from "../src/ufo.js";
import { readUfo } from "../src/ufo-import.js";
import type { ZipFile } from "../src/unzip.js";

/**
 * Keeping what this editor does not understand.
 *
 * A UFO carries eighty-odd `fontinfo` keys, a `lib` anybody may write into, and
 * per glyph a note, guidelines, an image and a `lib` of its own. The model holds
 * what it can act on and would drop the rest — which cost an export when the
 * only way out was Export, and costs somebody their source now that Save writes
 * over the folder they opened.
 *
 * So the question every test here asks is the same one: open it, save it, is it
 * still there.
 */

const ids = counterIds();

const file = (path: string, text: string): ZipFile => ({
  path,
  bytes: new TextEncoder().encode(text),
});

const plist = (body: string): string =>
  ['<?xml version="1.0" encoding="UTF-8"?>', '<plist version="1.0">', body, "</plist>"].join("\n");

/** A UFO with an `a` in it, plus whatever the test wants to add. */
function ufo(extra: readonly ZipFile[] = [], glif?: string): ZipFile[] {
  return [
    file("metainfo.plist", plist("<dict><key>formatVersion</key><integer>3</integer></dict>")),
    file(
      "fontinfo.plist",
      plist(
        "<dict>" +
          "<key>familyName</key><string>Kept</string>" +
          "<key>unitsPerEm</key><integer>1000</integer>" +
          "</dict>",
      ),
    ),
    file("glyphs/contents.plist", plist("<dict><key>a</key><string>a.glif</string></dict>")),
    file(
      "glyphs/a.glif",
      glif ??
        '<?xml version="1.0"?>\n<glyph name="a" format="2">\n\t<advance width="500"/>\n\t<outline/>\n</glyph>\n',
    ),
  ].filter((f) => !extra.some((e) => e.path === f.path));
}

/** The base UFO with the given files replacing or joining it. */
function ufoWith(...extra: ZipFile[]): ZipFile[] {
  return [...ufo(extra), ...extra];
}

/** Open a UFO, write it straight back out, and read the file asked for. */
function through(files: readonly ZipFile[]): Map<string, string> {
  const read = readUfo(files, ids);
  if ("reason" in read) throw new Error(read.reason);
  return new Map(ufoFiles(read.document).map((e) => [e.path, e.text]));
}

describe("what the font carries and this editor does not model", () => {
  it("keeps a fontinfo key it has never heard of", () => {
    const written = through(
      ufoWith(
        file(
          "fontinfo.plist",
          plist(
            "<dict>" +
              "<key>familyName</key><string>Kept</string>" +
              "<key>unitsPerEm</key><integer>1000</integer>" +
              "<key>openTypeOS2Panose</key><array><integer>2</integer><integer>11</integer></array>" +
              "<key>postscriptBlueValues</key><array><integer>-12</integer></array>" +
              "<key>note</key><string>drawn on a train</string>" +
              "</dict>",
          ),
        ),
      ),
    );

    const info = written.get("fontinfo.plist") ?? "";
    expect(info).toContain("openTypeOS2Panose");
    expect(info).toContain("<integer>11</integer>");
    expect(info).toContain("postscriptBlueValues");
    expect(info).toContain("drawn on a train");
  });

  it("does not let a kept key overwrite one the model owns", () => {
    // The file says 1000; the model is what the editor has since been told.
    const read = readUfo(ufo(), ids);
    if ("reason" in read) throw new Error(read.reason);

    const changed = { ...read.document, info: { ...read.document.info, unitsPerEm: 2048 } };
    const info =
      new Map(ufoFiles(changed).map((e) => [e.path, e.text])).get("fontinfo.plist") ?? "";

    expect(info).toContain("<integer>2048</integer>");
    expect(info).not.toContain("<integer>1000</integer>");
  });

  it("keeps the lib entries that are not the glyph order", () => {
    const written = through(
      ufoWith(
        file(
          "lib.plist",
          plist(
            "<dict>" +
              "<key>public.glyphOrder</key><array><string>a</string></array>" +
              "<key>com.someone.tool</key><dict><key>version</key><string>3</string></dict>" +
              "<key>public.postscriptNames</key><dict><key>a</key><string>uni0061</string></dict>" +
              "</dict>",
          ),
        ),
      ),
    );

    const lib = written.get("lib.plist") ?? "";
    expect(lib).toContain("com.someone.tool");
    expect(lib).toContain("uni0061");
    // Ours, and written once.
    expect(lib.match(/public\.glyphOrder/g)?.length).toBe(1);
  });

  it("keeps a glyph's note, image and lib, and models its guidelines", () => {
    const glif = [
      '<?xml version="1.0"?>',
      '<glyph name="a" format="2">',
      '\t<advance width="500"/>',
      "\t<outline/>",
      '\t<guideline x="120" y="0" angle="90" name="stem"/>',
      "\t<note>needs work on the join</note>",
      '\t<image fileName="a.png" xScale="0.5"/>',
      "\t<lib><dict><key>com.someone.tool</key><string>yes</string></dict></lib>",
      "</glyph>",
      "",
    ].join("\n");

    const written = through(ufo([], glif));
    const a = written.get("glyphs/a.glif") ?? "";

    // The guideline is read into the model and written back from it, so it
    // comes out spelt in full rather than in the shorthand it went in as.
    expect(a).toContain('<guideline x="120" y="0" angle="90" name="stem"/>');
    expect(a).toContain("needs work on the join");
    expect(a).toContain('fileName="a.png"');
    expect(a).toContain("com.someone.tool");
  });

  it("writes what it kept after the outline, so the file still parses as one", () => {
    const glif = [
      '<?xml version="1.0"?>',
      '<glyph name="a" format="2">',
      '\t<advance width="500"/>',
      "\t<note>hello</note>",
      "\t<outline/>",
      "</glyph>",
      "",
    ].join("\n");

    const written = through(ufo([], glif));
    const a = written.get("glyphs/a.glif") ?? "";

    // Read it once more: the surest test that what was written is a glif.
    const again = readUfo(
      [...ufo().filter((f) => f.path !== "glyphs/a.glif"), file("glyphs/a.glif", a)],
      ids,
    );
    if ("reason" in again) throw new Error(again.reason);
    expect(glyphNamed(again.document, "a")?.kept.join("")).toContain("hello");
  });

  it("has nothing to keep for a font drawn here", () => {
    const read = readUfo(ufo(), ids);
    if ("reason" in read) throw new Error(read.reason);

    expect(read.document.kept.fontInfo).toEqual({});
    expect(glyphNamed(read.document, "a")?.kept).toEqual([]);
  });
});

describe("the font's identity", () => {
  it("reads and writes the keys that make a file a released font", () => {
    const written = through(
      ufoWith(
        file(
          "fontinfo.plist",
          plist(
            "<dict>" +
              "<key>familyName</key><string>Kept</string>" +
              "<key>unitsPerEm</key><integer>1000</integer>" +
              "<key>versionMajor</key><integer>2</integer>" +
              "<key>versionMinor</key><integer>7</integer>" +
              "<key>copyright</key><string>© nobody</string>" +
              "<key>openTypeNameDesigner</key><string>A Designer</string>" +
              "<key>openTypeOS2WeightClass</key><integer>700</integer>" +
              "<key>openTypeOS2VendorID</key><string>ABCD</string>" +
              "<key>styleMapStyleName</key><string>bold</string>" +
              "<key>italicAngle</key><real>-12.5</real>" +
              "</dict>",
          ),
        ),
      ),
    );

    const info = written.get("fontinfo.plist") ?? "";
    expect(info).toContain("<key>versionMajor</key>");
    expect(info).toContain("<integer>2</integer>");
    expect(info).toContain("A Designer");
    expect(info).toContain("<integer>700</integer>");
    expect(info).toContain("ABCD");
    expect(info).toContain("<string>bold</string>");
    expect(info).toContain("<real>-12.5</real>");
  });

  it("leaves out the names nobody filled in", () => {
    const info = through(ufo()).get("fontinfo.plist") ?? "";

    expect(info).not.toContain("openTypeNameDesigner");
    expect(info).not.toContain("copyright");
    // A number is written whether or not it was stated: absent means zero here,
    // and zero is a weight class no font has.
    expect(info).toContain("openTypeOS2WeightClass");
  });

  it("takes an unknown style-map style as regular rather than believing it", () => {
    const read = readUfo(
      ufoWith(
        file(
          "fontinfo.plist",
          plist(
            "<dict><key>familyName</key><string>Kept</string>" +
              "<key>styleMapStyleName</key><string>semibold</string></dict>",
          ),
        ),
      ),
      ids,
    );
    if ("reason" in read) throw new Error(read.reason);

    expect(read.document.info.styleMapStyleName).toBe("regular");
    // Not silently dropped either: it is still somebody's key.
    expect(read.document.kept.fontInfo).toEqual({});
  });
});
