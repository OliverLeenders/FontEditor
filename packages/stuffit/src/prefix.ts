/**
 * Prefix codes, in the two shapes StuffIt's method 13 asks for.
 *
 * A canonical code is the usual arrangement, the one Deflate uses: give every
 * symbol a code *length* and the codes themselves follow, shortest first,
 * counting upwards and shifting left at each new length. Only the lengths have
 * to be stored, and both sides rebuild the same code from them. Symbols whose
 * length is zero or less take part in nothing — a stream is entitled to say
 * that a symbol never occurs.
 *
 * The other shape is a code given outright: a list of code values with their
 * lengths, not necessarily canonical, which is how the format spells the small
 * fixed code that codes the lengths of the big ones.
 *
 * Both are decoded bit by bit against a table rather than through a tree. It
 * reads as the definition does — take a bit, is this a code yet — and for
 * alphabets this small a tree buys nothing.
 */

import type { LowBits } from "./bits.js";

export type PrefixCode = {
  /** How many codes there are of each length, indexed by length. */
  readonly counts: Int32Array;
  /** Symbols in code order: by length, then by symbol. */
  readonly symbols: Int32Array;
  readonly maxLength: number;
};

/** Build a canonical code from one length per symbol. */
export function canonicalCode(lengths: readonly number[]): PrefixCode {
  let maxLength = 0;
  for (const length of lengths) if (length > maxLength) maxLength = length;

  const counts = new Int32Array(maxLength + 1);
  for (const length of lengths) if (length > 0) counts[length] = counts[length]! + 1;

  const offsets = new Int32Array(maxLength + 2);
  let total = 0;
  for (let length = 1; length <= maxLength; length++) {
    offsets[length] = total;
    total += counts[length]!;
  }

  const symbols = new Int32Array(total);
  const at = offsets.slice();
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const length = lengths[symbol]!;
    if (length > 0) symbols[at[length]!++] = symbol;
  }

  return { counts, symbols, maxLength };
}

/**
 * Read one symbol, taking bits until they spell a code.
 *
 * Codes are laid out high bit first even though the bits arrive low bit first
 * from the stream — the two orders are independent, and this is the pairing
 * method 13 uses.
 */
export function nextSymbol(bits: LowBits, code: PrefixCode): number {
  let value = 0;
  let first = 0;
  let index = 0;

  for (let length = 1; length <= code.maxLength; length++) {
    value = (value << 1) | bits.next();
    const count = code.counts[length]!;
    if (value - first < count) return code.symbols[index + (value - first)]!;
    index += count;
    first = (first + count) << 1;
  }
  throw new Error("no such code in the stream");
}

/** A symbol and the code that means it, written low bit first. */
export type CodeEntry = {
  readonly symbol: number;
  readonly code: number;
  readonly length: number;
};

export type ExplicitCode = {
  readonly byCode: ReadonlyMap<number, number>;
  readonly maxLength: number;
};

/** Build a code from codes given outright, rather than from lengths. */
export function explicitCode(entries: readonly CodeEntry[]): ExplicitCode {
  const byCode = new Map<number, number>();
  let maxLength = 0;
  for (const { symbol, code, length } of entries) {
    if (length <= 0) continue;
    // Keyed by length and value together: the same bits at two lengths are two
    // different codes, and a prefix code is exactly the promise that only one
    // of them can be reached.
    byCode.set(length * 0x100000 + code, symbol);
    if (length > maxLength) maxLength = length;
  }
  return { byCode, maxLength };
}

/** Read one symbol of an explicit code, whose codes are low bit first. */
export function nextExplicitSymbol(bits: LowBits, code: ExplicitCode): number {
  let value = 0;
  for (let length = 1; length <= code.maxLength; length++) {
    value |= bits.next() << (length - 1);
    const symbol = code.byCode.get(length * 0x100000 + value);
    if (symbol !== undefined) return symbol;
  }
  throw new Error("no such code in the stream");
}
