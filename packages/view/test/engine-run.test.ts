import { fontDocument, glyph } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { type Engine, layoutParagraph, layoutRun } from "../src/run.js";

/**
 * Laying out what a shaping engine set.
 *
 * The engine here is a stand-in that answers with fixed glyphs, so what is
 * tested is this package's half: where each glyph lands, and how a pair's
 * kerning, folded into an advance the way a font file says it, is kept apart as
 * the kern before the next letter.
 */

const font = () =>
  fontDocument([
    glyph("A", { unicodes: [0x41], advance: 600 }),
    glyph("V", { unicodes: [0x56], advance: 600 }),
    glyph("acutecomb", { unicodes: [0x301], advance: 0 }),
    glyph("space", { unicodes: [0x20], advance: 200 }),
  ]);

/** A, kerned 80 closer to V, and an acute placed over the V. */
const kerned: Engine = () => [
  { name: "A", xAdvance: 520, xOffset: 0, yOffset: 0 },
  { name: "V", xAdvance: 600, xOffset: 0, yOffset: 0 },
  { name: "acutecomb", xAdvance: 0, xOffset: -300, yOffset: 120 },
];

describe("a run set by an engine", () => {
  it("lands each glyph where the engine put it", () => {
    const run = layoutRun(font(), "AV́", undefined, undefined, kerned);
    expect(run.glyphs.map((p) => [p.name, p.x])).toEqual([
      ["A", 0],
      ["V", 520],
      ["acutecomb", 1120],
    ]);
    expect(run.width).toBe(1120);
  });

  it("keeps each glyph's own advance, and puts the kerning before the next glyph", () => {
    const run = layoutRun(font(), "AV́", undefined, undefined, kerned);
    expect(run.glyphs[0]?.advance).toBe(600);
    expect(run.glyphs[1]?.kern).toBe(-80);
  });

  it("carries a mark's offset from the engine", () => {
    const run = layoutRun(font(), "AV́", undefined, undefined, kerned);
    expect(run.glyphs[2]).toMatchObject({ dx: -300, dy: 120 });
  });

  it("passes over a glyph the document no longer has, advance and all", () => {
    const gone: Engine = () => [
      { name: "A", xAdvance: 600, xOffset: 0, yOffset: 0 },
      { name: "ghost", xAdvance: 500, xOffset: 0, yOffset: 0 },
      { name: "V", xAdvance: 600, xOffset: 0, yOffset: 0 },
    ];
    const run = layoutRun(font(), "AxV", undefined, undefined, gone);
    expect(run.glyphs.map((p) => [p.name, p.x, p.index])).toEqual([
      ["A", 0, 0],
      ["V", 600, 1],
    ]);
  });

  it("falls back to the shaper, the positioner and the kerning where the engine declines", () => {
    const run = layoutRun(font(), "AV", undefined, undefined, () => null);
    expect(run.glyphs.map((p) => p.name)).toEqual(["A", "V"]);
    expect(run.width).toBe(1200);
  });

  it("is handed the text read, glyph names and all", () => {
    let seen: string[] = [];
    const watching: Engine = (tokens) => {
      seen = tokens.map((t) => t.text);
      return [];
    };
    layoutRun(font(), "A/acutecomb V", undefined, undefined, watching);
    expect(seen).toEqual(["A", "/acutecomb ", "V"]);
  });

  it("sets every line of a paragraph with it", () => {
    const calls: number[] = [];
    const counting: Engine = (tokens) => {
      calls.push(tokens.length);
      return tokens.flatMap((t) =>
        t.kind === "character" && t.text === "A"
          ? [{ name: "A", xAdvance: 600, xOffset: 0, yOffset: 0 }]
          : [],
      );
    };
    const lines = layoutParagraph(font(), "AA AA", 1000, 1200, undefined, undefined, counting);
    expect(lines.map((l) => l.run.glyphs.length)).toEqual([2, 2]);
    expect(calls.length).toBeGreaterThan(0);
  });
});
