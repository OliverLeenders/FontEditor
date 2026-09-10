import {
  DEFAULT_FONT_INFO,
  WEIGHT,
  addContour,
  contour,
  fontDocument,
  glyph,
  node,
} from "@typewright/font-model";
import { vec } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { exportInstances, instanceFonts } from "../src/instances.js";
import { unzip } from "../src/unzip.js";

/**
 * The styles of a family, each as an ordinary static font.
 *
 * The other answer to the question a variable font answers. One file that is
 * every style is right nearly everywhere; a folder of static fonts is what a
 * printer wants and what most places that take an upload still ask for.
 */

let ids = 0;
const id = () => `i${String(++ids)}`;

/** A stem of a given width, so the two masters interpolate. */
const stem = (width: number, nodes = 4) => {
  const points = [
    node(id(), vec(0, 0)),
    node(id(), vec(width, 0)),
    node(id(), vec(width, 700)),
    node(id(), vec(0, 700)),
  ];
  return addContour(
    glyph("n", { advance: 500 + width, unicodes: [0x6e] }),
    contour(id(), points.slice(0, nodes), true),
  );
};

const master = (width: number, nodes = 4) =>
  fontDocument([glyph(".notdef", { advance: 500 }), stem(width, nodes)], {
    ...DEFAULT_FONT_INFO,
    familyName: "Chalk",
    styleName: "Regular",
  });

const family = (nodes = 4) => [
  { location: { wght: 400 }, document: master(60) },
  { location: { wght: 900 }, document: master(200, nodes) },
];

describe("writing every style out", () => {
  it("makes one font per style, named for it", () => {
    const fonts = instanceFonts([WEIGHT], family(), [
      { name: "Light", location: { wght: 300 }, familyName: "" },
      { name: "Semibold", location: { wght: 600 }, familyName: "" },
    ]);

    expect(fonts.map((f) => f.name)).toEqual(["Light", "Semibold"]);
    expect(fonts.map((f) => f.fileName)).toEqual(["Chalk-Light.otf", "Chalk-Semibold.otf"]);
    for (const f of fonts) expect(f.bytes.byteLength).toBeGreaterThan(0);
  });

  it("gives each its own family where the style says so", () => {
    // A family that sells its Condensed separately is a different family name
    // on the same drawing, and the file has to say which.
    const [only] = instanceFonts([WEIGHT], family(), [
      { name: "Bold", location: { wght: 700 }, familyName: "Chalk Text" },
    ]);

    expect(only?.fileName).toBe("ChalkText-Bold.otf");
  });

  it("says which glyphs it had to leave out", () => {
    // The masters disagree about `n` — one has four points and the other three
    // — so it cannot be worked out, and a font quietly missing an `n` would be
    // worse than one that says so.
    const [only] = instanceFonts([WEIGHT], family(3), [
      { name: "Semibold", location: { wght: 600 }, familyName: "" },
    ]);

    expect(only?.warnings.join(" ")).toMatch(/left out 1 glyph\(s\).*\bn\b/);
  });

  it("zips them under the family's name", async () => {
    const out = exportInstances([WEIGHT], family(), [
      { name: "Light", location: { wght: 300 }, familyName: "" },
      { name: "Bold", location: { wght: 700 }, familyName: "" },
    ]);

    expect(out.fileName).toBe("Chalk-instances.zip");
    expect(out.files).toBe(2);

    const files = await unzip(out.bytes.slice().buffer);
    if (!Array.isArray(files)) throw new Error(files.reason);
    expect(files.map((f) => f.path).sort()).toEqual(["Chalk-Bold.otf", "Chalk-Light.otf"]);
  });

  it("writes nothing for a family that has named no styles", () => {
    const out = exportInstances([WEIGHT], family(), []);
    expect(out.files).toBe(0);
  });
});
