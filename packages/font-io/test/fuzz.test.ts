import { counterIds } from "@typewright/font-model";
import { madeArchive } from "@typewright/stuffit/testing";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import {
  CHECK,
  RUNS,
  answersOrSaysWhy,
  anyBytes,
  saysWhy,
  spoiled,
} from "../../stuffit/test/fuzz-rule.js";
import { parseDesignspace } from "../src/designspace.js";
import { exportFont } from "../src/export.js";
import { readFamily } from "../src/family.js";
import { parseFea } from "../src/fea.js";
import { importFont } from "../src/import.js";
import { importMacFont } from "../src/mac-font.js";
import { parseSvg } from "../src/svg.js";
import { exportTrueType } from "../src/truetype.js";
import { readUfo } from "../src/ufo-import.js";
import type { ZipFile } from "../src/unzip.js";
import { fromWoff, toWoff } from "../src/woff.js";
import { suitcaseFork } from "./mac-fixtures.js";
import { filesUnder } from "./real-fonts.js";

/**
 * Every reader of a file somebody hands the editor, handed anything at all.
 *
 * Seven of them: binary fonts, UFO, designspace, feature source, SVG, and the
 * StuffIt archives and resource forks old Macintosh fonts come in — those two
 * in `@typewright/stuffit`, and here as a font file. The rule for each is in
 * `fuzz-rule.ts`: an answer, or an error that says why, within a time limit,
 * and never a reader falling over its own feet. Each is tried with good files
 * spoiled a little, which is what gets a reader far enough in to go wrong,
 * and with bytes or text at random.
 */

const ids = counterIds("fuzz");
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s);

const UFO = "MutatorSansLightCondensed.ufo";
const family = filesUnder("mutator-sans");
const ufo = filesUnder("mutator-sans", UFO).map((f) => ({ ...f, path: `${UFO}/${f.path}` }));

/** One file of a set spoiled, the rest as they were. */
function oneSpoiled(files: readonly ZipFile[]): fc.Arbitrary<ZipFile[]> {
  return fc
    .nat({ max: files.length - 1 })
    .chain((which) =>
      spoiled([files[which]!.bytes]).map((bytes) =>
        files.map((f, i) => (i === which ? { ...f, bytes } : f)),
      ),
    );
}

describe("a binary font, whatever is in it", () => {
  let fonts: Uint8Array[] = [];
  let woffs: Uint8Array[] = [];
  beforeAll(async () => {
    const read = readUfo(ufo, ids);
    if ("reason" in read) throw new Error(read.reason);
    fonts = [
      new Uint8Array(exportFont(read.document).bytes),
      new Uint8Array(exportTrueType(read.document).bytes),
    ];
    woffs = await Promise.all(fonts.map((font) => toWoff(font)));
  });

  const open = (bytes: Uint8Array): unknown =>
    importFont(bytes.slice().buffer, counterIds("fuzz-font"));

  it("is read, or said why not, given a good font spoiled", () => {
    fc.assert(
      fc.property(spoiled(fonts), (bytes) => answersOrSaysWhy(() => open(bytes))),
      CHECK,
    );
  });

  it("is read, or said why not, given bytes at random", () => {
    fc.assert(
      fc.property(anyBytes, (bytes) => answersOrSaysWhy(() => open(bytes))),
      CHECK,
    );
  });

  it("is unwrapped from WOFF, or said why not, given a good one spoiled", async () => {
    await fc.assert(
      fc.asyncProperty(spoiled(woffs), async (bytes) => {
        const began = performance.now();
        let unwrapped: Uint8Array | null = null;
        try {
          unwrapped = await fromWoff(bytes);
        } catch (error) {
          saysWhy(error);
        }
        expect(performance.now() - began, "how long it took, in milliseconds").toBeLessThan(2000);
        const font = unwrapped;
        if (font !== null) answersOrSaysWhy(() => open(font));
      }),
      CHECK,
    );
  });
});

describe("a UFO, whatever is in it", () => {
  it("is read, or said why not, with one of its files spoiled", () => {
    fc.assert(
      fc.property(oneSpoiled(ufo), (files) => answersOrSaysWhy(() => readUfo(files, ids))),
      { ...CHECK, numRuns: Math.max(10, Math.round(RUNS / 3)) },
    );
  });
});

describe("a designspace, whatever is in it", () => {
  const designspace = family.find((f) => f.path.endsWith(".designspace"))!;

  it("is read, or said why not, given a good one spoiled", () => {
    fc.assert(
      fc.property(spoiled([designspace.bytes]), (bytes) =>
        answersOrSaysWhy(() => parseDesignspace(text(bytes))),
      ),
      CHECK,
    );
  });

  it("is read with its family, or said why not, with one file of it spoiled", () => {
    // Four masters read each time: fewer of these.
    fc.assert(
      fc.property(oneSpoiled(family), (files) => answersOrSaysWhy(() => readFamily(files, ids))),
      { ...CHECK, numRuns: Math.max(5, Math.round(RUNS / 30)) },
    );
  });
});

describe("feature source, whatever is in it", () => {
  const sources = [
    "languagesystem DFLT dflt;\nlanguagesystem latn dflt;\n\n@vowels = [a e i o u];\n\nfeature liga {\n  sub f i by f_i;\n  sub f l by f_l;\n} liga;\n",
    "feature kern {\n  pos A V -80;\n  pos @vowels T <0 0 -20 0>;\n  enum pos T [a e] -40;\n} kern;\n\nlookup SMCP {\n  sub [a-z] by [a.sc-z.sc];\n} SMCP;\n\nfeature smcp { lookup SMCP; } smcp;\n",
    "markClass [acutecomb gravecomb] <anchor 250 500> @TOP;\nfeature mark {\n  pos base [a e] <anchor 250 450> mark @TOP;\n} mark;\nfeature calt {\n  sub a' lookup SMCP b;\n  ignore sub a a';\n} calt;\n",
  ].map(bytesOf);

  it("is read, or said why not, given good source spoiled", () => {
    fc.assert(
      fc.property(spoiled(sources), (bytes) => answersOrSaysWhy(() => parseFea(text(bytes)))),
      CHECK,
    );
  });

  it("is read, or said why not, given text at random", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (s) => answersOrSaysWhy(() => parseFea(s))),
      CHECK,
    );
  });
});

describe("an SVG, whatever is in it", () => {
  const drawings = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 12h18M12 3v18" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><g transform="translate(10 10) scale(2) rotate(15)"><rect x="5" y="5" width="20" height="10" rx="3"/><polygon points="0,0 10,0 5,8"/><ellipse cx="20" cy="30" rx="8" ry="4"/></g><path d="M10 80 Q 50 10 90 80 T 170 80 A 20 20 0 1 1 10 80z" fill-rule="evenodd"/></svg>',
  ].map(bytesOf);

  it("is read, or said why not, given a good drawing spoiled", () => {
    fc.assert(
      fc.property(spoiled(drawings), (bytes) => answersOrSaysWhy(() => parseSvg(text(bytes)))),
      CHECK,
    );
  });

  it("is read, or said why not, given text at random", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (s) => answersOrSaysWhy(() => parseSvg(s))),
      CHECK,
    );
  });
});

describe("a Macintosh font file, whatever is in it", () => {
  const suitcase = madeArchive([
    { name: "Pixelface", type: "FFIL", creator: "DMOV", resource: suitcaseFork() },
  ]);

  it("is read, or said why not, given a good suitcase spoiled", () => {
    fc.assert(
      fc.property(spoiled([suitcase]), (bytes) =>
        answersOrSaysWhy(() => importMacFont(bytes, counterIds("fuzz-mac"))),
      ),
      CHECK,
    );
  });
});
