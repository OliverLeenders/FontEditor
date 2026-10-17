import { counterIds } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { glyphCountsClaimed } from "../src/glyph-count.js";
import { importFont } from "../src/import.js";
import { readTablesOf } from "../src/sfnt.js";
import { exportTrueType } from "../src/truetype.js";
import { readUfo } from "../src/ufo-import.js";
import { filesUnder } from "./real-fonts.js";

/**
 * A font file whose count of glyphs is damaged, refused before it is parsed.
 *
 * Found by the fuzz tests: a font of five thousand bytes with one byte of its
 * CFF top dictionary changed took two minutes and more to open, the parser
 * building twenty thousand glyphs out of whatever followed.
 */

const UFO = "MutatorSansLightCondensed.ufo";
const read = readUfo(
  filesUnder("mutator-sans", UFO).map((f) => ({ ...f, path: `${UFO}/${f.path}` })),
  counterIds("count"),
);
if ("reason" in read) throw new Error(read.reason);
const document = read.document;
const otf = new Uint8Array(exportFont(document).bytes);
const ttf = new Uint8Array(exportTrueType(document).bytes);

/** Where a table starts in the file, by its tag. */
function tableAt(font: Uint8Array, tag: string): number {
  const table = readTablesOf(font).find((t) => t.tag === tag);
  if (table === undefined) throw new Error(`no ${tag}`);
  return table.data.byteOffset - font.byteOffset;
}

const open = (bytes: Uint8Array): unknown => importFont(bytes.slice().buffer, counterIds("open"));

describe("how many glyphs a font file says it has", () => {
  it("is the same everywhere it is said, in a sound font", () => {
    const glyphs = open(otf) as { document: { glyphOrder: readonly string[] } };
    const count = glyphs.document.glyphOrder.length;
    expect(glyphCountsClaimed(otf)).toEqual([count, count]);
    expect(glyphCountsClaimed(ttf)).toEqual([count]);
  });

  it("is refused at once where maxp claims more than the file could hold", () => {
    const damaged = ttf.slice();
    const maxp = tableAt(damaged, "maxp");
    damaged[maxp + 4] = 0xff;
    damaged[maxp + 5] = 0xff;
    const began = performance.now();
    expect(() => open(damaged)).toThrow(/says it has 65535 glyphs, more than a file of/);
    expect(performance.now() - began).toBeLessThan(500);
  });

  it("is refused at once where the CFF top dictionary is damaged into pointing elsewhere", () => {
    // The charset's operator turned into a number, so the CharStrings operator
    // is given that offset too, and the first of them — which a parser may
    // take — points into the middle of something else.
    const damaged = otf.slice();
    const cff = tableAt(damaged, "CFF ");
    let at = cff + 4;
    // Past the header and the name index, to the top dictionary's operators.
    while (at < cff + 200 && damaged[at] !== 15) at++;
    expect(damaged[at]).toBe(15);
    damaged[at] = 32;
    const began = performance.now();
    expect(() => open(damaged)).toThrow(/more than a file of \d+ bytes can hold/);
    expect(performance.now() - began).toBeLessThan(500);
  });

  it("is refused at once where that damage leaves every count small", () => {
    // The same byte turned into a number that points nowhere much: no count
    // is too large, but the outlines' place is given as three numbers, and a
    // parser that goes by one of them spent a minute on it.
    const damaged = otf.slice();
    const cff = tableAt(damaged, "CFF ");
    let at = cff + 4;
    while (at < cff + 200 && damaged[at] !== 15) at++;
    damaged[at] = 206;
    const began = performance.now();
    expect(() => open(damaged)).toThrow(
      /CFF table is damaged: where its outlines are, is given as 3 numbers/,
    );
    expect(performance.now() - began).toBeLessThan(500);
  });
});
