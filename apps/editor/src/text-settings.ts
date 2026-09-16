import { parseFea } from "@typewright/font-io";
import type { FontDocument } from "@typewright/font-model";

/**
 * Which scripts and languages a font's own text can be set for.
 *
 * The pickers in the Spacing and Proof bars are about the font in hand rather
 * than about OpenType: a list of two hundred registered tags is a list nobody
 * reads, and a font drawn for Arabic and Latin has two entries worth offering.
 *
 * So the scripts are worked out from the characters the font actually covers,
 * and the languages from the `languagesystem` lines its feature file declares —
 * which are exactly the languages its rules can do anything different for.
 */

export type TextChoice = { readonly tag: string; readonly label: string };

/**
 * A script, as the range of characters it is written with.
 *
 * Coarse on purpose: this decides what to offer in a menu, not what a character
 * is. Ranges are the Unicode blocks a script's letters live in, and a script
 * whose letters the font has none of is not offered at all.
 */
const SCRIPTS: readonly {
  readonly tag: string;
  readonly label: string;
  readonly ranges: readonly (readonly [number, number])[];
}[] = [
  {
    tag: "latn",
    label: "Latin",
    ranges: [
      [0x41, 0x5a],
      [0x61, 0x7a],
      [0xc0, 0x24f],
      [0x1e00, 0x1eff],
    ],
  },
  {
    tag: "grek",
    label: "Greek",
    ranges: [
      [0x370, 0x3ff],
      [0x1f00, 0x1fff],
    ],
  },
  { tag: "cyrl", label: "Cyrillic", ranges: [[0x400, 0x52f]] },
  { tag: "armn", label: "Armenian", ranges: [[0x530, 0x58f]] },
  { tag: "hebr", label: "Hebrew", ranges: [[0x590, 0x5ff]] },
  {
    tag: "arab",
    label: "Arabic",
    ranges: [
      [0x600, 0x6ff],
      [0x750, 0x77f],
      [0x8a0, 0x8ff],
      [0xfb50, 0xfdff],
      [0xfe70, 0xfeff],
    ],
  },
  { tag: "syrc", label: "Syriac", ranges: [[0x700, 0x74f]] },
  { tag: "thaa", label: "Thaana", ranges: [[0x780, 0x7bf]] },
  { tag: "nko ", label: "N'Ko", ranges: [[0x7c0, 0x7ff]] },
  { tag: "deva", label: "Devanagari", ranges: [[0x900, 0x97f]] },
  { tag: "beng", label: "Bengali", ranges: [[0x980, 0x9ff]] },
  { tag: "guru", label: "Gurmukhi", ranges: [[0xa00, 0xa7f]] },
  { tag: "gujr", label: "Gujarati", ranges: [[0xa80, 0xaff]] },
  { tag: "orya", label: "Oriya", ranges: [[0xb00, 0xb7f]] },
  { tag: "taml", label: "Tamil", ranges: [[0xb80, 0xbff]] },
  { tag: "telu", label: "Telugu", ranges: [[0xc00, 0xc7f]] },
  { tag: "knda", label: "Kannada", ranges: [[0xc80, 0xcff]] },
  { tag: "mlym", label: "Malayalam", ranges: [[0xd00, 0xd7f]] },
  { tag: "sinh", label: "Sinhala", ranges: [[0xd80, 0xdff]] },
  { tag: "thai", label: "Thai", ranges: [[0xe00, 0xe7f]] },
  { tag: "lao ", label: "Lao", ranges: [[0xe80, 0xeff]] },
  { tag: "tibt", label: "Tibetan", ranges: [[0xf00, 0xfff]] },
  { tag: "mymr", label: "Myanmar", ranges: [[0x1000, 0x109f]] },
  { tag: "geor", label: "Georgian", ranges: [[0x10a0, 0x10ff]] },
  {
    tag: "hang",
    label: "Hangul",
    ranges: [
      [0x1100, 0x11ff],
      [0xac00, 0xd7af],
    ],
  },
  { tag: "ethi", label: "Ethiopic", ranges: [[0x1200, 0x137f]] },
  { tag: "khmr", label: "Khmer", ranges: [[0x1780, 0x17ff]] },
  { tag: "mong", label: "Mongolian", ranges: [[0x1800, 0x18af]] },
  { tag: "kana", label: "Kana", ranges: [[0x3040, 0x30ff]] },
  {
    tag: "hani",
    label: "Han",
    ranges: [
      [0x3400, 0x4dbf],
      [0x4e00, 0x9fff],
    ],
  },
];

/** The scripts whose letters the font has, the best covered first. */
export function scriptsOf(document: FontDocument): TextChoice[] {
  const counts = new Map<string, number>();
  for (const name of document.glyphOrder) {
    for (const code of document.glyphs[name]?.unicodes ?? []) {
      const script = SCRIPTS.find((s) => s.ranges.some(([from, to]) => code >= from && code <= to));
      if (script === undefined) continue;
      counts.set(script.tag, (counts.get(script.tag) ?? 0) + 1);
    }
  }

  // Whatever the feature file declares as well, even where the font has not
  // been drawn that far yet: a file with a `languagesystem arab ARA` line is a
  // font on its way to Arabic, and the proof should be able to say so.
  for (const system of declared(document)) {
    // Never DFLT: it is the script that means "whatever this is", which is what
    // choosing nothing already says.
    if (system.script.trim() === "DFLT") continue;
    counts.set(system.script, counts.get(system.script) ?? 0);
  }

  return [...counts]
    .sort(([leftTag, left], [rightTag, right]) => right - left || leftTag.localeCompare(rightTag))
    .map(([tag]) => ({ tag, label: SCRIPTS.find((s) => s.tag === tag)?.label ?? tag.trim() }));
}

/** The language tags the feature file names, which are the ones its rules can differ for. */
export function languagesOf(document: FontDocument): TextChoice[] {
  const tags = new Set<string>();
  for (const system of declared(document)) {
    const tag = system.language.trim();
    if (tag !== "" && tag !== "dflt") tags.add(system.language);
  }
  return [...tags]
    .sort((a, b) => a.localeCompare(b))
    .map((tag) => ({ tag, label: LANGUAGES[tag.trim()] ?? tag.trim() }));
}

/** The `languagesystem` lines of the font's feature file, if it has any. */
function declared(document: FontDocument): readonly { script: string; language: string }[] {
  if (document.features.trim() === "") return [];
  try {
    return parseFea(document.features).languageSystems;
  } catch {
    // A file being typed is a file that does not parse, half the time. The
    // pickers are not the place to say so — the Features workspace is.
    return [];
  }
}

/**
 * Names for the language tags a Latin font is most likely to declare.
 *
 * A tag nobody has a name for here is shown as itself, which is what a designer
 * wrote in the feature file and will recognise.
 */
const LANGUAGES: Readonly<Record<string, string>> = {
  ARA: "Arabic",
  AZE: "Azerbaijani",
  CAT: "Catalan",
  CRT: "Crimean Tatar",
  CSY: "Czech",
  DEU: "German",
  ELL: "Greek",
  ENG: "English",
  ESP: "Spanish",
  FAR: "Persian",
  FRA: "French",
  HEB: "Hebrew",
  HUN: "Hungarian",
  ISL: "Icelandic",
  ITA: "Italian",
  KAZ: "Kazakh",
  MOL: "Moldavian",
  NLD: "Dutch",
  PLK: "Polish",
  PTG: "Portuguese",
  ROM: "Romanian",
  RUS: "Russian",
  SKY: "Slovak",
  SVE: "Swedish",
  TAT: "Tatar",
  TRK: "Turkish",
  URD: "Urdu",
  VIT: "Vietnamese",
};
