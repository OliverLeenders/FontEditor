/**
 * Adding a table to a finished font file.
 *
 * opentype.js writes no GPOS, and its list of optional tables is fixed, so the
 * kerning table has to go in afterwards. That means rebuilding the part of the
 * file that says where everything is: a table directory sorted by tag, offsets
 * that move as soon as anything is inserted, and a checksum over the whole file
 * that necessarily changes when any of that does.
 *
 * Written out rather than approximated, because the failure here is quiet. A
 * wrong offset or a stale checksum gives a file that looks like a font, opens in
 * some tools, and is rejected by others with no explanation.
 */

const HEADER = 12;
const RECORD = 16;

export type Table = {
  readonly tag: string;
  readonly data: Uint8Array;
};

/** The tables a finished font holds, for anything that needs to read one back. */
export function readTablesOf(font: Uint8Array): readonly Table[] {
  return readTables(font).tables;
}

function readTables(font: Uint8Array): { sfntVersion: number; tables: Table[] } {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const sfntVersion = view.getUint32(0);
  const numTables = view.getUint16(4);

  const tables: Table[] = [];
  for (let i = 0; i < numTables; i++) {
    const at = HEADER + i * RECORD;
    const tag = String.fromCharCode(font[at]!, font[at + 1]!, font[at + 2]!, font[at + 3]!);
    const offset = view.getUint32(at + 8);
    const length = view.getUint32(at + 12);
    tables.push({ tag, data: font.subarray(offset, offset + length) });
  }
  return { sfntVersion, tables };
}

/**
 * The sum of a table's bytes as 32-bit words, which is what the format calls a
 * checksum. Trailing bytes are padded with zeroes, exactly as the table itself
 * is padded in the file.
 */
export function tableChecksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const word =
      ((data[i] ?? 0) << 24) |
      ((data[i + 1] ?? 0) << 16) |
      ((data[i + 2] ?? 0) << 8) |
      (data[i + 3] ?? 0);
    sum = (sum + word) >>> 0;
  }
  return sum >>> 0;
}

/** Largest power of two not exceeding `n`, as the header's search fields want. */
function largestPowerOfTwo(n: number): number {
  let power = 1;
  while (power * 2 <= n) power *= 2;
  return power;
}

/**
 * Insert or replace a table, returning a whole new font.
 *
 * The directory is sorted by tag, as the specification requires and as some
 * readers rely on; tables themselves are laid out in that same order, four-byte
 * aligned, with the padding included in each length only where the format says
 * so — which is to say, not in the recorded length, but yes in the offsets.
 */
export function withTable(font: Uint8Array, tag: string, data: Uint8Array): Uint8Array {
  const { sfntVersion, tables } = readTables(font);

  const kept = tables.filter((t) => t.tag !== tag);
  const all = data.length === 0 ? kept : [...kept, { tag, data }];
  all.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const numTables = all.length;
  const directorySize = HEADER + numTables * RECORD;

  let offset = directorySize;
  const placed = all.map((table) => {
    const at = offset;
    offset += table.data.length;
    offset = (offset + 3) & ~3; // four-byte aligned
    return { ...table, offset: at };
  });

  const total = offset;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  const searchRange = largestPowerOfTwo(numTables) * 16;
  view.setUint32(0, sfntVersion);
  view.setUint16(4, numTables);
  view.setUint16(6, searchRange);
  view.setUint16(8, Math.log2(searchRange / 16));
  view.setUint16(10, numTables * 16 - searchRange);

  placed.forEach((table, i) => {
    const at = HEADER + i * RECORD;
    for (let c = 0; c < 4; c++) out[at + c] = table.tag.charCodeAt(c);
    view.setUint32(at + 8, table.offset);
    view.setUint32(at + 12, table.data.length);
    out.set(table.data, table.offset);
  });

  // Order matters here. `head`'s own checksum is defined with its
  // checkSumAdjustment field zeroed, so that field is cleared before any
  // checksum is taken; the adjustment is then computed over the finished file
  // and written last. Computing the directory first leaves head's entry stale,
  // which is a font that opens everywhere and fails every validator.
  const head = placed.find((t) => t.tag === "head");
  if (head !== undefined) view.setUint32(head.offset + 8, 0);

  placed.forEach((table, i) => {
    const at = HEADER + i * RECORD;
    const length = view.getUint32(at + 12);
    view.setUint32(at + 4, tableChecksum(out.subarray(table.offset, table.offset + length)));
  });

  if (head !== undefined) {
    view.setUint32(head.offset + 8, (0xb1b0afba - tableChecksum(out)) >>> 0);
  }
  return out;
}
