/**
 * What a font file says of its own size, read before anything else is.
 *
 * A font says how many glyphs it has in two places for an outline font in CFF
 * — `maxp`, and the count of the CharStrings index — and the parser builds a
 * glyph for each one it finds, whatever the file holds. A file of five
 * thousand bytes whose count is damaged to twenty thousand is two minutes of
 * building glyphs out of nothing before anything else can be said about it.
 * Every glyph takes a byte at least in the file, and more in practice, so a
 * count larger than the file is not a font that can be read.
 *
 * And the CFF table's top dictionary says where everything else in it is,
 * each place one number given to one operator — two for the private
 * dictionary's size and place. One that gives an operator more is damaged, and
 * which of its numbers a parser goes by is anybody's guess: the fuzz tests
 * found one that took a minute over a file of five thousand bytes that way.
 *
 * Both are caught here, before the parse. Anything that cannot be followed is
 * left alone: the parser says what is wrong with a file better than this does.
 */

type Reads = {
  readonly u8: (at: number) => number | null;
  readonly u16: (at: number) => number | null;
  readonly u32: (at: number) => number | null;
};

function readsOf(font: Uint8Array): Reads {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  return {
    u8: (at) => (at >= 0 && at < font.length ? font[at]! : null),
    u16: (at) => (at >= 0 && at + 2 <= font.length ? view.getUint16(at) : null),
    u32: (at) => (at >= 0 && at + 4 <= font.length ? view.getUint32(at) : null),
  };
}

/** Where each table the file lists is, where it is inside the file. */
function tablesOf(font: Uint8Array, r: Reads): Map<string, { at: number; length: number }> {
  const tables = new Map<string, { at: number; length: number }>();
  const count = r.u16(4);
  if (count === null) return tables;
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    if (at + 16 > font.length) break;
    const tag = String.fromCharCode(font[at]!, font[at + 1]!, font[at + 2]!, font[at + 3]!);
    const offset = r.u32(at + 8);
    const length = r.u32(at + 12);
    if (offset === null || length === null || offset + length > font.length) continue;
    tables.set(tag, { at: offset, length });
  }
  return tables;
}

/** Every count of glyphs the file states, where it can be found. */
export function glyphCountsClaimed(font: Uint8Array): number[] {
  const r = readsOf(font);
  const tables = tablesOf(font, r);
  const counts: number[] = [];
  const maxp = tables.get("maxp");
  if (maxp !== undefined && maxp.length >= 6) {
    const n = r.u16(maxp.at + 4);
    if (n !== null) counts.push(n);
  }
  const cff = tables.get("CFF ");
  if (cff !== undefined) {
    // At each place the top dictionary could be taken to say the CharStrings
    // index is: one, in a sound font.
    for (const entry of topDictOf(cff.at, r) ?? []) {
      if (entry.op !== CHAR_STRINGS) continue;
      for (const at of entry.operands) {
        const n = r.u16(cff.at + at);
        if (n !== null) counts.push(n);
      }
    }
  }
  return counts;
}

/** What is wrong with a CFF table's top dictionary, or `null` where nothing is seen to be. */
export function damagedTopDict(font: Uint8Array): string | null {
  const r = readsOf(font);
  const cff = tablesOf(font, r).get("CFF ");
  if (cff === undefined) return null;
  for (const entry of topDictOf(cff.at, r) ?? []) {
    const wanted = OPERANDS.get(entry.op);
    if (wanted !== undefined && entry.operands.length !== wanted) {
      return `its CFF table is damaged: where its ${NAMES.get(entry.op) ?? "data is"}, is given as ${String(entry.operands.length)} numbers`;
    }
  }
  return null;
}

const CHAR_STRINGS = 17;
/** The operators that say where something is, and how many numbers each is given. */
const OPERANDS = new Map([
  [15, 1],
  [16, 1],
  [CHAR_STRINGS, 1],
  [18, 2],
]);
const NAMES = new Map([
  [15, "charset is"],
  [16, "encoding is"],
  [CHAR_STRINGS, "outlines are"],
  [18, "private dictionary is"],
]);

/**
 * The top dictionary of the CFF table at `cff`, as each operator with the
 * numbers given to it, or `null` where it cannot be followed. Operators of
 * two bytes are numbered from 1200.
 */
function topDictOf(cff: number, r: Reads): { op: number; operands: number[] }[] | null {
  /** Where the index at `at` ends, and where its first item begins and ends. */
  const index = (at: number): { end: number; first: number; firstEnd: number } | null => {
    const count = r.u16(at);
    if (count === null) return null;
    if (count === 0) return { end: at + 2, first: at + 2, firstEnd: at + 2 };
    const offSize = r.u8(at + 2);
    if (offSize === null || offSize < 1 || offSize > 4) return null;
    const offsetAt = (k: number): number | null => {
      let value = 0;
      for (let b = 0; b < offSize; b++) {
        const byte = r.u8(at + 3 + k * offSize + b);
        if (byte === null) return null;
        value = value * 256 + byte;
      }
      return value;
    };
    const base = at + 3 + (count + 1) * offSize - 1;
    const one = offsetAt(0);
    const two = offsetAt(1);
    const last = offsetAt(count);
    if (one === null || two === null || last === null) return null;
    return { end: base + last, first: base + one, firstEnd: base + two };
  };

  const headerSize = r.u8(cff + 2);
  if (headerSize === null) return null;
  const names = index(cff + headerSize);
  if (names === null) return null;
  const tops = index(names.end);
  if (tops === null) return null;

  const entries: { op: number; operands: number[] }[] = [];
  let operands: number[] = [];
  for (let at = tops.first; at < tops.firstEnd;) {
    const b0 = r.u8(at);
    if (b0 === null) return null;
    if (b0 <= 21) {
      let op = b0;
      if (b0 === 12) {
        const b1 = r.u8(at + 1);
        if (b1 === null) return null;
        op = 1200 + b1;
      }
      entries.push({ op, operands });
      operands = [];
      at += b0 === 12 ? 2 : 1;
    } else if (b0 === 28) {
      const v = r.u16(at + 1);
      if (v === null) return null;
      operands.push(v >= 0x8000 ? v - 0x10000 : v);
      at += 3;
    } else if (b0 === 29) {
      const v = r.u32(at + 1);
      if (v === null) return null;
      operands.push(v >> 0);
      at += 5;
    } else if (b0 === 30) {
      // A real number, in nibbles to the one that ends it; never an offset.
      at += 1;
      for (;;) {
        const b = r.u8(at);
        if (b === null) return null;
        at += 1;
        if ((b & 0x0f) === 0x0f || (b & 0xf0) === 0xf0) break;
      }
      operands.push(0);
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
      at += 1;
    } else if (b0 >= 247 && b0 <= 254) {
      const b1 = r.u8(at + 1);
      if (b1 === null) return null;
      operands.push(b0 <= 250 ? (b0 - 247) * 256 + b1 + 108 : -(b0 - 251) * 256 - b1 - 108);
      at += 2;
    } else {
      return null;
    }
  }
  return entries;
}
