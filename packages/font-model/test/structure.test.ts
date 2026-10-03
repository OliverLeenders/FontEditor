import { describe, expect, it } from "vitest";

import { contour } from "../src/contour.js";
import {
  DEFAULT_FONT_INFO,
  type FontDocument,
  fontDocument,
  putGlyph,
  removeGlyph,
  renameGlyph,
  setFeatures,
  setGlyphOrder,
  setKerning,
} from "../src/document.js";
import { glyph } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { EMPTY_KERNING, groupKey, renameKernGroup, setKern, setKernGroup } from "../src/kerning.js";
import { node } from "../src/node.js";
import { scaledFont } from "../src/scale.js";
import {
  applyStructure,
  sameStructure,
  structuralChange,
  structuralDifferences,
  structureCopy,
} from "../src/structure.js";

/**
 * What the masters of a family share, carried from one to the others.
 *
 * Two things are asked throughout. That a change in one master becomes the same
 * change in another — a rename a rename and not a glyph lost and another
 * gained, since the other master's drawing is the thing at stake — and that it
 * touches nothing that is the other master's own: its outlines, its advances,
 * how much it kerns a pair by, what it is called.
 */

const ids = counterIds("st");

/** A glyph with a drawing of its own, so that it can be told from another. */
const drawn = (name: string, advance: number, unicodes: number[] = []) =>
  glyph(name, {
    advance,
    unicodes,
    contours: [
      contour(
        ids.contour(),
        [node(ids.node(), { x: 0, y: 0 }), node(ids.node(), { x: advance, y: 700 })],
        true,
      ),
    ],
  });

/** The regular, and a bold made from it: the same glyphs, wider. */
function family(): { regular: FontDocument; bold: FontDocument } {
  const regular = fontDocument(
    [glyph(".notdef", { advance: 500 }), drawn("a", 500, [0x61]), drawn("b", 520, [0x62])],
    { ...DEFAULT_FONT_INFO, familyName: "Pair", styleName: "Regular" },
  );
  let bold: FontDocument = {
    ...regular,
    info: { ...regular.info, styleName: "Bold", openTypeOS2WeightClass: 700 },
  };
  for (const name of ["a", "b"]) {
    const g = bold.glyphs[name]!;
    bold = putGlyph(bold, { ...g, advance: g.advance + 80 });
  }
  return { regular, bold };
}

/** A change made in the regular, carried to the bold. */
function carried(edit: (regular: FontDocument) => FontDocument): {
  bold: FontDocument;
  was: FontDocument;
} {
  const { regular, bold } = family();
  const change = structuralChange(regular, edit(regular));
  return { bold: change === null ? bold : applyStructure(bold, change), was: bold };
}

describe("a change to what the masters share", () => {
  it("is nothing where only the drawing moved", () => {
    const { regular } = family();
    const a = regular.glyphs["a"]!;
    const moved = putGlyph(regular, { ...a, advance: 999 });

    expect(structuralChange(regular, moved)).toBeNull();
    expect(structuralChange(regular, regular)).toBeNull();
  });

  it("carries a glyph renamed as a rename, so the other master keeps its own drawing of it", () => {
    const { bold, was } = carried((regular) => renameGlyph(regular, "a", "a.alt")!);

    expect(bold.glyphOrder).toEqual([".notdef", "a.alt", "b"]);
    // The bold's own: its width, and the contours it had under the old name.
    expect(bold.glyphs["a.alt"]!.advance).toBe(580);
    expect(bold.glyphs["a.alt"]!.contours).toBe(was.glyphs["a"]!.contours);
    expect(bold.glyphs["a"]).toBeUndefined();
  });

  it("still knows a rename where the glyph was redrawn as well", () => {
    const { bold } = carried((regular) => {
      const renamed = renameGlyph(regular, "a", "a.alt")!;
      const g = renamed.glyphs["a.alt"]!;
      // The same contour, by its id, with a point moved.
      const redrawn = { ...g.contours[0]!, nodes: [...g.contours[0]!.nodes].reverse() };
      return putGlyph(renamed, { ...g, contours: [redrawn] });
    });

    expect(bold.glyphs["a.alt"]!.advance).toBe(580);
    expect(bold.glyphs["a"]).toBeUndefined();
  });

  it("removes a glyph that was removed", () => {
    const { bold } = carried((regular) => removeGlyph(regular, "b")!);
    expect(bold.glyphOrder).toEqual([".notdef", "a"]);
  });

  it("adds a glyph that was added, as a copy of the drawing it was made with", () => {
    const fresh = drawn("c", 480, [0x63]);
    const { bold } = carried((regular) => putGlyph(regular, fresh));

    expect(bold.glyphOrder).toEqual([".notdef", "a", "b", "c"]);
    // The same points in the same order: compatible the day it arrives.
    expect(bold.glyphs["c"]).toBe(fresh);
  });

  it("carries code points, the order, the features and the family's own information", () => {
    const { bold } = carried((regular) => {
      let next = putGlyph(regular, { ...regular.glyphs["a"]!, unicodes: [0x61, 0x41] });
      next = setGlyphOrder(next, [".notdef", "b", "a"]);
      next = setFeatures(next, "feature liga { sub a b by b; } liga;");
      return { ...next, info: { ...next.info, familyName: "Couple", ascender: 800 } };
    });

    expect(bold.glyphs["a"]!.unicodes).toEqual([0x61, 0x41]);
    expect(bold.glyphOrder).toEqual([".notdef", "b", "a"]);
    expect(bold.features).toBe("feature liga { sub a b by b; } liga;");
    expect(bold.info.familyName).toBe("Couple");
    expect(bold.info.ascender).toBe(800);
  });

  it("leaves a master what is its own: its style, its weight, its widths", () => {
    const { bold } = carried((regular) => ({
      ...regular,
      info: {
        ...regular.info,
        styleName: "Book",
        openTypeOS2WeightClass: 350,
        familyName: "Couple",
      },
    }));

    expect(bold.info.styleName).toBe("Bold");
    expect(bold.info.openTypeOS2WeightClass).toBe(700);
    expect(bold.glyphs["a"]!.advance).toBe(580);
  });

  it("scales the other master when the em was changed and the drawing went with it", () => {
    const { bold } = carried((regular) => scaledFont(regular, 2000));

    expect(bold.info.unitsPerEm).toBe(2000);
    expect(bold.glyphs["a"]!.advance).toBe(1160);
  });

  it("only writes the em down where the drawing was left as it was", () => {
    const { bold } = carried((regular) => ({
      ...regular,
      info: { ...regular.info, unitsPerEm: 2000 },
    }));

    expect(bold.info.unitsPerEm).toBe(2000);
    expect(bold.glyphs["a"]!.advance).toBe(580);
  });

  it("is safe to make twice, and to a master that does not need it", () => {
    const { regular, bold } = family();
    const edited = putGlyph(renameGlyph(regular, "a", "a.alt")!, drawn("c", 480));
    const change = structuralChange(regular, edited)!;

    const once = applyStructure(bold, change);
    expect(applyStructure(once, change)).toBe(once);
  });

  it("is nothing once it has been taken back", () => {
    const { regular } = family();
    const renamed = renameGlyph(regular, "a", "a.alt")!;
    const back = renameGlyph(renamed, "a.alt", "a")!;

    expect(structuralChange(regular, back)).toBeNull();
  });
});

describe("kerning groups, carried", () => {
  const grouped = (document: FontDocument, value: number): FontDocument => {
    let k = setKernGroup(EMPTY_KERNING, "first", "round", ["a", "b"]);
    k = setKern(k, groupKey("round"), "a", value);
    k = setKern(k, "a", "b", value / 2);
    return setKerning(document, k);
  };

  it("keeps each master's own values, under a group that was renamed", () => {
    const { regular, bold } = family();
    const before = grouped(regular, -40);
    const after = setKerning(before, renameKernGroup(before.kerning, "first", "round", "bowl"));

    const next = applyStructure(grouped(bold, -60), structuralChange(before, after)!);

    expect(Object.keys(next.kerning.firstGroups)).toEqual(["bowl"]);
    expect(next.kerning.pairs[groupKey("bowl")]).toEqual({ a: -60 });
    expect(next.kerning.pairs["a"]).toEqual({ b: -30 });
  });

  it("lets go of the pairs kerned against a group that has gone, and no others", () => {
    const { regular, bold } = family();
    const before = grouped(regular, -40);
    const after = setKerning(before, { ...before.kerning, firstGroups: {} });

    const next = applyStructure(grouped(bold, -60), structuralChange(before, after)!);

    expect(next.kerning.firstGroups).toEqual({});
    expect(next.kerning.pairs).toEqual({ a: { b: -30 } });
  });
});

describe("a master drawn as a layer of another", () => {
  it("follows a name and a removal, and is given nothing it does not draw", () => {
    const { regular } = family();
    const layer = fontDocument([regular.glyphs["a"]!], regular.info);
    const edited = setFeatures(
      putGlyph(renameGlyph(regular, "a", "a.alt")!, drawn("c", 480)),
      "# features",
    );

    const next = applyStructure(layer, structuralChange(regular, edited)!, true);

    expect(next.glyphOrder).toEqual(["a.alt"]);
    expect(next.features).toBe("");
  });
});

describe("masters that already differ", () => {
  it("does not take a master read back from where it was parked for a different one", () => {
    const { regular, bold } = family();
    // What storage does to a document: everything in it, in other objects.
    const parked: FontDocument = {
      ...bold,
      info: JSON.parse(JSON.stringify(bold.info)) as FontDocument["info"],
      kerning: JSON.parse(JSON.stringify(bold.kerning)) as FontDocument["kerning"],
    };

    expect(sameStructure(structuralDifferences(regular, parked))).toBe(true);
  });

  it("says how, a part at a time", () => {
    const { regular, bold } = family();
    const other = setFeatures(
      putGlyph(removeGlyph(bold, "b")!, { ...drawn("z", 400), unicodes: [0x7a] }),
      "# the bold's own",
    );

    const differences = structuralDifferences(regular, other);
    expect(differences.onlyHere).toEqual(["b"]);
    expect(differences.onlyThere).toEqual(["z"]);
    expect(differences.features).toBe(true);
    expect(differences.order).toBe(false);
    // Its style and its weight are its own, and are not differences.
    expect(differences.info).toEqual([]);
    expect(sameStructure(differences)).toBe(false);
    expect(sameStructure(structuralDifferences(regular, bold))).toBe(true);
  });

  it("copies one part across and leaves the rest as it was", () => {
    const { regular, bold } = family();
    const other = setFeatures(removeGlyph(bold, "b")!, "# the bold's own");

    const withGlyph = applyStructure(other, structureCopy(regular, other, "onlyHere"));
    expect(withGlyph.glyphOrder).toEqual([".notdef", "a", "b"]);
    expect(withGlyph.features).toBe("# the bold's own");

    const withFeatures = applyStructure(other, structureCopy(regular, other, "features"));
    expect(withFeatures.features).toBe("");
    expect(withFeatures.glyphOrder).toEqual([".notdef", "a"]);
  });
});
