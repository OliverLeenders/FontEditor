import {
  DEFAULT_FONT_INFO,
  counterIds,
  fontDocument,
  glyph,
  rectContour,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { exportUfo, ufoFiles } from "../src/ufo.js";
import { importUfo } from "../src/ufo-import.js";
import { entryText, zip } from "../src/zip.js";

/**
 * Spacing taken from another glyph, through a file and back.
 *
 * Neither UFO nor OpenType has a field for this, so the two halves differ. The
 * source keeps the rule, under this editor's own name in the font's `lib`,
 * because that is what a lib is for. The compiled font keeps only the answer:
 * a font file records an advance and an outline position, and that is all a
 * rasteriser ever sees.
 */

const ids = counterIds("mkio");

const box = (name: string, left: number, width: number, right: number, keys = {}) =>
  glyph(name, {
    advance: left + width + right,
    unicodes: [name.charCodeAt(0)],
    contours: [rectContour(ids, { minX: left, minY: 0, maxX: left + width, maxY: 700 })],
    metricKeys: { left: "", right: "", width: "", ...keys },
  });

const font = () =>
  fontDocument(
    [
      glyph(".notdef", { advance: 500 }),
      box("n", 40, 300, 50),
      box("m", 10, 500, 10, { left: "n", right: "n" }),
    ],
    { ...DEFAULT_FONT_INFO, familyName: "Keys", styleName: "Regular" },
  );

describe("a UFO carrying the rules", () => {
  it("writes them under this editor's own name and reads them back", async () => {
    const back = await importUfo(exportUfo(font()).bytes.slice().buffer, ids);
    if ("reason" in back) throw new Error(back.reason);

    expect(back.document.glyphs["m"]?.metricKeys).toEqual({ left: "n", right: "n", width: "" });
    // And a glyph that says nothing still says nothing.
    expect(back.document.glyphs["n"]?.metricKeys).toEqual({ left: "", right: "", width: "" });
  });

  it("keeps the drawn numbers as well as the rule", async () => {
    // The source is what was drawn. Resolving on the way out would make opening
    // and saving a file change it, which a source format must never do.
    const back = await importUfo(exportUfo(font()).bytes.slice().buffer, ids);
    if ("reason" in back) throw new Error(back.reason);

    expect(back.document.glyphs["m"]?.advance).toBe(520);
  });

  it("reads the rules a font saved before the editor was named", async () => {
    // The key is in somebody's source folder on disk, written by this editor
    // under the name it used to have. Not reading it would quietly drop every
    // spacing rule in every font saved before the rename.
    const renamed = ufoFiles(font()).map((entry) =>
      entry.path.endsWith("lib.plist")
        ? {
            path: entry.path,
            text: entryText(entry).replace(
              "org.typewright.metricKeys",
              "org.fonteditor.metricKeys",
            ),
          }
        : entry,
    );

    const back = await importUfo(zip(renamed).slice().buffer, ids);
    if ("reason" in back) throw new Error(back.reason);

    expect(back.document.glyphs["m"]?.metricKeys).toEqual({ left: "n", right: "n", width: "" });
  });

  it("writes the rules back under the new name, and does not keep the old one", async () => {
    const lib = ufoFiles(font()).find((entry) => entry.path.endsWith("lib.plist"));
    const text = lib === undefined ? "" : entryText(lib);

    expect(text).toContain("org.typewright.metricKeys");
    expect(text).not.toContain("org.fonteditor.metricKeys");
  });

  it("writes no lib entry for a font where nothing says anything", async () => {
    const plain = fontDocument([glyph(".notdef", { advance: 500 }), box("n", 40, 300, 50)]);
    const written = exportUfo(plain);
    const back = await importUfo(written.bytes.slice().buffer, ids);
    if ("reason" in back) throw new Error(back.reason);

    expect(back.document.glyphs["n"]?.metricKeys).toEqual({ left: "", right: "", width: "" });
  });
});

describe("a compiled font carrying the answers", () => {
  it("comes out with the spacing the rules asked for", () => {
    // 40 either side of a 500-wide box is 580, where the drawing said 520.
    const out = exportFont(font());
    expect(out.warnings).toEqual([]);
    expect(out.bytes.byteLength).toBeGreaterThan(0);
  });

  it("says which rule it could not follow, and writes the font anyway", () => {
    const broken = fontDocument([
      glyph(".notdef", { advance: 500 }),
      box("m", 10, 500, 10, { left: "gone" }),
    ]);

    const out = exportFont(broken);
    expect(out.warnings.join(" ")).toMatch(/^m is spaced from gone, which is not in this font/);
  });
});
