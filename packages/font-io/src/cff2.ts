import type { Vec2 } from "@typewright/geometry";
import type { Axis, Glyph, Location } from "@typewright/font-model";
import { segmentCubic, segments } from "@typewright/font-model";

import { Bytes } from "./bytes.js";
import { itemVariationStore, regionsOf } from "./varstore.js";

/**
 * `CFF2`: cubic outlines that vary.
 *
 * The other way to make a variable font is TrueType, where the outlines are
 * quadratic and the variation lives in a separate `gvar` table. This editor
 * draws cubics, so CFF2 is the format that carries the drawing as drawn —
 * converting to quadratics is an approximation, and approximating something in
 * order to make it variable means every instance is approximated twice.
 *
 * A CFF2 charstring is a CFF charstring with three differences that matter
 * here. There is no width in it — that lives in `hmtx`. There is no `endchar`.
 * And there is `blend`, which is the whole of variation: a value followed by
 * its deltas, one per region, collapsed on the stack into the one value that
 * applies wherever the font is being drawn.
 *
 *     40 5 -3 2 blend        one value: 40 by default, 45 in region 1, 37 in 2
 *
 * The regions themselves are in the variation store, which the top dictionary
 * points at. Deltas next to their values, regions in one place: the reverse of
 * `gvar`, where the deltas are gathered per glyph and the regions inline.
 */

/** What a font needs to be written as CFF2: the masters, and where they sit. */
export type Cff2Font = {
  readonly axes: readonly Axis[];
  /** Where each master sits. The first is the default and everything varies from it. */
  readonly locations: readonly Location[];
  /**
   * The glyphs of each master, in one order: `masters[m][g]`.
   *
   * Every master must have every glyph, in the same order and compatible —
   * which is what the compatibility check is for. A glyph that is not is
   * written from the default master alone and does not vary.
   */
  readonly masters: readonly (readonly Glyph[])[];
  /** How wide the em is, for the font matrix. */
  readonly unitsPerEm: number;
};

export type Cff2Result = {
  readonly table: Uint8Array;
  /** Glyphs written from the default master alone, because the masters disagree. */
  readonly notVarying: readonly string[];
};

// Charstring operators. Only the four a drawing needs.
const RMOVETO = 21;
const RLINETO = 5;
const RRCURVETO = 8;
const BLEND = 16;

// Top dictionary operators.
const OP_CHARSTRINGS = 17;
const OP_VSTORE = 24;
const OP_FDARRAY = [12, 36];
const OP_FONTMATRIX = [12, 7];
const OP_PRIVATE = 18;

/**
 * Write the whole table.
 *
 * Laid out in two passes, as everything in this format is: the pieces that
 * offsets point at are built first and measured, then the dictionaries that
 * point at them are written with the offsets filled in. The dictionaries change
 * size as their offsets do, which is why every offset here is written as a
 * five-byte integer whatever its value — a fixed size is worth four wasted
 * bytes against a layout that has to converge.
 */
export function cff2Table(font: Cff2Font): Cff2Result {
  const base = font.masters[0];
  if (base === undefined || base.length === 0) {
    return { table: new Uint8Array(), notVarying: [] };
  }

  const regions = regionsOf(font.axes, font.locations);
  // The store as CFF2 holds it: a two-byte length, then the item variation
  // store itself. Every other table that carries one puts it in on its own, and
  // this is the format that wraps it.
  const bare = itemVariationStore(font.axes, regions);
  const store = new Bytes().u16(bare.length).bytes(bare).done();

  const notVarying: string[] = [];
  const charstrings = base.map((glyph, i) => {
    const others = font.masters.slice(1).map((m) => m[i] ?? null);
    const varying = others.every((g) => g !== null && sameShape(glyph, g));
    if (!varying && others.length > 0) notVarying.push(glyph.name);

    return charstring(glyph, varying ? (others as Glyph[]) : [], regions.length);
  });

  const charStringsIndex = index(charstrings);
  const globalSubrs = index([]);

  // A single font dictionary, which is what a font with one set of hints has.
  // Its private dictionary is empty apart from the count of variation regions
  // the charstrings blend over.
  const privateDict = new Bytes().done();
  const fontDict = (privateAt: number): Uint8Array =>
    new Bytes()
      .bytes(dictOperand(privateDict.length))
      .bytes(dictOperand(privateAt))
      .u8(OP_PRIVATE)
      .done();

  // Everything after the top dictionary, laid out so the offsets are known.
  // The header and the top dictionary are a fixed size because every offset in
  // it is written five bytes wide.
  // The header is five bytes and the last two of them *are* the top
  // dictionary's length, so the dictionary begins at five and the count is not
  // added again.
  const headerSize = 5;
  const topDictLength = topDict(font, 0, 0, 0, 0).length;
  const after = headerSize + topDictLength + globalSubrs.length;

  const storeAt = after;
  const fdArrayAt = storeAt + store.length;
  // The FDArray is an INDEX of one dictionary, whose own length depends on the
  // private dictionary's offset, which sits after it. Written twice: once to
  // measure, once with the answer.
  const fdArrayGuess = index([fontDict(0)]);
  const privateAt = fdArrayAt + fdArrayGuess.length;
  const fdArray = index([fontDict(privateAt)]);
  const charStringsAt = privateAt + privateDict.length;

  const out = new Bytes();
  out.u8(2).u8(0).u8(headerSize).u16(topDictLength);
  out.bytes(topDict(font, charStringsAt, storeAt, fdArrayAt, 0));
  out.bytes(globalSubrs);
  out.bytes(store);
  out.bytes(fdArray);
  out.bytes(privateDict);
  out.bytes(charStringsIndex);

  return { table: out.done(), notVarying };
}

/**
 * The top dictionary.
 *
 * `FDSelect` is left out: a font with one font dictionary does not need one,
 * and every glyph uses the first by default.
 */
function topDict(
  font: Cff2Font,
  charStringsAt: number,
  storeAt: number,
  fdArrayAt: number,
  _fdSelectAt: number,
): Uint8Array {
  const out = new Bytes();

  // The em, as a matrix. A thousand-unit em is the default and could be left
  // out; anything else has to be said, and saying it always is one fewer branch
  // between here and a font drawn at the wrong size.
  const scale = 1 / (font.unitsPerEm || 1000);
  out.bytes(dictReal(scale)).bytes(dictReal(0)).bytes(dictReal(0)).bytes(dictReal(scale));
  out.bytes(dictReal(0)).bytes(dictReal(0)).u8(OP_FONTMATRIX[0]!).u8(OP_FONTMATRIX[1]!);

  out.bytes(dictOperand(charStringsAt)).u8(OP_CHARSTRINGS);
  out.bytes(dictOperand(fdArrayAt)).u8(OP_FDARRAY[0]!).u8(OP_FDARRAY[1]!);
  out.bytes(dictOperand(storeAt)).u8(OP_VSTORE);

  return out.done();
}

/**
 * One glyph, as a charstring, with its deltas beside its values.
 *
 * The default master draws the outline; every other master contributes one
 * delta per coordinate per region. Where there is nothing varying — a font with
 * one master, or a glyph the masters disagree about — no `blend` is written at
 * all and the charstring is an ordinary one.
 */
function charstring(glyph: Glyph, others: readonly Glyph[], regions: number): Uint8Array {
  const out = new Bytes();
  const varying = others.length > 0 && regions > 0;

  // The pen runs on across the whole charstring, not per contour: every
  // coordinate is relative to the last one written, and the second contour's
  // first move is measured from where the first contour ended. Each master
  // keeps its own pen, because the deltas are between the *moves*.
  let at: Vec2 = { x: 0, y: 0 };
  const others_at: Vec2[] = others.map(() => ({ x: 0, y: 0 }));

  for (const [c, contour] of glyph.contours.entries()) {
    if (contour.nodes.length < 2) continue;

    const paths = others.map((g) => g.contours[c]);

    const start = contour.nodes[0]?.pt;
    if (start === undefined) continue;

    // Every coordinate in a charstring is relative to the last one, so each
    // master keeps its own pen position and the deltas are between the moves,
    // not between the points.
    const moves = paths.map((path, i) => {
      const there = path?.nodes[0]?.pt ?? start;
      const step = { x: there.x - others_at[i]!.x, y: there.y - others_at[i]!.y };
      others_at[i] = there;
      return step;
    });
    emit(
      out,
      [start.x - at.x, start.y - at.y],
      moves.map((m) => [m.x, m.y]),
      RMOVETO,
      varying,
    );
    at = start;

    for (const [s, segment] of segments(contour).entries()) {
      const cubic = segmentCubic(segment);
      const line = segment.kind === "line";

      const step = line
        ? [cubic.b.x - at.x, cubic.b.y - at.y]
        : [
            cubic.c1.x - at.x,
            cubic.c1.y - at.y,
            cubic.c2.x - cubic.c1.x,
            cubic.c2.y - cubic.c1.y,
            cubic.b.x - cubic.c2.x,
            cubic.b.y - cubic.c2.y,
          ];

      const steps = paths.map((path, i) => {
        const otherSegment = path === undefined ? null : segments(path)[s];
        if (otherSegment === undefined || otherSegment === null) return step;

        const other = segmentCubic(otherSegment);
        const from = others_at[i]!;
        const made = line
          ? [other.b.x - from.x, other.b.y - from.y]
          : [
              other.c1.x - from.x,
              other.c1.y - from.y,
              other.c2.x - other.c1.x,
              other.c2.y - other.c1.y,
              other.b.x - other.c2.x,
              other.b.y - other.c2.y,
            ];
        others_at[i] = other.b;
        return made;
      });

      emit(out, step, steps, line ? RLINETO : RRCURVETO, varying);
      at = cubic.b;
    }
  }

  return out.done();
}

/**
 * One drawing operator, blended if it varies.
 *
 * The order is the format's and is worth stating because getting it backwards
 * produces a font that draws correctly at the default and wrongly everywhere
 * else: every default value first, then every delta of the first value, then
 * every delta of the second, and so on — value by value, not region by region.
 */
function emit(
  out: Bytes,
  values: readonly number[],
  others: readonly (readonly number[])[],
  operator: number,
  varying: boolean,
): void {
  if (!varying) {
    for (const value of values) out.bytes(charstringNumber(value));
    out.u8(operator);
    return;
  }

  for (const value of values) out.bytes(charstringNumber(value));
  for (const [i, value] of values.entries()) {
    for (const other of others) out.bytes(charstringNumber((other[i] ?? value) - value));
  }
  out.bytes(charstringNumber(values.length)).u8(BLEND);
  out.u8(operator);
}

/**
 * Whether two drawings of a glyph can share a charstring.
 *
 * The compatibility check answers this properly and says why; this is the same
 * question asked cheaply at the moment of writing, because a font that is being
 * compiled has to do something with a glyph that fails it — and that something
 * is to write the default master's drawing and let it be the same at every
 * weight.
 */
function sameShape(one: Glyph, two: Glyph): boolean {
  if (one.contours.length !== two.contours.length) return false;

  for (const [i, a] of one.contours.entries()) {
    const b = two.contours[i];
    if (b === undefined || a.nodes.length !== b.nodes.length || a.closed !== b.closed) return false;
    if (segments(a).length !== segments(b).length) return false;

    for (const [s, segment] of segments(a).entries()) {
      if (segments(b)[s]?.kind !== segment.kind) return false;
    }
  }
  return true;
}

/** An INDEX: a count, an offset size, the offsets, then the data. */
function index(items: readonly Uint8Array[]): Uint8Array {
  const out = new Bytes();
  // CFF2 counts with four bytes where CFF used two.
  out.u32(items.length);
  if (items.length === 0) return out.done();

  const total = items.reduce((sum, item) => sum + item.length, 0);
  const offSize = total + 1 < 0x100 ? 1 : total + 1 < 0x10000 ? 2 : total + 1 < 0x1000000 ? 3 : 4;
  out.u8(offSize);

  let at = 1;
  const offset = (value: number): void => {
    if (offSize === 1) out.u8(value);
    else if (offSize === 2) out.u16(value);
    else if (offSize === 3) out.u24(value);
    else out.u32(value);
  };

  offset(at);
  for (const item of items) {
    at += item.length;
    offset(at);
  }
  for (const item of items) out.bytes(item);

  return out.done();
}

/**
 * A dictionary operand, always five bytes.
 *
 * The format has shorter forms and this uses none of them, because a dictionary
 * holding offsets to things that come after it changes length as those offsets
 * do — and a layout that has to be computed twice to converge is a layout that
 * sometimes does not.
 */
function dictOperand(value: number): Uint8Array {
  return new Bytes().u8(29).i32(Math.round(value)).done();
}

/** A real number in a dictionary, as the nibble-encoded form the format wants. */
function dictReal(value: number): Uint8Array {
  const text = String(value);
  const nibbles: number[] = [];

  for (const character of text) {
    if (character >= "0" && character <= "9") nibbles.push(character.charCodeAt(0) - 48);
    else if (character === ".") nibbles.push(0xa);
    else if (character === "-") nibbles.push(0xe);
    else if (character === "e") nibbles.push(0xb);
  }
  nibbles.push(0xf);
  if (nibbles.length % 2 !== 0) nibbles.push(0xf);

  const out = new Bytes().u8(30);
  for (let i = 0; i < nibbles.length; i += 2) out.u8((nibbles[i]! << 4) | nibbles[i + 1]!);
  return out.done();
}

/**
 * A number in a charstring.
 *
 * Whole numbers take the short forms the format defines for them; anything
 * fractional — which a delta between two masters very often is — takes the
 * 16.16 fixed form, which is the only way a charstring can say one.
 */
function charstringNumber(value: number): Uint8Array {
  const out = new Bytes();

  if (Number.isInteger(value) && value >= -32768 && value <= 32767) {
    if (value >= -107 && value <= 107) return out.u8(value + 139).done();
    if (value >= 108 && value <= 1131) {
      const shifted = value - 108;
      return out
        .u8((shifted >> 8) + 247)
        .u8(shifted & 0xff)
        .done();
    }
    if (value >= -1131 && value <= -108) {
      const shifted = -value - 108;
      return out
        .u8((shifted >> 8) + 251)
        .u8(shifted & 0xff)
        .done();
    }
    return out.u8(28).i16(value).done();
  }

  return out.u8(255).fixed(value).done();
}
