/**
 * Unicode blocks, curated.
 *
 * The standard defines well over three hundred; listing them all would be a lot
 * of data for a filter menu nobody could scan. These are the ranges a type
 * designer actually works in, and anything outside them falls under "Other" —
 * which is honest about what it is, rather than pretending the list is complete.
 *
 * Ranges are inclusive at both ends, and the list is kept in ascending order so
 * {@link blockOf} can stop early.
 */
export type UnicodeBlock = {
  readonly id: string;
  readonly label: string;
  readonly first: number;
  readonly last: number;
};

export const UNICODE_BLOCKS: readonly UnicodeBlock[] = [
  { id: "basic-latin", label: "Basic Latin", first: 0x0000, last: 0x007f },
  { id: "latin-1", label: "Latin-1 Supplement", first: 0x0080, last: 0x00ff },
  { id: "latin-a", label: "Latin Extended-A", first: 0x0100, last: 0x017f },
  { id: "latin-b", label: "Latin Extended-B", first: 0x0180, last: 0x024f },
  { id: "ipa", label: "IPA Extensions", first: 0x0250, last: 0x02af },
  { id: "modifiers", label: "Spacing Modifiers", first: 0x02b0, last: 0x02ff },
  { id: "combining", label: "Combining Marks", first: 0x0300, last: 0x036f },
  { id: "greek", label: "Greek and Coptic", first: 0x0370, last: 0x03ff },
  { id: "cyrillic", label: "Cyrillic", first: 0x0400, last: 0x04ff },
  { id: "hebrew", label: "Hebrew", first: 0x0590, last: 0x05ff },
  { id: "arabic", label: "Arabic", first: 0x0600, last: 0x06ff },
  { id: "devanagari", label: "Devanagari", first: 0x0900, last: 0x097f },
  { id: "thai", label: "Thai", first: 0x0e00, last: 0x0e7f },
  { id: "punctuation", label: "General Punctuation", first: 0x2000, last: 0x206f },
  { id: "superscripts", label: "Super- and Subscripts", first: 0x2070, last: 0x209f },
  { id: "currency", label: "Currency Symbols", first: 0x20a0, last: 0x20cf },
  { id: "letterlike", label: "Letterlike Symbols", first: 0x2100, last: 0x214f },
  { id: "numbers", label: "Number Forms", first: 0x2150, last: 0x218f },
  { id: "arrows", label: "Arrows", first: 0x2190, last: 0x21ff },
  { id: "math", label: "Mathematical Operators", first: 0x2200, last: 0x22ff },
  { id: "box", label: "Box Drawing", first: 0x2500, last: 0x257f },
  { id: "blocks", label: "Block Elements", first: 0x2580, last: 0x259f },
  { id: "shapes", label: "Geometric Shapes", first: 0x25a0, last: 0x25ff },
  { id: "symbols", label: "Miscellaneous Symbols", first: 0x2600, last: 0x26ff },
  { id: "dingbats", label: "Dingbats", first: 0x2700, last: 0x27bf },
  { id: "hiragana", label: "Hiragana", first: 0x3040, last: 0x309f },
  { id: "katakana", label: "Katakana", first: 0x30a0, last: 0x30ff },
  { id: "cjk", label: "CJK Unified Ideographs", first: 0x4e00, last: 0x9fff },
  { id: "hangul", label: "Hangul Syllables", first: 0xac00, last: 0xd7af },
  { id: "private", label: "Private Use Area", first: 0xe000, last: 0xf8ff },
  { id: "emoji", label: "Emoji and Pictographs", first: 0x1f300, last: 0x1f9ff },
];

/** The block a code point belongs to, or `null` if it falls outside the list. */
export function blockOf(codePoint: number): UnicodeBlock | null {
  for (const block of UNICODE_BLOCKS) {
    if (codePoint < block.first) return null;
    if (codePoint <= block.last) return block;
  }
  return null;
}
