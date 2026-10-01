import {
  DEFAULT_FONT_INFO,
  counterIds,
  fontDocument,
  glyph,
  rectContour,
  setFixedPitch,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { importFont } from "../src/import.js";
import { opentype } from "../src/opentype.js";
import { exportTrueType } from "../src/truetype.js";
import { exportUfo, ufoFiles } from "../src/ufo.js";
import { importUfo } from "../src/ufo-import.js";
import { entryText } from "../src/zip.js";

/**
 * The grid and the fixed width through a file and back.
 *
 * The source keeps both, the flag where UFO has a field for it and the rest in
 * the lib under this editor's name. The compiled font keeps what software reads:
 * the flag in `post`, the proportion in PANOSE, and the width as the average.
 */

const ids = counterIds("fwio");

const box = (name: string, left: number, width: number, right: number) =>
  glyph(name, {
    advance: left + width + right,
    unicodes: [name.charCodeAt(0)],
    contours: [rectContour(ids, { minX: left, minY: 0, maxX: left + width, maxY: 700 })],
  });

const mono = () =>
  setFixedPitch(
    {
      ...fontDocument(
        [glyph(".notdef", { advance: 600 }), box("i", 250, 100, 250), box("m", 50, 500, 50)],
        { ...DEFAULT_FONT_INFO, familyName: "Mono", styleName: "Regular" },
      ),
      grid: { step: 20, major: 2 },
    },
    true,
    600,
  );

describe("a UFO drawn on a grid at a fixed width", () => {
  it("reads back the grid, the width and the flag", async () => {
    const back = await importUfo(exportUfo(mono()).bytes.slice().buffer, ids);
    if ("reason" in back) throw new Error(back.reason);

    expect(back.document.grid).toEqual({ step: 20, major: 2 });
    expect(back.document.fixedWidth).toBe(600);
    expect(back.document.info.postscriptIsFixedPitch).toBe(true);
    // Read into the model, so not also carried as somebody else's lib keys.
    expect(Object.keys(back.document.kept.lib)).toEqual([]);
    expect(Object.keys(back.document.kept.fontInfo)).toEqual([]);
  });

  it("writes the flag where UFO keeps it", () => {
    const info = ufoFiles(mono()).find((entry) => entry.path.endsWith("fontinfo.plist"));
    expect(info === undefined ? "" : entryText(info)).toMatch(
      /<key>postscriptIsFixedPitch<\/key>\s*<true\/>/,
    );
  });

  it("writes nothing for a font on whole units that is not fixed", () => {
    const plain = fontDocument([glyph(".notdef", { advance: 500 }), box("n", 40, 300, 50)]);
    const files = ufoFiles(plain).map(entryText).join("\n");
    expect(files).not.toContain("org.typewright.grid");
    expect(files).not.toContain("org.typewright.fixedWidth");
    expect(files).not.toContain("postscriptIsFixedPitch");
  });
});

describe("a compiled fixed-width font", () => {
  it("says it is fixed in post and PANOSE, and gives its width as the average", () => {
    for (const bytes of [exportFont(mono()).bytes, exportTrueType(mono()).bytes]) {
      const font = opentype.parse(bytes);
      expect(font.tables.post?.isFixedPitch).toBe(1);
      const os2 = font.tables.os2 as unknown as {
        xAvgCharWidth: number;
        panose: readonly number[];
      };
      expect(os2.xAvgCharWidth).toBe(600);
      expect(os2.panose[0]).toBe(2);
      expect(os2.panose[3]).toBe(9);
    }
  });

  it("says nothing of the kind for a proportional font", () => {
    const font = opentype.parse(exportFont(setFixedPitch(mono(), false)).bytes);
    expect(font.tables.post?.isFixedPitch).toBe(0);
  });

  it("opens as fixed, at the width its glyphs are", () => {
    const back = importFont(exportFont(mono()).bytes, ids);
    expect(back.document.info.postscriptIsFixedPitch).toBe(true);
    expect(back.document.fixedWidth).toBe(600);
  });
});
