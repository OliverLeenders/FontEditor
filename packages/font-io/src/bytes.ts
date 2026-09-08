/**
 * Writing binary, a byte at a time.
 *
 * The font formats are laid out in big-endian fields with no padding and a
 * great many offsets that are only known once everything after them has been
 * written. A growing buffer with a cursor is the shape that makes that
 * bearable: write forwards, remember where the holes are, fill them in at the
 * end.
 *
 * Its own module because three writers now want it — the zip, the layout
 * tables, and CFF2 — and each having its own was three places for a
 * sign-extension bug to hide.
 */
export class Bytes {
  private data = new Uint8Array(1024);
  private at = 0;

  /** How many bytes have been written, which is also where the next one goes. */
  get length(): number {
    return this.at;
  }

  u8(value: number): this {
    this.room(1);
    this.data[this.at++] = value & 0xff;
    return this;
  }

  u16(value: number): this {
    this.room(2);
    this.data[this.at++] = (value >> 8) & 0xff;
    this.data[this.at++] = value & 0xff;
    return this;
  }

  i16(value: number): this {
    return this.u16(value < 0 ? value + 0x10000 : value);
  }

  u24(value: number): this {
    return this.u8(value >> 16)
      .u8(value >> 8)
      .u8(value);
  }

  u32(value: number): this {
    this.room(4);
    this.data[this.at++] = (value >>> 24) & 0xff;
    this.data[this.at++] = (value >>> 16) & 0xff;
    this.data[this.at++] = (value >>> 8) & 0xff;
    this.data[this.at++] = value & 0xff;
    return this;
  }

  i32(value: number): this {
    return this.u32(value < 0 ? value + 0x100000000 : value);
  }

  /** A 2.14 fixed-point number, which is how the variation tables hold −1 to 1. */
  f2dot14(value: number): this {
    return this.i16(Math.round(Math.max(-2, Math.min(2, value)) * 16384));
  }

  /** A 16.16 fixed-point number. */
  fixed(value: number): this {
    return this.i32(Math.round(value * 65536));
  }

  bytes(values: Uint8Array): this {
    this.room(values.length);
    this.data.set(values, this.at);
    this.at += values.length;
    return this;
  }

  /** Latin-1 text, which is all any of these tags and names may be. */
  ascii(text: string): this {
    for (let i = 0; i < text.length; i++) this.u8(text.charCodeAt(i));
    return this;
  }

  /** Pad to a multiple, for the formats that insist on alignment. */
  pad(to: number): this {
    while (this.at % to !== 0) this.u8(0);
    return this;
  }

  /**
   * Go back and write a four-byte value into a hole left earlier.
   *
   * Which is the whole reason this class exists: an offset is written before
   * the thing it points at has been laid out, so the place is remembered and
   * filled in afterwards.
   */
  patchU32(at: number, value: number): void {
    const view = new DataView(this.data.buffer, this.data.byteOffset);
    view.setUint32(at, value);
  }

  patchU16(at: number, value: number): void {
    const view = new DataView(this.data.buffer, this.data.byteOffset);
    view.setUint16(at, value);
  }

  done(): Uint8Array {
    return this.data.slice(0, this.at);
  }

  private room(more: number): void {
    if (this.at + more <= this.data.length) return;

    let size = this.data.length * 2;
    while (size < this.at + more) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.data.subarray(0, this.at));
    this.data = grown;
  }
}
