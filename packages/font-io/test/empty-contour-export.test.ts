import { readFileSync } from "node:fs";

import { type FontDocument, counterIds, isEmptyContour } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { exportFont } from "../src/export.js";
import { importFont } from "../src/import.js";

/**
 * A contour that draws nothing, beside ones that do.
 *
 * A static cut of a variable icon font keeps the shapes one of its axes closes
 * up: a line there and back, a contour all at one place. Each lies along the
 * edge of something that does draw. The union the exporter makes took one for a
 * shape set flush against its neighbour, and let go of ink beside it: sixty of
 * Material Symbols' four thousand icons came out with part of them gone.
 *
 * On the icons themselves, since it took the real ones to find it. The font is
 * the one the browser tests bring in; its licence is beside it.
 */

const FONT = new URL(
  "../../../apps/editor/browser/fixtures/MaterialSymbolsOutlined_28pt-Regular.ttf",
  import.meta.url,
);

function some(names: readonly string[]): FontDocument {
  const bytes = readFileSync(FONT);
  const whole = importFont(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    counterIds("icons"),
  ).document;
  const order = [".notdef", ...names].filter((name) => whole.glyphs[name] !== undefined);
  return {
    ...whole,
    glyphOrder: order,
    glyphs: Object.fromEntries(order.map((name) => [name, whole.glyphs[name]!])),
    features: "",
  };
}

/** Each contour's box, as a line, in an order that does not depend on theirs. */
function boxes(document: FontDocument, name: string): string[] {
  return document.glyphs[name]!.contours.map((c) => {
    const xs = c.nodes.map((n) => Math.round(n.pt.x));
    const ys = c.nodes.map((n) => Math.round(n.pt.y));
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].join(",");
  }).sort();
}

describe("a glyph with a contour that draws nothing", () => {
  it("is exported with all the ink it has", () => {
    const document = some(["robot"]);
    // What this is about is there: a contour of the robot that draws nothing.
    expect(document.glyphs["robot"]!.contours.some(isEmptyContour)).toBe(true);

    const out = exportFont(document);
    const back = importFont(out.bytes, counterIds("back")).document;

    // Its head, the counter in it, both eyes, and the two notches of its mouth.
    expect(boxes(back, "robot")).toEqual(
      [
        "120,120,840,840",
        "197,197,763,763",
        "282,482,438,638",
        "522,482,678,638",
        "358,197,442,282",
        "518,197,602,282",
      ].sort(),
    );
  });
});
