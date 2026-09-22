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

/**
 * A glyph as a picture, which is what a bitmap font is.
 *
 * `#` is a lit pixel and anything else is not, so a test says what the font
 * looks like instead of saying which bits are set in which byte — and a failure
 * can be read off the page.
 */
type Drawn = {
  readonly code: number;
  readonly rows: readonly string[];
  /** How far the pen moves, which is usually a pixel wider than the picture. */
  readonly width: number;
  /** Where the picture sits relative to the pen. */
  readonly offset?: number;
};

type Metrics = {
  readonly ascent: number;
  readonly descent: number;
  readonly kernMax?: number;
};

/** An `NFNT` resource holding these pictures side by side. */
function madeStrike(drawn: readonly Drawn[], metrics: Metrics): Uint8Array {
  const height = Math.max(...drawn.map((d) => d.rows.length));
  const first = Math.min(...drawn.map((d) => d.code));
  const last = Math.max(...drawn.map((d) => d.code));

  // One entry per character in the range, plus the missing glyph, plus the
  // extra location that says where the last picture ends.
  const count = last - first + 3;
  const pictures: (Drawn | null)[] = [];
  for (let code = first; code <= last; code++) {
    pictures.push(drawn.find((d) => d.code === code) ?? null);
  }
  // The missing glyph, which every strike has after the last character.
  pictures.push({ code: last + 1, rows: [], width: 0 });

  const widths = pictures.map((p) => (p === null ? 0 : (p.rows[0]?.length ?? 0)));
  const total = widths.reduce((a, b) => a + b, 0);
  const rowBytes = Math.ceil(total / 16) * 2;

  const image = new Uint8Array(rowBytes * height);
  let x = 0;
  for (const picture of pictures) {
    if (picture === null) continue;
    picture.rows.forEach((row, y) => {
      [...row].forEach((c, i) => {
        if (c !== "#") return;
        const bit = x + i;
        const at = y * rowBytes + (bit >> 3);
        image[at] = image[at]! | (0x80 >> (bit & 7));
      });
    });
    x += picture.rows[0]?.length ?? 0;
  }

  const out: number[] = [];
  const u16 = (value: number): void => {
    out.push((value >> 8) & 0xff, value & 0xff);
  };

  u16(0x9000); // font type: one bit per pixel
  u16(first);
  u16(last);
  u16(Math.max(...drawn.map((d) => d.width)));
  u16((metrics.kernMax ?? 0) & 0xffff);
  u16(0xffff); // nDescent, which nothing here reads
  u16(Math.max(...widths));
  u16(height);
  // Where the width table is, counted in words from this field.
  const imageWords = (rowBytes * height) / 2;
  u16(5 + imageWords + count);
  u16(metrics.ascent);
  u16(metrics.descent);
  u16(0); // leading
  u16(rowBytes / 2);

  for (const byte of image) out.push(byte);

  let at = 0;
  for (const width of widths) {
    u16(at);
    at += width;
  }
  u16(at);

  for (const picture of pictures) {
    if (picture === null) {
      u16(0xffff); // no such character
      continue;
    }
    out.push(picture.offset ?? 0, picture.width);
  }

  return Uint8Array.from(out);
}

/** A `FOND` resource naming one strike, at one size. */
function madeFamily(size: number, resourceId: number): Uint8Array {
  const out = new Uint8Array(60);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0x4000); // flags
  view.setInt16(2, 2017); // the family's number
  view.setInt16(52, 0); // one entry in the association table
  view.setInt16(54, size);
  view.setInt16(56, 0); // plain, rather than bold or italic
  view.setInt16(58, resourceId);
  return out;
}

const ALPHABET: readonly Drawn[] = [
  {
    // A capital O: the test that a counter stays a counter.
    code: 0x4f,
    rows: [".##.", "#..#", "#..#", "#..#", ".##.", "....", "...."],
    width: 5,
  },
  {
    // A diagonal, whose pixels touch only at their corners.
    code: 0x5c,
    rows: ["#...", ".#..", "..#.", "...#", "....", "....", "...."],
    width: 5,
  },
  {
    // A full block, which should come out as one four-cornered contour.
    code: 0x2e,
    rows: ["##", "##", "##", "##", "##", "##", "##"],
    width: 3,
  },
];

const METRICS: Metrics = { ascent: 5, descent: 2 };

function suitcaseFork(): Uint8Array {
  return madeFork([
    { type: "FOND", id: 2017, name: "Pixelface", bytes: madeFamily(7, 2017) },
    { type: "NFNT", id: 2017, name: "Pixelface", bytes: madeStrike(ALPHABET, METRICS) },
  ]);
}

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
