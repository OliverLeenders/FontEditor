import {
  DEFAULT_FONT_INFO,
  type FontDocument,
  counterIds,
  fontDocument,
  glyph,
  rectContour,
} from "@typewright/font-model";
import { Blob, Face, Font } from "harfbuzzjs";
import { describe, expect, it } from "vitest";

import { chainSubtables } from "../src/chain-classes.js";
import { exportFont } from "../src/export.js";
import { compileFeatures } from "../src/features.js";
import type { ChainRule } from "../src/gsub.js";
import { importFont } from "../src/import.js";
import { set } from "./real-fonts.js";

/**
 * Rules in a context, as the fonts that have thousands of them write them.
 *
 * Three things a Nastaliq does that were refused or could not be written: a
 * rule that calls two lookups at one glyph, a lookup that swaps one glyph for
 * one among rules that swap one for several, and more rules than a lookup can
 * hold with a subtable to each. HarfBuzz is asked what each font does, since
 * what is in question is what a shaper makes of the tables.
 */

const ids = counterIds("cr");
const box = () => rectContour(ids, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const EXTRA = ["a.alt", "b.alt", "c.alt", "x.one", "x.two", "dot"];

function document(features: string): FontDocument {
  return {
    ...fontDocument(
      [
        glyph(".notdef", { advance: 500 }),
        ...[...LETTERS].map((l) =>
          glyph(l, { unicodes: [l.charCodeAt(0)], advance: 500, contours: [box()] }),
        ),
        ...EXTRA.map((name) => glyph(name, { advance: 500, contours: [box()] })),
      ],
      { ...DEFAULT_FONT_INFO, unitsPerEm: 1000 },
    ),
    features,
  };
}

function made(features: string) {
  const out = exportFont(document(features), counterIds("o"));
  const font = new Font(new Face(new Blob(out.bytes)));
  return {
    out,
    names: (text: string) =>
      set(font, text)
        .map((g) => g.name)
        .join(" "),
    placed: (text: string) => set(font, text).map((g) => [g.name, g.x, g.y]),
  };
}

describe("a rule that calls two lookups at one glyph", () => {
  const SUB = `
lookup FIRST { sub x by x.one; } FIRST;
lookup SECOND { sub x.one by x.two; } SECOND;
lookup DOTTED { sub b by b dot; } DOTTED;
lookup ALT { sub a by a.alt; } ALT;
feature calt {
    sub a x' lookup FIRST lookup SECOND;
    sub c' lookup ALT x' lookup FIRST;
    sub a' lookup ALT b' lookup DOTTED lookup DOTTED;
} calt;
`;

  it("is read without a word about it", () => {
    expect(made(SUB).out.warnings).toEqual([]);
  });

  it("runs each in turn, on what the one before it left", () => {
    const { names } = made(SUB);
    // The first makes x.one of x, and the second x.two of that.
    expect(names("ax")).toBe("a x.two");
    // Alone, x is nobody's business.
    expect(names("x")).toBe("x");
  });

  it("runs a lookup at each of two glyphs", () => {
    // c is not in ALT, so nothing happens to it; x is swapped by FIRST alone.
    expect(made(SUB).names("cx")).toBe("c x.one");
  });

  it("counts along the run as the lookups before have left it", () => {
    // The dot is added after b, and then the same place is b still: b dot dot.
    expect(made(SUB).names("ab")).toBe("a.alt b dot dot");
  });

  it("does the same for positioning", () => {
    const POS = `
lookup UP { pos b <0 30 0 0>; } UP;
lookup OVER { pos b <20 0 0 0>; } OVER;
feature kern {
    pos a b' lookup UP lookup OVER;
} kern;
`;
    const { out, placed } = made(POS);
    expect(out.warnings).toEqual([]);
    expect(placed("ab")).toEqual([
      ["a", 0, 0],
      ["b", 20, 30],
    ]);
    expect(placed("cb")[1]).toEqual(["b", 0, 0]);
  });

  it("comes back, read in, as the rule it was", () => {
    const first = made(SUB);
    const read = importFont(first.out.bytes, counterIds("back"));
    const again = exportFont(read.document, counterIds("again"));
    expect(again.warnings).toEqual([]);
    const font = new Font(new Face(new Blob(again.bytes)));
    for (const text of ["ax", "cx", "ab", "x", "abax"]) {
      expect(
        set(font, text)
          .map((g) => g.name)
          .join(" "),
        text,
      ).toBe(first.names(text));
    }
  });
});

describe("one glyph for one, among one for several", () => {
  const MIXED = `
lookup MIXED {
    sub a by a.alt;
    sub b by b dot;
    sub c by c.alt;
} MIXED;
feature calt {
    sub [a b c]' lookup MIXED x;
} calt;
feature ccmp {
    sub d by d dot;
    sub e by f;
} ccmp;
`;

  it("is one lookup of sequences, some of them of one glyph", () => {
    const { out, names } = made(MIXED);
    expect(out.warnings).toEqual([]);
    expect(names("ax")).toBe("a.alt x");
    expect(names("bx")).toBe("b dot x");
    expect(names("cx")).toBe("c.alt x");
    expect(names("de")).toBe("d dot f");
  });

  it("is the same whichever kind of rule comes first", () => {
    const { out, names } = made("feature ccmp { sub e by f; sub d by d dot; sub g by h; } ccmp;");
    expect(out.warnings).toEqual([]);
    expect(names("deg")).toBe("d dot f h");
  });
});

describe("many rules, written together", () => {
  // Every letter after every other letter, each pair a rule of its own: 650
  // rules about the same twenty-six sets of one glyph.
  const pairs = [...LETTERS].flatMap((first) =>
    [...LETTERS].filter((second) => second !== first).map((second) => [first, second] as const),
  );
  const rules = (replace: (first: string, second: string) => boolean) =>
    pairs
      .map(([first, second]) =>
        replace(first, second)
          ? `    sub ${first} ${second}' lookup DOT;`
          : `    ignore sub ${first} ${second}';`,
      )
      .join("\n");
  const source = (body: string) =>
    `lookup DOT { sub [${[...LETTERS].join(" ")}] by dot; } DOT;\nfeature calt {\n${body}\n} calt;\n`;

  it("are a handful of subtables, and not one to a rule", () => {
    const order = [".notdef", ...LETTERS, ...EXTRA];
    const compiled = compileFeatures(source(rules(() => true)), (name) => {
      const at = order.indexOf(name);
      return at < 0 ? undefined : at;
    });
    expect(compiled.problems).toEqual([]);
    const contextual = compiled.substitution.lookups.find((l) => l.type === 6)!;
    expect(contextual.subtables.length).toBeLessThan(5);
    // By class: format 2.
    expect(contextual.subtables[0]![1]).toBe(2);
  });

  it("do what each of them says", () => {
    // A letter becomes a dot after a letter that comes before it in the
    // alphabet, and is left alone after one that comes later.
    const { out, names } = made(source(rules((first, second) => first < second)));
    expect(out.warnings).toEqual([]);
    expect(names("ab")).toBe("a dot");
    expect(names("ba")).toBe("b a");
    expect(names("mz")).toBe("m dot");
    expect(names("zm")).toBe("z m");
    expect(names("aa")).toBe("a a");
  });

  it("are tried in the order written, the first that matches being the one", () => {
    // An exception before the rule it is an exception to, and after it.
    const before = made(source("    ignore sub q u';\n    sub [p q r] u' lookup DOT;"));
    expect([before.names("qu"), before.names("pu")]).toEqual(["q u", "p dot"]);
    const after = made(source("    sub [p q r] u' lookup DOT;\n    ignore sub q u';"));
    expect([after.names("qu"), after.names("pu")]).toEqual(["q dot", "p dot"]);
  });

  it("begin a new subtable where a rule does not agree with the ones before", () => {
    // [a b] and [b c] share b and are not the same set: no one sorting of the
    // glyphs into classes holds both.
    const one: ChainRule = { backtrack: [], input: [[1, 2]], lookahead: [[5]], actions: [] };
    const other: ChainRule = { backtrack: [], input: [[2, 3]], lookahead: [[5]], actions: [] };
    const same: ChainRule = { backtrack: [[7]], input: [[1, 2]], lookahead: [], actions: [] };
    expect(chainSubtables([one, same])).toHaveLength(1);
    expect(chainSubtables([one, other])).toHaveLength(2);
    // And the order is kept: the one between is not moved to sit with the first.
    expect(chainSubtables([one, other, same])).toHaveLength(3);
    // A rule alone is written by its lists, as it always was: format 3.
    expect(chainSubtables([one])[0]![1]).toBe(3);
  });

  it("keeps rules that share glyphs across subtables in their order", () => {
    const { names } = made(
      source("    ignore sub [a b] c';\n    sub [b d] c' lookup DOT;\n    sub a c' lookup DOT;"),
    );
    // b c: the exception is first. d c: the second rule. a c: the exception again.
    expect(names("bc")).toBe("b c");
    expect(names("dc")).toBe("d dot");
    expect(names("ac")).toBe("a c");
  });
});
