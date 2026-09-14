/**
 * What a spacing key says, read from the text it is written as.
 *
 * Apart from `metric-keys.ts`, which follows keys through the whole document,
 * because reading one needs no document at all — and renaming a glyph, which
 * the document does, has to rewrite the keys that name it.
 */

/**
 * A key, read.
 *
 * What a key field holds is a glyph name, with a little more said about it where
 * that is wanted — the grammar Glyphs uses, so somebody who has spaced a family
 * there types what their hands already know:
 *
 * - `o` — the same side of `o`.
 * - `|b` — the other side of `b`: a `d`'s left side is a `b`'s right, turned round.
 * - `|` — this glyph's own other side, which is how an `o` is kept symmetrical.
 * - `o+10`, `|b-5` — any of those, and a number of units more or less.
 *
 * A leading `=` is allowed and ignored, because that is how the spacing view tells
 * a key from a number, and a key copied out of there should still read. Only whole
 * units are added: a font is written in them, and a fraction would be rounded away
 * when it is compiled.
 *
 * The offset is read off the end, and only where it is a number, so a name with a
 * hyphen in it — `a-cy` — is a name rather than `a` less something.
 */
export type MetricKeyReference = {
  /** The glyph named, or `""` for this glyph's own other side. */
  readonly glyph: string;
  /** Take the other side of it: its right side for a left key, and the reverse. */
  readonly opposite: boolean;
  readonly offset: number;
};

/** An optional `=`, an optional bar, a name, and any number of whole `+n` and `-n`. */
const KEY = /^=?\s*(\|)?\s*([^\s|]*?)\s*((?:[+-]\s*\d+\s*)*)$/;

/** What a key says, or `null` where it cannot be read at all. */
export function parseMetricKey(text: string): MetricKeyReference | null {
  const found = KEY.exec(text.trim());
  if (found === null) return null;

  const opposite = found[1] !== undefined;
  const glyph = found[2] ?? "";
  // A bare `=` names nothing. A bare bar names this glyph's other side.
  if (glyph === "" && !opposite) return null;

  let offset = 0;
  for (const term of (found[3] ?? "").matchAll(/([+-])\s*(\d+)/g)) {
    const size = Number(term[2] ?? "0");
    offset += term[1] === "-" ? -size : size;
  }
  return { glyph, opposite, offset };
}

/**
 * A key with one glyph's name changed to another, and everything else it says kept.
 *
 * Written back in its plainest form — `|b+10`, never `= | b + 10` — since a key
 * that is rewritten is being written by the editor rather than typed. A key that
 * names another glyph, or cannot be read, comes back exactly as it was.
 */
export function renamedMetricKey(text: string, from: string, to: string): string {
  const key = parseMetricKey(text);
  if (key === null || key.glyph !== from) return text;

  const offset =
    key.offset === 0 ? "" : key.offset > 0 ? `+${String(key.offset)}` : String(key.offset);
  return `${key.opposite ? "|" : ""}${to}${offset}`;
}
