import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_FONT_INFO,
  type FontDocument,
  anchor,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  orderedGlyphs,
  setFeatures,
} from "@typewright/font-model";
import { Blob, Buffer, Face, Feature, Font, shape } from "harfbuzzjs";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { importFont } from "../src/import.js";
import { writeMarks } from "../src/marks-source.js";

/**
 * A feature file compiled twice: here, and by fontTools.
 *
 * The suite checks that text set with a font compiled here comes out as each
 * rule says. This asks a harder question of the whole file at once: whether the
 * font does exactly what the same file compiled by fontTools' feaLib does — the
 * compiler fontmake and nearly every build pipeline in type goes through. Both
 * fonts are set by HarfBuzz, string by string, and every glyph and every
 * position has to agree.
 *
 * Mark attachment is in it too. This editor compiles it from the anchors; the
 * file handed to fontTools has the Marks file written from those anchors after
 * the features, so agreeing is also proof that the Marks file says what the
 * anchors do.
 *
 * CI runs it in three steps. `FEATURES_OUT` writes the font and its feature
 * file. `tools/otf-check/compile_fea.py` compiles the same
 * file into a copy of the font with fontTools. Then `FEATURES_REFERENCE` names
 * that copy, and this compares the two. Without either, the test only checks
 * that every string sets at all, so the suite stays a suite.
 */

const OUT = process.env["FEATURES_OUT"] ?? "";
const REFERENCE = process.env["FEATURES_REFERENCE"] ?? "";
/** A second font fontTools compiles, of what this editor can only keep as source. */
const IMPORT_REFERENCE = process.env["IMPORT_REFERENCE"] ?? "";

const ids = counterIds("pf");

const drawn = () =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: 0 }),
      node(ids.node(), { x: 100, y: 0 }),
      node(ids.node(), { x: 50, y: 100 }),
    ],
    true,
  );

const GLYPHS: readonly (readonly [string, number | null])[] = [
  ["A", 0x41],
  ["B", 0x42],
  ["T", 0x54],
  ["a", 0x61],
  ["b", 0x62],
  ["c", 0x63],
  ["e", 0x65],
  ["f", 0x66],
  ["i", 0x69],
  ["n", 0x6e],
  ["o", 0x6f],
  ["ae", 0xe6],
  ["f_i", null],
  ["f_f_i", null],
  ["a.sc", null],
  ["b.sc", null],
  ["a.alt1", null],
  ["a.alt2", null],
  ["i.TRK", null],
  ["gravecomb", 0x300],
  ["acutecomb", 0x301],
  ["cedillacomb", 0x327],
];

/** Anchors, by glyph: two letters, two accents that stack, and a mark below. */
const ANCHORS: Readonly<Record<string, readonly (readonly [string, number, number])[]>> = {
  a: [
    ["top", 250, 480],
    ["bottom", 240, 0],
  ],
  o: [["top", 260, 500]],
  "a.sc": [["top", 250, 400]],
  acutecomb: [
    ["_top", 0, 500],
    ["top", 0, 700],
  ],
  gravecomb: [
    ["_top", 10, 520],
    ["top", 10, 720],
  ],
  cedillacomb: [["_bottom", 0, 0]],
};

const MARKS = new Set(["gravecomb", "acutecomb", "cedillacomb"]);

/**
 * Every construct the compiler reads, at least once, in the order a real file
 * would have them: language systems, classes, named lookups, then features.
 */
export const PROOF_FEATURES = `languagesystem DFLT dflt;
languagesystem latn dflt;
languagesystem latn TRK;

@LOWER = [a b];
@SMALL = [a.sc b.sc];

lookup SMALL {
    sub @LOWER by @SMALL;
} SMALL;

lookup LIFT {
    pos o <0 40 0 0>;
} LIFT;

feature ccmp {
    sub ae by a e;
} ccmp;

table GDEF {
    GlyphClassDef [A B T a b c e f i n o ae], [f_i f_f_i], [acutecomb gravecomb cedillacomb], ;
    LigatureCaretByPos f_i 250;
    LigatureCaretByPos f_f_i 200 400;
} GDEF;

@ABOVE = [acutecomb gravecomb];

feature liga {
    lookupflag IgnoreMarks;
    sub f f i by f_f_i;
    sub f i by f_i;
} liga;

feature rlig {
    lookupflag UseMarkFilteringSet @ABOVE;
    sub B by b.sc;
} rlig;

feature salt {
    sub a from [a.alt1 a.alt2];
} salt;

feature calt {
    ignore sub T a';
    sub [n o] a' lookup SMALL;
    sub c b' by b.sc;
} calt;

feature rclt {
    rsub a' b by a.alt1;
    rsub [c e] f' by f_i;
} rclt;

feature locl {
    script latn;
    language TRK;
    sub i by i.TRK;
} locl;

feature kern {
    pos T o' <0 0 -60 0>;
    pos n o' lookup LIFT;
} kern;

feature cpsp {
    pos A <10 0 20 0>;
} cpsp;
`;

type Setting = {
  readonly text: string;
  readonly script?: string;
  readonly language?: string;
  readonly features?: readonly string[];
};

/** The strings both fonts are set with: each rule, and the rules against each other. */
const STRINGS: readonly Setting[] = [
  { text: "fi" },
  { text: "ffi" },
  { text: "office" },
  { text: "æ" },
  { text: "Ta" },
  { text: "na" },
  { text: "oa" },
  { text: "Toa" },
  { text: "cb" },
  { text: "cbab" },
  { text: "i", script: "Latn", language: "tr" },
  { text: "i", script: "Latn", language: "en" },
  { text: "fi", script: "Latn", language: "tr" },
  { text: "To" },
  { text: "no" },
  { text: "naTo" },
  { text: "AB" },
  { text: "ab" },
  { text: "cf" },
  { text: "ef" },
  { text: "af" },
  { text: "a", features: ["salt=1"] },
  { text: "a", features: ["salt=2"] },
  { text: "Tofi", features: ["-kern"] },
  { text: "á" },
  { text: "ó̀" },
  { text: "á̧" },
  { text: "ná" },
  { text: "f́i" },
  { text: "ǽ" },
  { text: "Tò" },
];

function proofFont(): FontDocument {
  const INFO = { ...DEFAULT_FONT_INFO, familyName: "Feature Proof", unitsPerEm: 1000 };
  return setFeatures(
    fontDocument(
      [
        glyph(".notdef", { advance: 500 }),
        ...GLYPHS.map(([name, code]) =>
          glyph(name, {
            unicodes: code === null ? [] : [code],
            advance: MARKS.has(name) ? 0 : 500,
            contours: [drawn()],
            anchors: (ANCHORS[name] ?? []).map(([anchorName, x, y]) =>
              anchor(ids.anchor(), anchorName, { x, y }),
            ),
          }),
        ),
      ],
      INFO,
    ),
    PROOF_FEATURES,
  );
}

type Placed = { name: string; xAdvance: number; xOffset: number; yOffset: number };

function setting(font: Font, s: Setting): Placed[] {
  const buffer = new Buffer();
  buffer.addText(s.text);
  if (s.script !== undefined) buffer.setScript(s.script);
  if (s.language !== undefined) buffer.setLanguage(s.language);
  buffer.guessSegmentProperties();
  shape(
    font,
    buffer,
    (s.features ?? []).map((f) => Feature.fromString(f)!),
  );
  return buffer.getGlyphInfosAndPositions().map((p) => ({
    name: font.glyphName(p.codepoint),
    xAdvance: p.xAdvance ?? 0,
    xOffset: p.xOffset ?? 0,
    yOffset: p.yOffset ?? 0,
  }));
}

const open = (bytes: ArrayBuffer | Uint8Array) => new Font(new Face(new Blob(bytes)));

describe("the feature proof font", () => {
  const document = proofFont();
  const { bytes, warnings } = exportFont(document);

  it("compiles its whole feature file and its marks without a problem", () => {
    expect(warnings).toEqual([]);
  });

  it("sets every proof string", () => {
    const font = open(bytes);
    for (const s of STRINGS) expect(setting(font, s).length).toBeGreaterThan(0);
  });

  it("attaches the accents by their anchors", () => {
    // The accent's _top at 0,500 meets the letter's top at 250,480, less the
    // letter's own advance of 500 the pen has already moved.
    const [, acute] = setting(open(bytes), { text: "á" });
    expect(acute).toEqual({ name: "acutecomb", xAdvance: 0, xOffset: -250, yOffset: -20 });
  });

  it.runIf(OUT !== "")("is written out for fontTools to compile the same file", () => {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "Features.otf"), new Uint8Array(bytes));
    writeFileSync(
      join(OUT, "features.fea"),
      `${PROOF_FEATURES}\n${writeMarks(orderedGlyphs(document))}`,
    );
  });

  it.runIf(REFERENCE !== "")("sets every string exactly as the font fontTools compiled", () => {
    const ours = open(bytes);
    const theirs = open(new Uint8Array(readFileSync(REFERENCE)));
    for (const s of STRINGS) {
      expect({ ...s, glyphs: setting(ours, s) }).toEqual({ ...s, glyphs: setting(theirs, s) });
    }
  });
});

/**
 * The same fonts opened here as binaries, and exported again.
 *
 * Opening a font reads its GSUB, GPOS and GDEF back into feature source, anchors
 * and kerning. Exported again, the font has to set every proof string as the
 * one that was opened: a rule lost, reordered or misread on the way in is a
 * glyph or a position that differs. Done with the font compiled here, and on CI
 * with the one fontTools compiled, whose tables were written by something else.
 */
describe("a compiled font, opened and exported again", () => {
  const roundTrip = (original: Uint8Array) => {
    const read = importFont(original.slice().buffer, counterIds("rt"));
    const again = exportFont(read.document);
    return { read, again };
  };

  const agrees = (original: Uint8Array) => {
    const { read, again } = roundTrip(original);
    const before = open(original);
    const after = open(again.bytes);
    for (const s of STRINGS) {
      expect({ ...s, glyphs: setting(after, s) }, read.document.features).toEqual({
        ...s,
        glyphs: setting(before, s),
      });
    }
    return { read, again };
  };

  it("sets every string as the font it was opened from", () => {
    const { read, again } = agrees(new Uint8Array(exportFont(proofFont()).bytes));
    expect(read.warnings).toEqual([]);
    expect(again.warnings).toEqual([]);
  });

  it("brings the marks back as anchors, and the rest as source", () => {
    const { read } = roundTrip(new Uint8Array(exportFont(proofFont()).bytes));
    const anchorsOf = (name: string) =>
      read.document.glyphs[name]?.anchors.map((a) => [a.name, a.pt.x, a.pt.y]);
    expect(anchorsOf("a")).toEqual(
      expect.arrayContaining([
        ["top", 250, 480],
        ["bottom", 240, 0],
      ]),
    );
    expect(anchorsOf("acutecomb")).toEqual(
      expect.arrayContaining([
        ["_top", 0, 500],
        ["top", 0, 700],
      ]),
    );
    expect(read.document.features).toMatch(/feature liga \{/);
    expect(read.document.features).not.toMatch(/markClass/);
  });

  it.runIf(REFERENCE !== "")("sets every string as the font fontTools compiled", () => {
    agrees(new Uint8Array(readFileSync(REFERENCE)));
  });
});

/**
 * What a font from elsewhere does that this editor keeps without compiling.
 *
 * Class kerning with an exception, a pair adjustment that is not kerning,
 * cursive attachment, marks on a ligature, a lookup written as an extension, a
 * feature that differs by script, and a stylistic set with a name. fontTools
 * compiles it into the proof font on CI (`IMPORT_OUT` writes the file, and
 * `compile_fea.py --plain` compiles it); opened here, what the editor compiles
 * has to set text as before, and what it does not has to be in the source and
 * named in the warnings.
 */
export const IMPORT_EXTRAS = `languagesystem DFLT dflt;
languagesystem latn dflt;
languagesystem arab dflt;

@KERN_LEFT = [A T];
@KERN_RIGHT = [a o];

feature kern {
    pos T o -80;
    pos @KERN_LEFT @KERN_RIGHT -40;
} kern;

feature dist {
    pos A B <5 0 10 0>;
} dist;

feature curs {
    pos cursive f <anchor 0 0> <anchor 500 100>;
} curs;

markClass acutecomb <anchor 0 500> @LIGATURE_ABOVE;

feature mark {
    pos ligature f_i <anchor 120 600> mark @LIGATURE_ABOVE
        ligComponent <anchor 380 600> mark @LIGATURE_ABOVE;
} mark;

lookup LIGATURES useExtension {
    sub f i by f_i;
} LIGATURES;

feature liga {
    lookup LIGATURES;
} liga;

feature smcp {
    script latn;
    sub a by a.sc;
    script arab;
    sub b by b.sc;
} smcp;

feature ss01 {
    featureNames {
        name "Alternate a";
    };
    sub a by a.alt1;
} ss01;
`;

const EXTRA_STRINGS: readonly Setting[] = [
  { text: "Ta" },
  { text: "To" },
  { text: "Ao" },
  { text: "fi" },
  { text: "ab", script: "Latn", features: ["smcp"] },
  { text: "ab", script: "Arab", features: ["smcp"] },
  { text: "a", features: ["ss01"] },
];

describe("a font that does more than this editor compiles", () => {
  it.runIf(OUT !== "")("is written out for fontTools to compile", () => {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "extras.fea"), IMPORT_EXTRAS);
  });

  it.runIf(IMPORT_REFERENCE !== "")("keeps what it compiles, and says what it does not", () => {
    const original = new Uint8Array(readFileSync(IMPORT_REFERENCE));
    const read = importFont(original.slice().buffer, counterIds("ex"));
    const { features } = read.document;
    const warnings = read.warnings.map((w) => w.message).join("\n");

    // Kerning into the model, groups and the exception both.
    const { kerning } = read.document;
    expect(Object.keys(kerning.firstGroups)).toHaveLength(1);
    expect(kerning.pairs["T"]?.["o"]).toBe(-80);

    // The rest as source, and what is not compiled named.
    expect(features, features).toMatch(/pos cursive f <anchor 0 0> <anchor 500 100>;/);
    expect(features).toMatch(/pos ligature f_i <anchor 120 600> mark @MC_1 ligComponent/);
    expect(features).toMatch(/pos A B <5 0 10 0>/);
    expect(features).toMatch(/script arab;/);
    expect(warnings).toMatch(/cursive attachment/);
    expect(warnings).toMatch(/mark attachment to ligatures/);
    expect(warnings).toMatch(/pair adjustments other than kerning/);
    expect(warnings).toMatch(/names and parameters of ss01/);

    const before = open(original);
    const after = open(exportFont(read.document).bytes);
    for (const s of EXTRA_STRINGS) {
      expect({ ...s, glyphs: setting(after, s) }, features).toEqual({
        ...s,
        glyphs: setting(before, s),
      });
    }
  });
});
