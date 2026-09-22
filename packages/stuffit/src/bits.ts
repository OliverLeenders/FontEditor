/**
 * Reading a compressed stream one bit at a time, in both of the orders the
 * StuffIt compressors use.
 *
 * Two orders, because the two compressors were written years apart by people
 * who each picked the one that suited their coder. Arsenic's arithmetic decoder
 * consumes bits from the top of each byte down, the way a number is written.
 * Method 13's Huffman codes come off the bottom of each byte up, the way
 * Deflate reads. Neither is more correct; getting them the wrong way round
 * simply produces noise, so they are named rather than parameterised.
 *
 * Reading past the end gives zeroes instead of throwing. A truncated archive is
 * a real thing that happens, and the decompressors already check what they
 * produce against the length the header promised — which is a better complaint
 * than "ran out of bits" from somewhere deep inside a model update.
 */

/** Bits from the top of each byte down: 0x80, 0x40, 0x20 … */
export class HighBits {
  private readonly bytes: Uint8Array;
  private at = 0;
  private bit = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  next(): number {
    const byte = this.bytes[this.at];
    if (byte === undefined) return 0;
    const b = (byte >> (7 - this.bit)) & 1;
    this.bit++;
    if (this.bit === 8) {
      this.bit = 0;
      this.at++;
    }
    return b;
  }

  /** `n` bits as a number, first bit read being the most significant. */
  string(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) value = value * 2 + this.next();
    return value;
  }
}

/** Bits from the bottom of each byte up: 0x01, 0x02, 0x04 … */
export class LowBits {
  private readonly bytes: Uint8Array;
  private at = 0;
  private bit = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  next(): number {
    const byte = this.bytes[this.at];
    if (byte === undefined) return 0;
    const b = (byte >> this.bit) & 1;
    this.bit++;
    if (this.bit === 8) {
      this.bit = 0;
      this.at++;
    }
    return b;
  }

  /** `n` bits as a number, first bit read being the least significant. */
  string(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) value |= this.next() << i;
    return value >>> 0;
  }

  /** A whole byte, from wherever the stream has got to, bit position and all. */
  byte(): number {
    return this.string(8);
  }

  /** True once every bit of every byte has been handed out. */
  get spent(): boolean {
    return this.at >= this.bytes.length;
  }
}
