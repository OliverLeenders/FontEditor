import {
  type FontDocument,
  type FontInfo,
  USE_TYPO_METRICS_BIT,
  contour,
  counterIds,
  derivedVerticalMetrics,
  fontDocument,
  glyph,
  node,
  setFontInfo,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { readTablesOf } from "../src/sfnt.js";
import { exportTrueType } from "../src/truetype.js";
import { exportUfo } from "../src/ufo.js";
import { importUfo } from "../src/ufo-import.js";

/**
 * The vertical metrics, as they come out of the file.
 *
 * Read off the bytes of `OS/2` and `hhea` rather than through a parser, because
 * the claim being tested is about what is in the file — and a parser that
 * derived a missing value would pass a test the file itself fails.
 */

const ids = counterIds("m");

/** A rectangle from y0 to y1. */
const bar = (y0: number, y1: number) =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 50, y: y0 }),
      node(ids.node(), { x: 550, y: y0 }),
      node(ids.node(), { x: 550, y: y1 }),
      node(ids.node(), { x: 50, y: y1 }),
    ],
    true,
  );

function font(patch: Partial<FontInfo> = {}): FontDocument {
  const document = fontDocument([
    glyph("H", { unicodes: [0x48], advance: 600, contours: [bar(0, 700)] }),
    glyph("p", { unicodes: [0x70], advance: 600, contours: [bar(-230, 500)] }),
  ]);
  return setFontInfo(document, { ...document.info, ...patch });
}

function tableOf(bytes: ArrayBuffer, tag: string): DataView {
  const found = readTablesOf(new Uint8Array(bytes)).find((t) => t.tag === tag);
  if (found === undefined) throw new Error(`no ${tag} table`);
  return new DataView(found.data.buffer, found.data.byteOffset, found.data.byteLength);
}

/** The OS/2 fields that matter here, at their offsets in the table. */
function os2(bytes: ArrayBuffer) {
  const v = tableOf(bytes, "OS/2");
  return {
    version: v.getUint16(0),
    fsSelection: v.getUint16(62),
    typoAscender: v.getInt16(68),
    typoDescender: v.getInt16(70),
    typoLineGap: v.getInt16(72),
    winAscent: v.getUint16(74),
    winDescent: v.getUint16(76),
  };
}

function hhea(bytes: ArrayBuffer) {
  const v = tableOf(bytes, "hhea");
  return { ascender: v.getInt16(4), descender: v.getInt16(6), lineGap: v.getInt16(8) };
}

describe("vertical metrics in an exported font", () => {
  it("writes exactly what the panel says it will, when nothing is set", () => {
    const document = font();
    const { bytes } = exportFont(document);
    const derived = derivedVerticalMetrics(document);

    expect(os2(bytes)).toMatchObject({
      version: 3,
      typoAscender: derived.typoAscender,
      typoDescender: derived.typoDescender,
      typoLineGap: derived.typoLineGap,
      winAscent: derived.winAscent,
      winDescent: derived.winDescent,
    });
    expect(hhea(bytes)).toEqual({
      ascender: derived.hheaAscender,
      descender: derived.hheaDescender,
      lineGap: derived.hheaLineGap,
    });
    expect(os2(bytes).fsSelection & (1 << USE_TYPO_METRICS_BIT)).toBe(0);
  });

  it("writes every override the font sets", () => {
    const { bytes } = exportFont(
      font({
        openTypeOS2TypoAscender: 800,
        openTypeOS2TypoDescender: -200,
        openTypeOS2TypoLineGap: 200,
        openTypeOS2WinAscent: 950,
        openTypeOS2WinDescent: 300,
        openTypeHheaAscender: 900,
        openTypeHheaDescender: -300,
        openTypeHheaLineGap: 40,
      }),
    );

    expect(os2(bytes)).toMatchObject({
      typoAscender: 800,
      typoDescender: -200,
      typoLineGap: 200,
      winAscent: 950,
      winDescent: 300,
    });
    expect(hhea(bytes)).toEqual({ ascender: 900, descender: -300, lineGap: 40 });
  });

  it("sets the typo metrics bit, on a table version that defines it", () => {
    const { bytes } = exportFont(font({ openTypeOS2Selection: [USE_TYPO_METRICS_BIT] }));
    const table = os2(bytes);

    expect(table.fsSelection & (1 << USE_TYPO_METRICS_BIT)).not.toBe(0);
    expect(table.version).toBe(4);
    // And the style map's own bit is still there: REGULAR, for this font.
    expect(table.fsSelection & 64).toBe(64);
  });

  it("will not let a source's selection list override the style map's bits", () => {
    // Bit 5 is BOLD. A regular font saying so in its selection list is wrong,
    // and the style map is what decides.
    const { bytes } = exportFont(font({ openTypeOS2Selection: [5] }));
    expect(os2(bytes).fsSelection & 32).toBe(0);
  });

  it("keeps them through the TrueType flavour, which is rebuilt from the same file", () => {
    const { bytes } = exportTrueType(
      font({ openTypeOS2TypoLineGap: 120, openTypeHheaLineGap: 120 }),
    );
    expect(os2(bytes).typoLineGap).toBe(120);
    expect(hhea(bytes).lineGap).toBe(120);
  });
});

describe("vertical metrics in a UFO", () => {
  async function roundTrip(document: FontDocument): Promise<FontDocument> {
    const out = await importUfo(exportUfo(document).bytes.buffer as ArrayBuffer, counterIds("r"));
    if ("reason" in out) throw new Error(out.reason);
    return out.document;
  }

  it("keeps what was set, and leaves unset what was not", async () => {
    const back = await roundTrip(
      font({ openTypeOS2TypoLineGap: 200, openTypeOS2Selection: [USE_TYPO_METRICS_BIT] }),
    );

    expect(back.info.openTypeOS2TypoLineGap).toBe(200);
    expect(back.info.openTypeOS2Selection).toEqual([USE_TYPO_METRICS_BIT]);
    expect(back.info.openTypeHheaAscender).toBeNull();
    expect(back.info.openTypeOS2WinAscent).toBeNull();
  });

  it("does not also carry them as something it does not understand", async () => {
    // Modelled keys excluded from what is kept, or a save would write each twice.
    const back = await roundTrip(font({ openTypeHheaLineGap: 10 }));
    expect(Object.keys(back.kept)).not.toContain("openTypeHheaLineGap");
  });
});
