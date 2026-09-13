import { counterIds, glyph } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { parseGlif } from "../src/glif.js";
import { glif } from "../src/ufo.js";

/**
 * A glyph's colour mark, in and out of its `.glif`.
 *
 * `public.markColor` lives in the glyph's `lib`, which is otherwise somebody
 * else's data and is kept exactly as it was. So the mark is taken out of the lib
 * on the way in, and put back into the same lib on the way out — never as a
 * second `lib`, which is not a glif.
 */

const ids = counterIds("mk");

function read(text: string) {
  const g = parseGlif(text, ids, () => undefined);
  if (g === null) throw new Error("not a glif");
  return g;
}

const source = (lib: string): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<glyph name="a" format="2">',
    '\t<advance width="500"/>',
    "\t<outline/>",
    lib,
    "</glyph>",
    "",
  ].join("\n");

const lib = (...entries: readonly string[]): string =>
  ["\t<lib>", "\t\t<dict>", ...entries.map((e) => `\t\t\t${e}`), "\t\t</dict>", "\t</lib>"].join(
    "\n",
  );

const MARK = "<key>public.markColor</key><string>1,0,0,1</string>";
const OTHER = "<key>com.example.note</key><string>kept as it was</string>";

describe("reading a colour mark", () => {
  it("reads the mark out of the lib", () => {
    const g = read(source(lib(MARK)));
    expect(g.markColor).toBe("1,0,0,1");
    // A lib that held nothing but the mark is not kept as well.
    expect(g.kept).toEqual([]);
  });

  it("keeps the rest of the lib, without the mark in it", () => {
    const g = read(source(lib(MARK, OTHER)));
    const kept = g.kept.join("");

    expect(g.markColor).toBe("1,0,0,1");
    expect(kept).toContain("com.example.note");
    expect(kept).not.toContain("public.markColor");
  });

  it("reads no mark from a glyph without one", () => {
    expect(read(source(lib(OTHER))).markColor).toBeNull();
  });
});

describe("writing a colour mark", () => {
  it("gives a glyph with no lib one holding the mark", () => {
    const text = glif(glyph("a", { advance: 500, markColor: "0,0,1,1" }));
    expect(read(text).markColor).toBe("0,0,1,1");
  });

  it("writes the mark into the lib the glyph already has", () => {
    const g = { ...read(source(lib(OTHER))), markColor: "0,0,1,1" };
    const text = glif(g);

    expect(text.split("<lib").length - 1).toBe(1);
    const back = read(text);
    expect(back.markColor).toBe("0,0,1,1");
    expect(back.kept.join("")).toContain("com.example.note");
  });

  it("writes nothing for a glyph with no mark", () => {
    expect(glif(glyph("a", { advance: 500 }))).not.toContain("public.markColor");
  });
});
