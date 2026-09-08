import { Bytes } from "./bytes.js";

/**
 * Adding records to a font's `name` table.
 *
 * Every axis and every named instance in a variable font refers to its name by
 * number, into the table opentype.js has already written. So the names have to
 * be put there and the numbers handed back — which means reading a finished
 * table, appending, and writing the whole thing out again.
 *
 * Format 0 only: a count, a storage offset, the records, then the strings. The
 * format's other version adds language tags nothing here has any use for.
 */

export type NameRecord = {
  readonly platformId: number;
  readonly encodingId: number;
  readonly languageId: number;
  readonly nameId: number;
  /** The bytes exactly as they were stored, whatever encoding they are in. */
  readonly text: Uint8Array;
};

/** The records in a `name` table, or none where it cannot be read. */
export function readNames(table: Uint8Array): NameRecord[] {
  if (table.length < 6) return [];

  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const count = view.getUint16(2);
  const storage = view.getUint16(4);

  const out: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    if (at + 12 > table.length) break;

    const length = view.getUint16(at + 8);
    const offset = storage + view.getUint16(at + 10);
    if (offset + length > table.length) continue;

    out.push({
      platformId: view.getUint16(at),
      encodingId: view.getUint16(at + 2),
      languageId: view.getUint16(at + 4),
      nameId: view.getUint16(at + 6),
      text: table.subarray(offset, offset + length),
    });
  }
  return out;
}

/** Write a `name` table from records, sorted as the format requires. */
export function nameTable(records: readonly NameRecord[]): Uint8Array {
  const sorted = [...records].sort(
    (a, b) =>
      a.platformId - b.platformId ||
      a.encodingId - b.encodingId ||
      a.languageId - b.languageId ||
      a.nameId - b.nameId,
  );

  const out = new Bytes();
  out.u16(0); // format 0
  out.u16(sorted.length);
  out.u16(6 + sorted.length * 12); // where the strings begin

  let at = 0;
  for (const record of sorted) {
    out.u16(record.platformId);
    out.u16(record.encodingId);
    out.u16(record.languageId);
    out.u16(record.nameId);
    out.u16(record.text.length);
    out.u16(at);
    at += record.text.length;
  }
  for (const record of sorted) out.bytes(record.text);

  return out.done();
}

/**
 * Add names to a table, and say what number each was given.
 *
 * Numbers are taken from 256 upwards, which is where the format reserves room
 * for exactly this. Each name is written for the two platforms every font
 * carries — Windows in UTF-16, Macintosh in Latin-1 — because a reader that
 * looks at only one of them and finds nothing shows an axis called nothing.
 */
export function withNames(
  table: Uint8Array,
  names: readonly string[],
): { table: Uint8Array; ids: number[] } {
  const records = readNames(table);
  let next = Math.max(255, ...records.map((r) => r.nameId)) + 1;

  const ids: number[] = [];
  for (const name of names) {
    const id = next++;
    ids.push(id);

    // Windows: platform 3, Unicode BMP, English (United States).
    records.push({
      platformId: 3,
      encodingId: 1,
      languageId: 0x409,
      nameId: id,
      text: utf16(name),
    });
    // Macintosh: platform 1, Roman, English.
    records.push({ platformId: 1, encodingId: 0, languageId: 0, nameId: id, text: latin1(name) });
  }

  return { table: nameTable(records), ids };
}

function utf16(text: string): Uint8Array {
  const out = new Bytes();
  for (let i = 0; i < text.length; i++) out.u16(text.charCodeAt(i));
  return out.done();
}

/** Latin-1, with anything outside it replaced rather than truncated silently. */
function latin1(text: string): Uint8Array {
  const out = new Bytes();
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out.u8(code < 256 ? code : 0x3f);
  }
  return out.done();
}
