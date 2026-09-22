import { describe, expect, it } from "vitest";

import { arsenic, inverseBwt } from "../src/arsenic.js";
import { HighBits, LowBits } from "../src/bits.js";

describe("bits", () => {
  it("reads from the top of each byte down", () => {
    const bits = new HighBits(Uint8Array.from([0b10110000, 0b01000000]));
    expect([bits.next(), bits.next(), bits.next(), bits.next()]).toEqual([1, 0, 1, 1]);
    expect(bits.string(6)).toBe(0b000001);
  });

  it("reads from the bottom of each byte up", () => {
    const bits = new LowBits(Uint8Array.from([0b00001101, 0b00000010]));
    expect([bits.next(), bits.next(), bits.next(), bits.next()]).toEqual([1, 0, 1, 1]);
    // Four bits in, the next six are the rest of this byte and then two of
    // the next: 0,0,0,0 and 0,1, which read low bit first is 32.
    expect(bits.string(6)).toBe(32);
  });

  it("gives zeroes rather than throwing past the end", () => {
    const bits = new HighBits(new Uint8Array(0));
    expect(bits.string(12)).toBe(0);
    expect(new LowBits(new Uint8Array(0)).spent).toBe(true);
  });
});

/**
 * The forward transform, written out plainly: sort every rotation of the block
 * and take the last character of each.
 *
 * Hopeless on anything long and exactly right, which is what a test wants. The
 * real encoder used a clever sorter; the output is the same either way.
 */
function forwardBwt(block: Uint8Array): { last: Uint8Array; first: number } {
  const rotations = [...block].map((_, i) => i);
  const at = (rotation: number, k: number): number => block[(rotation + k) % block.length]!;
  rotations.sort((a, b) => {
    for (let k = 0; k < block.length; k++) {
      const difference = at(a, k) - at(b, k);
      if (difference !== 0) return difference;
    }
    return 0;
  });

  const last = Uint8Array.from(rotations.map((r) => at(r, block.length - 1)));
  return { last, first: rotations.indexOf(0) };
}

describe("undoing a block sort", () => {
  const text = (value: string): Uint8Array =>
    Uint8Array.from([...value].map((c) => c.charCodeAt(0)));

  /** Walk the chain the way the decompressor does, and see the text again. */
  function unsorted(last: Uint8Array, first: number): string {
    const transform = inverseBwt(last, last.length);
    let at = first;
    let out = "";
    for (let i = 0; i < last.length; i++) {
      at = transform[at]!;
      out += String.fromCharCode(last[at]!);
    }
    return out;
  }

  it("gets the text back", () => {
    const original = text("the quick brown fox jumps over the lazy dog");
    const { last, first } = forwardBwt(original);
    expect(unsorted(last, first)).toBe("the quick brown fox jumps over the lazy dog");
  });

  it("gets a block of one repeated byte back", () => {
    const original = text("aaaaaaaa");
    const { last, first } = forwardBwt(original);
    expect(unsorted(last, first)).toBe("aaaaaaaa");
  });

  it("gets a block of one byte back", () => {
    const { last, first } = forwardBwt(text("x"));
    expect(unsorted(last, first)).toBe("x");
  });
});

describe("an Arsenic stream", () => {
  it("is refused when it does not begin with its own name", () => {
    // Every Arsenic stream starts by coding the letters A and s.
    expect(() => arsenic(new Uint8Array(64), 10)).toThrow(/does not begin with 'As'/);
  });
});
