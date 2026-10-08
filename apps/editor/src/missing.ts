/** How many pieces with no glyph are named before the rest are counted. */
const MISSING_NAMED = 4;

/**
 * What a line of text leaves out, said: the pieces typed that the font has no
 * glyph for, the first few by what was typed and the rest by how many.
 *
 * One wording for the Spacing line and the Proof, which leave the same things
 * out for the same reason and should not describe it two ways.
 */
export function missingText(missing: readonly string[]): string {
  const named = missing.slice(0, MISSING_NAMED).join(" ");
  const more = missing.length - MISSING_NAMED;
  return more > 0 ? `No glyph for ${named} and ${String(more)} more` : `No glyph for ${named}`;
}
