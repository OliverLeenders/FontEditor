import { describe, expect, it } from "vitest";

import { LowBits } from "../src/bits.js";
import { canonicalCode, explicitCode, nextExplicitSymbol, nextSymbol } from "../src/prefix.js";

/**
 * Bits into bytes, the way the stream holds them: the first bit written is the
 * lowest bit of the first byte.
 */
function packed(bits: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, i) => {
    if (bit) bytes[i >> 3] = bytes[i >> 3]! | (1 << (i & 7));
  });
  return bytes;
}

describe("a canonical code", () => {
  /**
   * Four symbols with the lengths 2, 1, 3, 3. Written out by hand, the codes
   * are: symbol 1 is `0`, symbol 0 is `10`, symbol 2 is `110`, symbol 3 is
   * `111` — shortest first, counting up, shifting left at each new length.
   *
   * Hand-written on purpose. Every other test here builds its codes the same
   * way the reader does, so this is the one that would catch the whole
   * convention being reversed.
   */
  const code = canonicalCode([2, 1, 3, 3]);

  it("reads the code a person would write down", () => {
    const bits = new LowBits(packed([0, 1, 0, 1, 1, 0, 1, 1, 1]));
    expect(nextSymbol(bits, code)).toBe(1);
    expect(nextSymbol(bits, code)).toBe(0);
    expect(nextSymbol(bits, code)).toBe(2);
    expect(nextSymbol(bits, code)).toBe(3);
  });

  it("leaves out symbols with no length", () => {
    const sparse = canonicalCode([0, 1, 0, 2]);
    const bits = new LowBits(packed([0, 1, 0]));
    expect(nextSymbol(bits, sparse)).toBe(1);
    expect(nextSymbol(bits, sparse)).toBe(3);
  });

  it("complains rather than looping when the bits are not a code", () => {
    // Every code of this one-symbol alphabet begins with a zero.
    const bits = new LowBits(packed([1, 1, 1, 1, 1, 1, 1, 1]));
    expect(() => nextSymbol(bits, canonicalCode([1]))).toThrow(/no such code/);
  });
});

describe("a code given outright", () => {
  // Codes are written low bit first here, which is how the format spells the
  // small fixed code it uses for the lengths of the big ones.
  const code = explicitCode([
    { symbol: 7, code: 0b0, length: 1 },
    { symbol: 9, code: 0b01, length: 2 },
    { symbol: 4, code: 0b11, length: 2 },
  ]);

  it("reads its codes low bit first", () => {
    const bits = new LowBits(packed([0, 1, 0, 1, 1]));
    expect(nextExplicitSymbol(bits, code)).toBe(7);
    expect(nextExplicitSymbol(bits, code)).toBe(9);
    expect(nextExplicitSymbol(bits, code)).toBe(4);
  });

  it("stops at the first bit that is already a code", () => {
    // Symbol 7 is the single bit 0, so a 0 is never the start of anything
    // longer: the next symbol begins with the bit after it.
    const bits = new LowBits(packed([0, 1, 0]));
    expect(nextExplicitSymbol(bits, code)).toBe(7);
    expect(nextExplicitSymbol(bits, code)).toBe(9);
  });
});
