import { Bytes } from "./bytes.js";

/**
 * `post` version 2: the glyph names, for the TrueType flavour.
 *
 * A CFF font keeps its glyph names in the CFF table, so the version 3 `post`
 * opentype.js writes — the one with no names in it — costs that flavour
 * nothing. The TrueType flavour swaps the CFF table out, and with it went every
 * name: a font exported here and opened again came back with its glyphs called
 * `uni0041` and `glyph12`, and a font opened in another editor lost its
 * alternates' names the same way.
 *
 * So the TrueType flavour gets version 2, which lists a name for every glyph.
 * The format lets a name be one of 258 standard Macintosh names by number, and
 * saving those few bytes is not worth a table of 258 names to keep here; only
 * `.notdef`, which a reader expects to find at zero, is written that way.
 * Everything else is written out.
 *
 * `existing` is the table the export wrote, whose italic angle, underline and
 * fixed-pitch fields are kept exactly as they were.
 */
export function postWithNames(existing: Uint8Array, names: readonly string[]): Uint8Array {
  if (existing.length < 32) return existing;

  const out = new Bytes().u32(0x00020000);
  out.bytes(existing.subarray(4, 32));
  out.u16(names.length);

  const written: Uint8Array[] = [];
  const encoder = new TextEncoder();
  for (const name of names) {
    if (name === ".notdef") {
      out.u16(0);
      continue;
    }
    out.u16(258 + written.length);
    // A Pascal string: a length byte, so at most 255 bytes of name.
    written.push(encoder.encode(name).subarray(0, 255));
  }
  for (const bytes of written) {
    out.u8(bytes.length);
    out.bytes(bytes);
  }
  return out.done();
}
