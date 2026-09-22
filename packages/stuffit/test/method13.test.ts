import { describe, expect, it } from "vitest";

import { method13 } from "../src/method13.js";
import { CODE_TABLES, META_CODES, META_LENGTHS } from "../src/method13-tables.js";

/**
 * A method 13 encoder, for tests only.
 *
 * There is no other way to have a stream to decode: no software writes these
 * any more, and a real archive checked in as a fixture would be somebody's
 * font. So the test writes one, from the format rather than from the decoder —
 * the canonical codes are assigned here by the textbook rule, the literals and
 * matches are coded by hand, and the decoder has to agree.
 *
 * What this cannot check is the built-in tables themselves: a wrong length in
 * one of them would be wrong here too and the round trip would still close.
 * Those are checked by reading a real archive, which is a thing to do with a
 * font somebody owns rather than in a test.
 */
class Stream {
  private readonly bits: number[] = [];

  /** A whole byte at the front, where the stream says which codes it uses. */
  byte(value: number): void {
    for (let i = 0; i < 8; i++) this.bits.push((value >> i) & 1);
  }

  /** A code, whose first bit written is its highest. */
  code(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }

  /** A plain number, low bit first, as the format writes its extra bits. */
  number(value: number, length: number): void {
    for (let i = 0; i < length; i++) this.bits.push((value >> i) & 1);
  }

  get bytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, i) => {
      if (bit) out[i >> 3] = out[i >> 3]! | (1 << (i & 7));
    });
    return out;
  }
}

type Code = ReadonlyMap<number, { code: number; length: number }>;

/** Canonical codes from lengths: shortest first, counting up, shifting left. */
function codesOf(lengths: readonly number[]): Code {
  const out = new Map<number, { code: number; length: number }>();
  let code = 0;
  const longest = Math.max(...lengths);
  for (let length = 1; length <= longest; length++) {
    for (let symbol = 0; symbol < lengths.length; symbol++) {
      if (lengths[symbol] !== length) continue;
      out.set(symbol, { code, length });
      code++;
    }
    code <<= 1;
  }
  return out;
}

type Piece = number | { readonly length: number; readonly distance: number };

/** Write a stream using one of the five built-in code sets. */
function written(pieces: readonly Piece[], which = 1): Uint8Array {
  const tables = CODE_TABLES[which - 1]!;
  const first = codesOf(tables.first);
  const second = codesOf(tables.second);
  const offset = codesOf(tables.offset);

  const stream = new Stream();
  stream.byte(which << 4);

  let current = first;
  const put = (symbol: number): void => {
    const found = current.get(symbol)!;
    stream.code(found.code, found.length);
  };

  for (const piece of pieces) {
    if (typeof piece === "number") {
      put(piece);
      current = first;
      continue;
    }

    put(0x100 + piece.length - 3);
    current = second;

    // The distance is written as its bit width, then everything below the top
    // bit, which the width already says is there.
    const width = piece.distance <= 1 ? 0 : piece.distance === 2 ? 1 : widthOf(piece.distance);
    const found = offset.get(width)!;
    stream.code(found.code, found.length);
    if (width >= 2) stream.number(piece.distance - 1 - (1 << (width - 1)), width - 1);
  }

  put(0x140);
  return stream.bytes;
}

function widthOf(distance: number): number {
  let width = 2;
  while ((1 << width) + 1 <= distance) width++;
  return width;
}

const bytesOf = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
const textOf = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

describe("method 13", () => {
  it("reads literals back", () => {
    const stream = written(bytesOf("Geneva"));
    expect(textOf(method13(stream, 6))).toBe("Geneva");
  });

  it("copies a match out of what it has already written", () => {
    const stream = written([...bytesOf("abcd"), { length: 4, distance: 4 }]);
    expect(textOf(method13(stream, 8))).toBe("abcdabcd");
  });

  it("lets a match overlap itself, which is how a run is written", () => {
    // Distance one, length five: the byte just written, five more times.
    const stream = written([...bytesOf("x"), { length: 5, distance: 1 }]);
    expect(textOf(method13(stream, 6))).toBe("xxxxxx");
  });

  it("reads a long distance, whose width is coded and whose bits are not", () => {
    const filler = bytesOf("q".repeat(300));
    const stream = written([...bytesOf("here"), ...filler, { length: 4, distance: 304 }]);
    expect(textOf(method13(stream, 308)).slice(-4)).toBe("here");
  });

  it("stops at the end symbol without being told a length", () => {
    expect(textOf(method13(written(bytesOf("Chicago"))))).toBe("Chicago");
  });

  it("stops at the length it is given, whatever the stream says next", () => {
    expect(textOf(method13(written(bytesOf("Chicago")), 3))).toBe("Chi");
  });

  it("reads each of the five built-in code sets", () => {
    for (let which = 1; which <= 5; which++) {
      expect(textOf(method13(written(bytesOf("Palatino"), which), 8))).toBe("Palatino");
    }
  });

  it("refuses a stream that names a code set it has not got", () => {
    expect(() => method13(Uint8Array.from([0x60, 0, 0, 0]), 4)).toThrow(/code set 6/);
  });

  it("refuses a match that reaches back before the start", () => {
    const stream = written([...bytesOf("ab"), { length: 4, distance: 9 }]);
    expect(() => method13(stream, 6)).toThrow(/before the start/);
  });
});

describe("a stream carrying its own codes", () => {
  /**
   * The meta-code writes the lengths of the real code. Here every symbol is
   * given a length outright — value + 1 — which is the plainest thing the
   * meta-code can say, and enough to exercise the path that reads it.
   */
  function withOwnCodes(text: string): { stream: Stream; lengths: number[] } {
    const used = [...new Set(bytesOf(text)), 0x140];
    // Every symbol that occurs gets the same length, which is a valid code as
    // long as there are a power of two of them; the rest get none.
    const size = 1 << Math.ceil(Math.log2(used.length));
    const lengths = new Array<number>(321).fill(-1);
    const chosen = [...used];
    while (chosen.length < size) chosen.push(nextUnused(chosen));
    for (const symbol of chosen) lengths[symbol] = Math.log2(size);

    const meta = new Map(META_CODES.map((code, symbol) => [symbol, code]));
    const stream = new Stream();
    stream.byte(0x08); // own codes, and the second code is the first one again

    const writeLengths = (of: readonly number[]): void => {
      for (const length of of) {
        // Length n is written as the meta symbol n - 1, or 31 for "no code".
        const symbol = length < 1 ? 31 : length - 1;
        stream.number(meta.get(symbol)!, META_LENGTHS[symbol]!);
      }
    };

    writeLengths(lengths);
    // And a distance code with one usable width, which nothing here uses.
    writeLengths([1, 1, ...new Array<number>(8).fill(-1)]);

    return { stream, lengths };
  }

  function nextUnused(chosen: readonly number[]): number {
    let symbol = 0;
    while (chosen.includes(symbol)) symbol++;
    return symbol;
  }

  it("reads the lengths it is given and then the data", () => {
    const text = "abcdabcd";
    const { stream, lengths } = withOwnCodes(text);
    const codes = codesOf(lengths.map((n) => (n < 0 ? 0 : n)));

    // Written straight on from the lengths, with no byte boundary between
    // them: the data begins at the very next bit.
    for (const byte of bytesOf(text)) {
      const found = codes.get(byte)!;
      stream.code(found.code, found.length);
    }
    const end = codes.get(0x140)!;
    stream.code(end.code, end.length);

    expect(textOf(method13(stream.bytes, text.length))).toBe(text);
  });
});
