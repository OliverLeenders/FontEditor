/**
 * Feature source, cut into pieces for colouring.
 *
 * Not a parser, and not the compiler's reading of the file: it has to colour a
 * file that does not compile yet, which is most of the time while one is being
 * typed. So it reads words the way the compiler's own tokenizer does — split at
 * white space and the language's punctuation — and names each by what it looks
 * like: a keyword, a tag after the words that take one, a `@class`, a number, a
 * comment, or otherwise a glyph name. Every character of the source is in
 * exactly one piece, in order, so joining the pieces gives the source back.
 */

export type TokenKind =
  | "comment"
  | "keyword"
  | "tag"
  | "class"
  | "glyph"
  | "number"
  | "punctuation"
  | "mark"
  | "space"
  | "newline";

export type Token = { readonly kind: TokenKind; readonly text: string };

/** The language's reserved words, from the feature file specification. */
const KEYWORDS = new Set([
  "anchor",
  "anchorDef",
  "anon",
  "anonymous",
  "base",
  "by",
  "contourpoint",
  "cursive",
  "device",
  "enum",
  "enumerate",
  "exclude_dflt",
  "feature",
  "featureNames",
  "from",
  "ignore",
  "IgnoreBaseGlyphs",
  "IgnoreLigatures",
  "IgnoreMarks",
  "include",
  "include_dflt",
  "language",
  "languagesystem",
  "ligature",
  "ligComponent",
  "lookup",
  "lookupflag",
  "mark",
  "MarkAttachmentType",
  "markClass",
  "name",
  "NULL",
  "parameters",
  "pos",
  "position",
  "required",
  "reversesub",
  "RightToLeft",
  "rsub",
  "script",
  "sizemenuname",
  "sub",
  "substitute",
  "subtable",
  "table",
  "useExtension",
  "UseMarkFilteringSet",
  "valueRecordDef",
]);

/** How many tags or names follow each word that introduces them. */
const NAMING: ReadonlyMap<string, number> = new Map([
  ["feature", 1],
  ["lookup", 1],
  ["script", 1],
  ["language", 1],
  ["languagesystem", 2],
]);

const PUNCTUATION = new Set(["[", "]", ";", "=", "{", "}", ",", "<", ">", "(", ")"]);
const NUMBER = /^-?[0-9]+(\.[0-9]+)?$/;

const blank = (ch: string): boolean => ch !== "\n" && /\s/.test(ch);

export function highlightFea(source: string): Token[] {
  const tokens: Token[] = [];
  // Tags still expected: after `feature`, `lookup` and the like, and after the
  // `}` that closes a block and names it again.
  let tags = 0;
  let at = 0;

  while (at < source.length) {
    const ch = source[at]!;

    if (ch === "\n") {
      tokens.push({ kind: "newline", text: ch });
      tags = 0;
      at += 1;
      continue;
    }
    if (ch === "#") {
      const end = source.indexOf("\n", at);
      const stop = end === -1 ? source.length : end;
      tokens.push({ kind: "comment", text: source.slice(at, stop) });
      at = stop;
      continue;
    }
    if (blank(ch)) {
      let end = at;
      while (end < source.length && blank(source[end]!)) end += 1;
      tokens.push({ kind: "space", text: source.slice(at, end) });
      at = end;
      continue;
    }
    if (ch === "'") {
      tokens.push({ kind: "mark", text: ch });
      at += 1;
      continue;
    }
    if (PUNCTUATION.has(ch)) {
      tokens.push({ kind: "punctuation", text: ch });
      tags = ch === "}" ? 1 : 0;
      at += 1;
      continue;
    }

    let end = at;
    while (
      end < source.length &&
      !/\s/.test(source[end]!) &&
      !PUNCTUATION.has(source[end]!) &&
      source[end] !== "'" &&
      source[end] !== "#"
    ) {
      end += 1;
    }
    const word = source.slice(at, end);
    at = end;

    if (tags > 0) {
      tags -= 1;
      tokens.push({ kind: "tag", text: word });
    } else if (KEYWORDS.has(word)) {
      tags = NAMING.get(word) ?? 0;
      tokens.push({ kind: "keyword", text: word });
    } else if (word.startsWith("@")) {
      tokens.push({ kind: "class", text: word });
    } else if (NUMBER.test(word)) {
      tokens.push({ kind: "number", text: word });
    } else {
      tokens.push({ kind: "glyph", text: word });
    }
  }

  return tokens;
}
