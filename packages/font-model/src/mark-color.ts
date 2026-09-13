/**
 * Colour marks: the flag a designer puts on a glyph to say "done", or "look at
 * this again".
 *
 * Stored the way the UFO stores `public.markColor` — four numbers from 0 to 1,
 * comma-separated, red, green, blue and alpha — so a mark set here is the same
 * mark in any other editor that opens the source, and one set there shows here.
 * Nothing about it reaches a compiled font.
 */

export type MarkColor = {
  /** What the menu calls it. */
  readonly name: string;
  /** As the UFO writes it: `"r,g,b,a"`, each from 0 to 1. */
  readonly value: string;
};

/**
 * The colours offered.
 *
 * Few, and far enough apart to tell at a glance down a column of cells, because
 * a mark is read as a category rather than as a colour: seven is about as many
 * meanings as anybody keeps in their head for one font.
 */
export const MARK_COLORS: readonly MarkColor[] = [
  { name: "Red", value: "0.85,0.26,0.06,1" },
  { name: "Orange", value: "0.99,0.62,0.11,1" },
  { name: "Yellow", value: "0.97,0.9,0,1" },
  { name: "Green", value: "0.3,0.75,0.2,1" },
  { name: "Blue", value: "0.26,0.62,0.98,1" },
  { name: "Purple", value: "0.51,0.14,0.94,1" },
  { name: "Grey", value: "0.6,0.6,0.6,1" },
];

/** The four numbers of a mark colour, or `null` for one that does not parse. */
export function parseMarkColor(value: string): readonly [number, number, number, number] | null {
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4) return null;
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 1)) return null;
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

/**
 * Whether two marks are the same colour.
 *
 * Compared as numbers rather than as text, since another editor may write
 * `1,0,0,1` where this one writes `1.0,0.0,0.0,1.0`, and to within a rounding a
 * source's writer may have introduced.
 */
export function sameMarkColor(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const left = parseMarkColor(a);
  const right = parseMarkColor(b);
  if (left === null || right === null) return a === b;
  return left.every((n, i) => Math.abs(n - right[i]!) < 0.005);
}
