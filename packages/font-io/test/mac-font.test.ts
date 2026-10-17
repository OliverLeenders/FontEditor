import { counterIds, insideGlyph } from "@typewright/font-model";
import { readResourceFork } from "@typewright/stuffit";
import { madeArchive, madeFork } from "@typewright/stuffit/testing";
import { describe, expect, it } from "vitest";

import {
  documentFromSuitcase,
  importMacFont,
  largestStrike,
  looksLikeMacFontFile,
  readStrike,
  readSuitcase,
} from "../src/mac-font.js";
import { ALPHABET, METRICS, madeStrike, suitcaseFork } from "./mac-fixtures.js";

describe("reading a strike", () => {
  const strike = readStrike(madeStrike(ALPHABET, METRICS));

  it("reads the metrics the font was made with", () => {
    expect(strike.firstChar).toBe(0x2e);
    expect(strike.lastChar).toBe(0x5c);
    expect(strike.ascent).toBe(5);
    expect(strike.descent).toBe(2);
    expect(strike.rectHeight).toBe(7);
  });

  it("finds each picture in the one long row of pixels", () => {
    const o = strike.glyphs.find((g) => g.code === 0x4f)!;
    expect(o.pixels).toBe(4);
    expect(o.width).toBe(5);
    expect([...Array(4).keys()].map((x) => (strike.lit(o.x + x, 0) ? "#" : "."))).toEqual([
      ".",
      "#",
      "#",
      ".",
    ]);
  });

  it("marks the characters the font has not got", () => {
    const missing = strike.glyphs.filter((g) => g.missing).map((g) => g.code);
    expect(missing).toContain(0x30);
    expect(missing).not.toContain(0x4f);
  });

  it("refuses a strike with more than one bit per pixel", () => {
    const colour = madeStrike(ALPHABET, METRICS);
    colour[1] = 0x08; // the depth field, saying four bits
    expect(() => readStrike(colour)).toThrow(/bits per pixel/);
  });
});

describe("reading a suitcase", () => {
  it("finds the family and the strike it names", () => {
    const suitcase = readSuitcase(readResourceFork(suitcaseFork()));
    expect(suitcase.families).toHaveLength(1);
    expect(suitcase.families[0]!.association).toEqual([{ size: 7, style: 0, resourceId: 2017 }]);
    expect(largestStrike(suitcase)!.id).toBe(2017);
  });

  it("takes the biggest strike when there are several", () => {
    const fork = readResourceFork(
      madeFork([
        { type: "NFNT", id: 1, bytes: madeStrike(ALPHABET, { ascent: 5, descent: 2 }) },
        { type: "NFNT", id: 2, bytes: madeStrike(ALPHABET, { ascent: 9, descent: 3 }) },
      ]),
    );
    expect(largestStrike(readSuitcase(fork))!.id).toBe(2);
  });

  it("hands back an outline font rather than trying to read it", () => {
    const fork = readResourceFork(
      madeFork([{ type: "sfnt", id: 128, bytes: Uint8Array.from([1, 2]) }]),
    );
    expect([...readSuitcase(fork).sfnts[0]!]).toEqual([1, 2]);
  });
});

describe("converting a strike to outlines", () => {
  const { document } = documentFromSuitcase(
    readSuitcase(readResourceFork(suitcaseFork())),
    counterIds(),
  );

  it("makes the strike's own ascent and descent the em", () => {
    expect(document.info.unitsPerEm).toBe(700);
    expect(document.info.ascender).toBe(500);
    expect(document.info.descender).toBe(-200);
    expect(document.info.styleName).toBe("7 px");
  });

  it("names the glyphs by what they encode", () => {
    expect(document.glyphOrder).toEqual([".notdef", "period", "O", "backslash"]);
    expect(document.glyphs.O!.unicodes).toEqual([0x4f]);
  });

  it("draws .notdef with the picture the strike keeps for it", () => {
    // The strike's own missing-glyph picture, which is the last entry in its
    // width table rather than a character of its own.
    const notdef = document.glyphs[".notdef"]!;
    expect(notdef.advance).toBe(0);
    expect(notdef.unicodes).toEqual([]);
  });

  it("takes the advance from the strike rather than from the picture", () => {
    // Five pixels of pen movement for a four pixel picture: the gap after a
    // letter is part of the letter.
    expect(document.glyphs.O!.advance).toBe(500);
    expect(document.glyphs.period!.advance).toBe(300);
  });

  it("draws every pixel and nothing else", () => {
    for (const drawn of ALPHABET) {
      const g = document.glyphs[nameOf(drawn.code)]!;
      drawn.rows.forEach((row, y) => {
        [...row].forEach((c, x) => {
          const at = { x: x * 100 + 50, y: 500 - y * 100 - 50 };
          expect(insideGlyph(g, at), `${nameOf(drawn.code)} at ${String(x)},${String(y)}`).toBe(
            c === "#",
          );
        });
      });
    }
  });

  it("keeps a counter as a hole rather than filling it in", () => {
    const o = document.glyphs.O!;
    expect(o.contours.length).toBeGreaterThanOrEqual(2);
    // The middle of the O, which is inside the outline but outside the letter.
    expect(insideGlyph(o, { x: 250, y: 200 })).toBe(false);
  });

  it("makes a solid block one contour with four corners", () => {
    const block = document.glyphs.period!;
    expect(block.contours).toHaveLength(1);
    expect(block.contours[0]!.nodes).toHaveLength(4);
  });

  it("keeps pixels that touch only at a corner from merging into one shape", () => {
    // Each step of a diagonal is its own square. They meet at a point, and the
    // point is not ink.
    const diagonal = document.glyphs.backslash!;
    expect(diagonal.contours).toHaveLength(4);
  });

  it("puts a picture where the strike's kerning says", () => {
    const shifted = madeStrike([{ code: 0x4f, rows: ["##"], width: 4, offset: 1 }], {
      ascent: 3,
      descent: 1,
      kernMax: -2,
    });
    const fork = readResourceFork(madeFork([{ type: "NFNT", id: 1, bytes: shifted }]));
    const made = documentFromSuitcase(readSuitcase(fork), counterIds()).document;

    // kernMax -2 and an offset of 1: the picture starts one pixel left of the
    // pen, so the glyph reaches to -100.
    const left = Math.min(...made.glyphs.O!.contours[0]!.nodes.map((n) => n.pt.x));
    expect(left).toBe(-100);
  });
});

describe("a font inside a StuffIt archive", () => {
  const archive = madeArchive([
    { name: "read me", data: Uint8Array.from([1, 2, 3]) },
    { name: "Pixelface", type: "FFIL", creator: "DMOV", resource: suitcaseFork() },
  ]);

  it("is what a `.sit` file is recognised as", () => {
    expect(looksLikeMacFontFile(archive)).toBe(true);
    expect(looksLikeMacFontFile(Uint8Array.from([0, 1, 2]))).toBe(false);
  });

  it("is found past whatever else is in the archive", () => {
    const found = importMacFont(archive, counterIds());
    expect(found.kind).toBe("bitmap");
    if (found.kind !== "bitmap") return;
    expect(found.document.glyphOrder).toContain("O");
    expect(found.document.info.familyName).toBe("Pixelface");
  });

  it("says so when the archive holds no font", () => {
    const empty = madeArchive([{ name: "read me", data: Uint8Array.from([1]) }]);
    expect(() => importMacFont(empty, counterIds())).toThrow(/no font/);
  });
});

function nameOf(code: number): string {
  return { 0x4f: "O", 0x5c: "backslash", 0x2e: "period" }[code] ?? String(code);
}
