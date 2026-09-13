/**
 * A line of typed text, read as the glyphs it asks for.
 *
 * Most of a font cannot be typed. An alternate `a.001`, a ligature, a
 * combining accent with nothing to combine with — none of them has a key, and
 * several have no code point at all. So a slash starts a glyph name, the way it
 * does in Glyphs: `/a.001` is that glyph, and `/uni0301` is the glyph named so
 * or, where there is none, whichever glyph carries U+0301. The name runs to the
 * next space or slash, and one space after it is taken as the end of the name
 * rather than as a space in the line — so `/a.001 b` sets two letters, and
 * `/f/i` sets two as well.
 *
 * A slash with nothing after it is a slash, so a line that ends in one while a
 * name is being typed does not lose it, and `//` is a slash for when a name
 * would otherwise follow.
 *
 * Kept apart from the document, because reading what was typed is a question
 * about text; which glyph each piece stands for is asked of the font next door.
 */
export type TextToken =
  | {
      readonly kind: "character";
      /** What was typed for it: the character, or `//` for an escaped slash. */
      readonly text: string;
      readonly codePoint: number;
    }
  | {
      readonly kind: "name";
      /** What was typed for it, slash and any space that ended it included. */
      readonly text: string;
      readonly name: string;
    };

/** Text read into characters and glyph names, in order. */
export function textTokens(text: string): TextToken[] {
  // Iterated as code points, so an astral character is one character rather
  // than two broken halves.
  const characters = [...text];
  const out: TextToken[] = [];

  for (let at = 0; at < characters.length; at++) {
    const here = characters[at]!;
    if (here !== "/") {
      out.push(character(here));
      continue;
    }

    const next = characters[at + 1];
    if (next === "/") {
      out.push(character("/", "//"));
      at++;
      continue;
    }
    if (next === undefined || isSpace(next)) {
      out.push(character("/"));
      continue;
    }

    let end = at + 1;
    while (end < characters.length && characters[end] !== "/" && !isSpace(characters[end]!)) end++;
    // One space ends the name and is not part of the line. A newline is left
    // alone: it is the end of a line as well as the end of a name.
    const swallowed = characters[end] === " " ? 1 : 0;

    out.push({
      kind: "name",
      text: characters.slice(at, end + swallowed).join(""),
      name: characters.slice(at + 1, end).join(""),
    });
    at = end + swallowed - 1;
  }

  return out;
}

/**
 * The code point a production name spells out, or `null`.
 *
 * `uni0301` and `u1F600` are how a glyph with no better name is named, so a
 * font that calls its acute something else can still be reached by the name
 * everybody can work out from the code point.
 */
export function codePointFromName(name: string): number | null {
  const found = /^uni([0-9A-F]{4})$/i.exec(name) ?? /^u([0-9A-F]{4,6})$/i.exec(name);
  if (found === null) return null;
  const codePoint = Number.parseInt(found[1]!, 16);
  return codePoint <= 0x10ffff ? codePoint : null;
}

function character(typed: string, text = typed): TextToken {
  return { kind: "character", text, codePoint: typed.codePointAt(0) ?? 0 };
}

function isSpace(character: string): boolean {
  return /\s/.test(character);
}
