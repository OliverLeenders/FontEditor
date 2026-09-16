import { KEYWORDS, highlightFea } from "./highlight.js";

/**
 * What to offer while feature source is being typed, and the name under a place.
 *
 * Read from the text the way the highlighter reads it — words split at white
 * space and the language's punctuation — rather than from the compiler, because
 * a file being typed rarely compiles. What is offered depends on where the word
 * is: after `@` the classes the file defines, after `lookup` its named lookups,
 * after `feature` the registered feature tags, and otherwise the font's glyph
 * names followed by the language's keywords. Nothing is offered inside a
 * comment.
 */

export type CompletionKind = "glyph" | "class" | "lookup" | "keyword" | "tag";

export type Completion = { readonly label: string; readonly kind: CompletionKind };

export type CompletionList = {
  /** The word being completed, which accepting a completion replaces whole. */
  readonly from: number;
  readonly to: number;
  readonly items: readonly Completion[];
};

/** More than this is a list nobody reads; typing another letter is quicker. */
export const MAX_COMPLETIONS = 50;

/** How much of a word is typed before the list offers itself unasked. */
export const AUTOMATIC_AFTER = 2;

const isBoundary = (ch: string): boolean => /[\s[\]{};='<>,()#]/.test(ch) || ch === "'";

/** The registered feature tags, from the OpenType feature tag registry. */
export const FEATURE_TAGS: readonly string[] = [
  ...[
    "aalt", "abvf", "abvm", "abvs", "afrc", "akhn", "blwf", "blwm", "blws", "c2pc", "c2sc",
    "calt", "case", "ccmp", "cfar", "chws", "cjct", "clig", "cpct", "cpsp", "cswh", "curs",
    "dist", "dlig", "dnom", "dtls", "expt", "falt", "fin2", "fin3", "fina", "flac", "frac",
    "fwid", "half", "haln", "halt", "hist", "hkna", "hlig", "hngl", "hojo", "hwid", "init",
    "isol", "ital", "jalt", "jp04", "jp78", "jp83", "jp90", "kern", "lfbd", "liga", "ljmo",
    "lnum", "locl", "ltra", "ltrm", "mark", "med2", "medi", "mgrk", "mkmk", "mset", "nalt",
    "nlck", "nukt", "numr", "onum", "opbd", "ordn", "ornm", "palt", "pcap", "pkna", "pnum",
    "pref", "pres", "pstf", "psts", "pwid", "qwid", "rand", "rclt", "rkrf", "rlig", "rphf",
    "rtbd", "rtla", "rtlm", "ruby", "rvrn", "salt", "sinf", "size", "smcp", "smpl", "ssty",
    "stch", "subs", "sups", "swsh", "titl", "tjmo", "tnam", "tnum", "trad", "twid", "unic",
    "valt", "vapk", "vatu", "vchw", "vert", "vhal", "vjmo", "vkna", "vkrn", "vpal", "vrt2",
    "vrtr", "zero",
  ], // prettier-ignore
  ...Array.from({ length: 20 }, (_, i) => `ss${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 99 }, (_, i) => `cv${String(i + 1).padStart(2, "0")}`),
].sort();

/** The word a place is in or at the end of, as offsets; empty where there is none. */
export function wordAround(source: string, offset: number): { start: number; end: number } {
  let start = offset;
  while (start > 0 && !isBoundary(source[start - 1]!)) start -= 1;
  let end = offset;
  while (end < source.length && !isBoundary(source[end]!)) end += 1;
  return { start, end };
}

/** Whether a place is after a `#` on its line. */
function inComment(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  return source.slice(lineStart, offset).includes("#");
}

/** The word before this one, skipping white space. */
function previousWord(source: string, start: number): string {
  let end = start;
  while (end > 0 && /\s/.test(source[end - 1]!)) end -= 1;
  return source.slice(wordAround(source, end).start, end);
}

/** The classes and named lookups a file defines, each once, in the order they appear. */
export function namesDefined(source: string): { classes: string[]; lookups: string[] } {
  const classes = new Set<string>();
  for (const found of source.matchAll(/(@[A-Za-z0-9_.-]+)\s*=/g)) classes.add(found[1]!);
  for (const found of source.matchAll(/\bmarkClass\b[^;]*?(@[A-Za-z0-9_.-]+)\s*;/g)) {
    classes.add(found[1]!);
  }
  const lookups = new Set<string>();
  for (const found of source.matchAll(
    /\blookup\s+([A-Za-z_][A-Za-z0-9_.]*)\s*(?:useExtension\s*)?\{/g,
  )) {
    lookups.add(found[1]!);
  }
  return { classes: [...classes], lookups: [...lookups] };
}

/**
 * Matches for what has been typed: those starting with it as typed first, then
 * those starting with it in any case, then those containing it anywhere.
 */
function ranked(candidates: readonly Completion[], typed: string): Completion[] {
  const lower = typed.toLowerCase();
  const exact: Completion[] = [];
  const loose: Completion[] = [];
  const inside: Completion[] = [];
  for (const candidate of candidates) {
    if (candidate.label.startsWith(typed)) exact.push(candidate);
    else if (candidate.label.toLowerCase().startsWith(lower)) loose.push(candidate);
    else if (candidate.label.toLowerCase().includes(lower)) inside.push(candidate);
  }
  return [...exact, ...loose, ...inside];
}

/**
 * What to offer at a place in the source, or `null` for nothing.
 *
 * `asked` is Ctrl+Space: the list opens however little has been typed. Unasked,
 * it waits for {@link AUTOMATIC_AFTER} characters, and stays shut when the only
 * thing it would offer is the word already written.
 */
export function completionsAt(
  source: string,
  offset: number,
  glyphs: readonly string[],
  asked: boolean,
): CompletionList | null {
  if (inComment(source, offset)) return null;
  const { start, end } = wordAround(source, offset);
  const typed = source.slice(start, offset);
  if (!asked && typed.length < AUTOMATIC_AFTER) return null;

  const before = previousWord(source, start);
  const defined = namesDefined(source);
  const of = (labels: readonly string[], kind: CompletionKind): Completion[] =>
    labels.map((label) => ({ label, kind }));

  let candidates: Completion[];
  if (typed.startsWith("@")) candidates = of(defined.classes, "class");
  else if (before === "lookup") candidates = of(defined.lookups, "lookup");
  else if (before === "feature") candidates = of(FEATURE_TAGS, "tag");
  else candidates = [...of(glyphs, "glyph"), ...of([...KEYWORDS], "keyword")];

  const items = ranked(candidates, typed).slice(0, MAX_COMPLETIONS);
  if (items.length === 0) return null;
  if (!asked && items.length === 1 && items[0]!.label === source.slice(start, end)) return null;
  return { from: start, to: end, items };
}

/**
 * The glyph name a place is in or touching, or `null`.
 *
 * Only what the highlighter reads as a glyph name — not a keyword, a class, a
 * tag, a number or a comment. A name escaped with a backslash, as a glyph named
 * like a keyword is, comes back without it.
 */
export function glyphAt(
  source: string,
  offset: number,
): { start: number; end: number; name: string } | null {
  let at = 0;
  for (const token of highlightFea(source)) {
    const end = at + token.text.length;
    if (token.kind === "glyph" && offset >= at && offset <= end) {
      const name = token.text.startsWith("\\") ? token.text.slice(1) : token.text;
      return { start: at, end, name };
    }
    if (at > offset) break;
    at = end;
  }
  return null;
}
