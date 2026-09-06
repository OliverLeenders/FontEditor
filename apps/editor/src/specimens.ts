/**
 * The strings a font is judged by, ready to pick from a list.
 *
 * Two kinds, because the two views ask different questions. Spacing wants a
 * letter set repeatedly against a known neighbour, so that the white either side
 * of it can be compared with the white either side of the next one — which is
 * why every one of those strings is a frame with the alphabet threaded through
 * it rather than words. A proof wants sentences, because what is being judged
 * there is a line of type.
 *
 * The set follows the one in Gunnlaugur SE Briem's spacing notes, which is where
 * the frames `nn`, `oo`, `H` and `O` come from: a round and a straight on each
 * side, in each case, at both sizes of letter.
 *
 * The control strings are built rather than typed out. Eighty characters of
 * `nnannbnncnn…` is exactly the sort of thing a fingerslip corrupts invisibly,
 * and a rule that generates them cannot skip a letter.
 */

export type Specimen = {
  readonly name: string;
  readonly text: string;
};

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Every letter of `alphabet` in turn, threaded through a repeated `frame`. */
function threaded(frame: string, alphabet: string): string {
  return [...alphabet].map((letter) => frame + letter).join("") + frame;
}

export const SPACING_SPECIMENS: readonly Specimen[] = [
  { name: "Handgloves", text: "handgloves" },
  { name: "nonno", text: "nonno" },
  { name: "Lowercase between n", text: threaded("nn", LOWER) },
  { name: "Lowercase between o", text: threaded("oo", LOWER) },
  { name: "Capitals between H", text: threaded("H", UPPER) },
  { name: "Capitals between O", text: threaded("O", UPPER) },
  // The two that answer the question the other four cannot: whether the
  // capitals are spaced to suit the lowercase they will stand in front of.
  { name: "Capitals between nn", text: threaded("nn", UPPER) },
  { name: "Capitals between oo", text: threaded("oo", UPPER) },
];

const NEWLINE = String.fromCharCode(10);

/**
 * Six sentences using every letter, which is what makes them a proof rather than
 * a page: nothing in the alphabet goes unset.
 */
const PANGRAMS = [
  "Sphinx of black quartz, judge my vow.",
  "Thief, give back my prized wax jonquils!",
  "Pack my box with five dozen liquor jugs.",
  "The quick brown fox jumps over the lazy dog.",
  "Sixty zippers were quickly picked from the woven jute bag.",
  "Jaded zombies acted quaintly but kept driving their oxen forward.",
].join(NEWLINE);

/**
 * What the proof shows before anyone types anything.
 *
 * Lowercase, because that is what a text face is judged on and what most fonts
 * here will have first. It says what it is rather than being a pangram: a
 * pangram exercises the alphabet, which is the glyph browser's job, where a
 * proof is for reading. The pangrams are a preset away when they are wanted.
 */
export const PROOF_TEXT = [
  "handgloves and the shape of the space between them",
  "no one reads a letter, they read a line of them",
  "",
  "the only way to know whether a font works is to set it and look",
].join(NEWLINE);

export const PROOF_SPECIMENS: readonly Specimen[] = [
  { name: "Handgloves", text: PROOF_TEXT },
  { name: "Pangrams", text: PANGRAMS },
];

/**
 * Which specimen is showing, or `null` for text somebody has since edited.
 *
 * So the list can say "this is the one you are looking at" without taking the
 * text over: type a letter into a preset and the list goes back to naming
 * nothing, which is the truth of what is on screen.
 */
export function specimenNamed(
  specimens: readonly Specimen[],
  text: string,
): Specimen["name"] | null {
  return specimens.find((s) => s.text === text)?.name ?? null;
}
