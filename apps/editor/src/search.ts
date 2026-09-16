/**
 * Finding and replacing text in feature source.
 *
 * Literal text, never a pattern: what somebody searching a feature file types
 * is a glyph name or a piece of a rule, and `a.sc` meaning "a, any character,
 * sc" would find what they did not ask for. A whole word is a whole name as the
 * language splits them, so a whole-word `a` finds the `a` in `sub a by b;` and
 * not the one in `a.sc`.
 */

export type SearchOptions = {
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
};

export type Match = { readonly start: number; readonly end: number };

const isBoundary = (ch: string | undefined): boolean =>
  ch === undefined || /[\s[\]{};='<>,()#]/.test(ch) || ch === "'";

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every place the query is found, in order and not overlapping. */
export function findAll(text: string, query: string, options: SearchOptions): Match[] {
  if (query === "") return [];
  const pattern = new RegExp(escaped(query), options.matchCase ? "g" : "gi");
  const found: Match[] = [];
  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
    const start = hit.index;
    const end = start + hit[0].length;
    if (options.wholeWord && !(isBoundary(text[start - 1]) && isBoundary(text[end]))) {
      pattern.lastIndex = start + 1;
      continue;
    }
    found.push({ start, end });
  }
  return found;
}

/** The text with each of these matches replaced. */
export function replaced(text: string, matches: readonly Match[], replacement: string): string {
  let out = "";
  let at = 0;
  for (const match of [...matches].sort((a, b) => a.start - b.start)) {
    out += text.slice(at, match.start) + replacement;
    at = match.end;
  }
  return out + text.slice(at);
}

/** The first match at or after a place, wrapping round to the first; -1 when there are none. */
export function matchFrom(matches: readonly Match[], offset: number): number {
  if (matches.length === 0) return -1;
  const index = matches.findIndex((match) => match.start >= offset);
  return index === -1 ? 0 : index;
}
