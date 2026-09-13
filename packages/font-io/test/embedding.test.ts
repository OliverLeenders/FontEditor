import {
  type FontDocument,
  type FontInfo,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  setFontInfo,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { readTablesOf } from "../src/sfnt.js";
import { readUfo } from "../src/ufo-import.js";
import type { ZipFile } from "../src/unzip.js";

/**
 * The embedding permissions: `OS/2 fsType` in the file, `openTypeOS2Type` in a
 * UFO. Read off the bytes, as the vertical metrics are.
 */

const ids = counterIds("em");

function font(patch: Partial<FontInfo> = {}): FontDocument {
  const document = fontDocument([
    glyph("H", {
      unicodes: [0x48],
      advance: 600,
      contours: [
        contour(
          ids.contour(),
          [
            node(ids.node(), { x: 50, y: 0 }),
            node(ids.node(), { x: 550, y: 0 }),
            node(ids.node(), { x: 550, y: 700 }),
          ],
          true,
        ),
      ],
    }),
  ]);
  return setFontInfo(document, { ...document.info, ...patch });
}

/** `fsType`, eight bytes into the OS/2 table. */
function fsType(bytes: ArrayBuffer): number {
  const os2 = readTablesOf(new Uint8Array(bytes)).find((t) => t.tag === "OS/2");
  if (os2 === undefined) throw new Error("no OS/2 table");
  return new DataView(os2.data.buffer, os2.data.byteOffset, os2.data.byteLength).getUint16(8);
}

describe("embedding permissions in an exported font", () => {
  it("is installable when the font has not decided, as it always was", () => {
    expect(fsType(exportFont(font()).bytes)).toBe(0);
  });

  it("writes the level and the flags the font sets", () => {
    const bytes = exportFont(font({ openTypeOS2Type: [2, 8] })).bytes;
    expect(fsType(bytes)).toBe((1 << 2) | (1 << 8));
  });
});

describe("embedding permissions from a UFO", () => {
  const file = (path: string, text: string): ZipFile => ({
    path,
    bytes: new TextEncoder().encode(text),
  });
  const plist = (body: string): string =>
    ['<?xml version="1.0" encoding="UTF-8"?>', '<plist version="1.0">', body, "</plist>"].join(
      "\n",
    );

  function readWith(bits: string): FontInfo {
    const files = [
      file("metainfo.plist", plist("<dict><key>formatVersion</key><integer>3</integer></dict>")),
      file(
        "fontinfo.plist",
        plist(
          "<dict><key>familyName</key><string>Embedded</string>" +
            `<key>openTypeOS2Type</key><array>${bits}</array></dict>`,
        ),
      ),
      file("glyphs/contents.plist", plist("<dict><key>a</key><string>a.glif</string></dict>")),
      file(
        "glyphs/a.glif",
        '<?xml version="1.0"?>\n<glyph name="a" format="2"><advance width="500"/><outline/></glyph>\n',
      ),
    ];
    const read = readUfo(files, ids);
    if ("reason" in read) throw new Error(read.reason);
    return read.document.info;
  }

  it("reads the level and the flags a source sets", () => {
    expect(readWith("<integer>3</integer><integer>9</integer>").openTypeOS2Type).toEqual([3, 9]);
  });

  it("keeps one level of two, the less restrictive, and drops bits that mean nothing", () => {
    // Restricted and editable both set, and a reserved bit: the specification says
    // the least restrictive level applies, and a font read in with two would refuse
    // every edit afterwards.
    const bits = "<integer>1</integer><integer>3</integer><integer>0</integer><integer>8</integer>";
    expect(readWith(bits).openTypeOS2Type).toEqual([3, 8]);
  });
});
