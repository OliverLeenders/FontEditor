import { madeFork } from "@typewright/stuffit/testing";

/**
 * Classic Macintosh bitmap fonts, built here from the format: the strikes and
 * families the Mac font tests read, and the files the fuzz tests spoil.
 */

/**
 * A glyph as a picture, which is what a bitmap font is.
 *
 * `#` is a lit pixel and anything else is not, so a test says what the font
 * looks like instead of saying which bits are set in which byte — and a failure
 * can be read off the page.
 */
export type Drawn = {
  readonly code: number;
  readonly rows: readonly string[];
  /** How far the pen moves, which is usually a pixel wider than the picture. */
  readonly width: number;
  /** Where the picture sits relative to the pen. */
  readonly offset?: number;
};

export type Metrics = {
  readonly ascent: number;
  readonly descent: number;
  readonly kernMax?: number;
};

/** An `NFNT` resource holding these pictures side by side. */
export function madeStrike(drawn: readonly Drawn[], metrics: Metrics): Uint8Array {
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
export function madeFamily(size: number, resourceId: number): Uint8Array {
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

export const ALPHABET: readonly Drawn[] = [
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

export const METRICS: Metrics = { ascent: 5, descent: 2 };

export function suitcaseFork(): Uint8Array {
  return madeFork([
    { type: "FOND", id: 2017, name: "Pixelface", bytes: madeFamily(7, 2017) },
    { type: "NFNT", id: 2017, name: "Pixelface", bytes: madeStrike(ALPHABET, METRICS) },
  ]);
}
