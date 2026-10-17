/**
 * Big-endian numbers read out of a file, each checked to be inside it first.
 *
 * Both containers here are offsets and lengths from end to end, and a file cut
 * short — or one that is not what it says, or one made to mislead — points
 * past its own end. Read straight off a `DataView`, that is a `RangeError` from
 * somewhere inside the reader; read through these, it is the file said to end
 * before what was being looked for.
 */
export type Numbers = {
  u8(at: number, what: string): number;
  u16(at: number, what: string): number;
  i16(at: number, what: string): number;
  u32(at: number, what: string): number;
};

/** The numbers of `bytes`, which is called `whose` when it is said to be short. */
export function numbersOf(bytes: Uint8Array, whose: string): Numbers {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const inside = (at: number, size: number, what: string): void => {
    if (!(Number.isInteger(at) && at >= 0 && at + size <= bytes.length)) {
      throw new Error(`${whose} ends before ${what}`);
    }
  };
  return {
    u8: (at, what) => (inside(at, 1, what), view.getUint8(at)),
    u16: (at, what) => (inside(at, 2, what), view.getUint16(at)),
    i16: (at, what) => (inside(at, 2, what), view.getInt16(at)),
    u32: (at, what) => (inside(at, 4, what), view.getUint32(at)),
  };
}
