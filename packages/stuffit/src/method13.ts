/**
 * StuffIt method 13, which Aladdin called "fastest": LZ77 matches and literals,
 * both Huffman-coded.
 *
 * Ordinary in shape — a stream of literal bytes with back-references into what
 * has already been written — with two turns of the screw. There are *two*
 * literal codes, and which is in use depends on what came last: a code for
 * after a literal and a code for after a match. Text does not behave the same
 * way in those two positions, and a code per position is cheaper than a code
 * that has to cover both.
 *
 * The other is that the codes usually do not travel with the stream at all.
 * Five sets of lengths are built into the format and the first byte says which
 * to use, which costs four bits instead of several hundred — worth having when
 * the thing being compressed is a 2KB resource fork. A stream can carry its own
 * lengths instead, coded with a fixed meta-code, with runs of equal lengths and
 * plus-one/minus-one steps to keep that cheap too.
 *
 * Ported from XADMaster's `XADStuffIt13Handle.m` — see THIRD_PARTY_NOTICES.
 */

import { LowBits } from "./bits.js";
import { CODE_TABLES, META_CODES, META_LENGTHS } from "./method13-tables.js";
import {
  type ExplicitCode,
  type PrefixCode,
  canonicalCode,
  explicitCode,
  nextExplicitSymbol,
  nextSymbol,
} from "./prefix.js";

/** Literals 0-255, then match lengths, then the end of the stream: 321 in all. */
const SYMBOLS = 321;
const FIRST_MATCH = 0x100;
const LONG_MATCH = 0x13e;
const LONGER_MATCH = 0x13f;
const END = 0x140;

/**
 * Read one code's worth of lengths, written by the meta-code.
 *
 * The lengths are written as changes rather than as values, because a code's
 * lengths drift: a run of symbols usually sits within a bit or two of each
 * other. So 0-30 set a length outright, 31 says "no code at all", 32 and 33
 * step up and down by one, and 34-36 repeat whatever the length currently is
 * for a while. Every branch ends with the current length being written, which
 * is what makes the repeats and the steps mean the same thing.
 */
function readLengths(bits: LowBits, meta: ExplicitCode, count: number): number[] {
  const lengths = new Array<number>(count).fill(0);
  let length = 0;

  for (let i = 0; i < count; i++) {
    const value = nextExplicitSymbol(bits, meta);
    switch (value) {
      case 31:
        length = -1;
        break;
      case 32:
        length++;
        break;
      case 33:
        length--;
        break;
      case 34:
        // One extra repeat, but only if the bit says so.
        if (bits.next() && i < count) lengths[i++] = length;
        break;
      case 35: {
        let repeats = bits.string(3) + 2;
        while (repeats-- > 0 && i < count) lengths[i++] = length;
        break;
      }
      case 36: {
        let repeats = bits.string(6) + 10;
        while (repeats-- > 0 && i < count) lengths[i++] = length;
        break;
      }
      default:
        length = value + 1;
        break;
    }
    if (i < count) lengths[i] = length;
  }
  return lengths;
}

function metaCode(): ExplicitCode {
  return explicitCode(
    META_CODES.map((code, symbol) => ({ symbol, code, length: META_LENGTHS[symbol]! })),
  );
}

type Codes = {
  readonly first: PrefixCode;
  readonly second: PrefixCode;
  readonly offset: PrefixCode;
};

/**
 * The codes this stream uses, from its first byte.
 *
 * The high nibble picks: zero means the stream carries its own, one to five
 * name a built-in set. Anything else is not method 13, and saying so here is
 * kinder than decoding noise for a megabyte.
 */
function codesFor(bits: LowBits): Codes {
  const header = bits.byte();
  const which = header >> 4;

  if (which === 0) {
    const meta = metaCode();
    const first = canonicalCode(readLengths(bits, meta, SYMBOLS));
    // Bit 3 says the second code is the first one over again, which is what a
    // stream with nothing to gain from the distinction writes.
    const second = header & 0x08 ? first : canonicalCode(readLengths(bits, meta, SYMBOLS));
    const offset = canonicalCode(readLengths(bits, meta, (header & 0x07) + 10));
    return { first, second, offset };
  }

  const tables = CODE_TABLES[which - 1];
  if (tables === undefined) throw new Error(`method 13 stream names code set ${String(which)}`);
  return {
    first: canonicalCode(tables.first),
    second: canonicalCode(tables.second),
    offset: canonicalCode(tables.offset),
  };
}

/**
 * Decompress one method 13 stream.
 *
 * `expected` is the length the archive header promised, and decoding stops
 * there even if the stream would go on — a header and a stream that disagree
 * are a damaged archive, and the header is what the rest of the archive was
 * laid out by.
 */
export function method13(bytes: Uint8Array, expected?: number): Uint8Array {
  const bits = new LowBits(bytes);
  const codes = codesFor(bits);

  const limit = expected ?? Number.POSITIVE_INFINITY;
  const out: number[] = [];
  let current = codes.first;

  while (out.length < limit) {
    const value = nextSymbol(bits, current);

    if (value < FIRST_MATCH) {
      out.push(value);
      current = codes.first;
      continue;
    }
    if (value >= END) break;

    current = codes.second;
    let length: number;
    if (value < LONG_MATCH) length = value - FIRST_MATCH + 3;
    else if (value === LONG_MATCH) length = bits.string(10) + 65;
    else if (value === LONGER_MATCH) length = bits.string(15) + 65;
    else break;

    // The distance is coded by its width: the top bit is implied by the width
    // itself, so only the bits below it are written.
    const width = nextSymbol(bits, codes.offset);
    let distance: number;
    if (width === 0) distance = 1;
    else if (width === 1) distance = 2;
    else distance = (1 << (width - 1)) + bits.string(width - 1) + 1;

    const from = out.length - distance;
    if (from < 0) throw new Error("a match reaches back before the start of the data");
    // One byte at a time on purpose: a match may overlap what it is writing,
    // which is how a run of one byte is written as a distance of one.
    for (let i = 0; i < length && out.length < limit; i++) out.push(out[from + i]!);
  }

  return Uint8Array.from(out);
}
