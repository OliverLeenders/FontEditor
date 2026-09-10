import { describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { preflight } = await import("@typewright/preflight");
const { starterFont } = await import("../src/sample.js");

/**
 * The font the editor opens with, run through the checks.
 *
 * Worth a test of its own: it is the first font every person sees, it is what
 * the checks are demonstrated on, and a warning sitting in it from the day it
 * was written would teach everybody that the report is noise.
 */
describe("the starter font", () => {
  it("has nothing wrong with it that the checks can find", () => {
    const found = preflight(starterFont());
    expect(found.map((f) => `${String(f.glyph)}: ${f.message}`)).toEqual([]);
  });
});
