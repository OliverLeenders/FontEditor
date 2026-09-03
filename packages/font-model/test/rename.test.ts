import { describe, expect, it } from "vitest";

import { component } from "../src/component.js";
import { contour } from "../src/contour.js";
import {
  deleteProblem,
  fontDocument,
  removeGlyph,
  renameGlyph,
  renameProblem,
  setKerning,
} from "../src/document.js";
import { glyph } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import {
  EMPTY_KERNING,
  groupKey,
  kernIndex,
  kernValue,
  setKern,
  setKernGroup,
} from "../src/kerning.js";
import { node } from "../src/node.js";

const ids = counterIds();
const at = (x: number, y: number) => ({ x, y });

/** An `a`, an `acute`, an `aacute` built from both, and kerning that names them. */
function font() {
  const shape = contour(ids.contour(), [node(ids.node(), at(0, 0)), node(ids.node(), at(100, 300))], true);

  const document = fontDocument([
    glyph("a", { unicodes: [0x61], advance: 500, contours: [shape] }),
    glyph("acute", { advance: 0, contours: [shape] }),
    glyph("aacute", {
      unicodes: [0xe1],
      advance: 500,
      components: [
        component(ids.component(), "a"),
        component(ids.component(), "acute", { ...component(ids.component(), "x").transform, xOffset: 120, yOffset: 40 }),
      ],
    }),
    glyph("v", { unicodes: [0x76], advance: 480 }),
  ]);

  let k = setKernGroup(EMPTY_KERNING, "first", "round", ["a", "o"]);
  k = setKernGroup(k, "second", "diagonal", ["v", "w"]);
  k = setKern(k, groupKey("round"), groupKey("diagonal"), -30);
  k = setKern(k, "a", "v", -75);
  k = setKern(k, "v", "a", -20);
  return setKerning(document, k);
}

describe("renaming a glyph", () => {
  it("moves it in the map and keeps its place in the order", () => {
    const d = renameGlyph(font(), "a", "alpha")!;

    expect(d.glyphs["alpha"]?.name).toBe("alpha");
    expect(d.glyphs["a"]).toBeUndefined();
    // The order is the font's own; a rename is not a reordering.
    expect(d.glyphOrder).toEqual(["alpha", "acute", "aacute", "v"]);
  });

  it("keeps the outline and the metrics it had", () => {
    const d = renameGlyph(font(), "a", "alpha")!;
    expect(d.glyphs["alpha"]?.advance).toBe(500);
    expect(d.glyphs["alpha"]?.unicodes).toEqual([0x61]);
    expect(d.glyphs["alpha"]?.contours).toHaveLength(1);
  });

  it("repoints every component that placed it", () => {
    // The reference that breaks most visibly: a composite whose base no longer
    // exists draws nothing at all.
    const d = renameGlyph(font(), "a", "alpha")!;
    expect(d.glyphs["aacute"]?.components.map((c) => c.base)).toEqual(["alpha", "acute"]);
  });

  it("leaves a component that placed something else alone", () => {
    const d = renameGlyph(font(), "a", "alpha")!;
    const before = font();
    expect(d.glyphs["aacute"]?.components[1]?.base).toBe("acute");
    expect(d.glyphs["aacute"]?.components[1]?.transform).toEqual(
      before.glyphs["aacute"]?.components[1]?.transform,
    );
  });

  it("renames it inside any kerning group it belongs to", () => {
    // The reference that breaks silently: the group would still exist and the
    // rule would still apply, just no longer to this glyph.
    const d = renameGlyph(font(), "a", "alpha")!;
    expect(d.kerning.firstGroups["round"]).toEqual(["alpha", "o"]);
  });

  it("keeps a class rule reaching the glyph afterwards", () => {
    const d = renameGlyph(font(), "a", "alpha")!;
    expect(kernValue(kernIndex(d.kerning), "alpha", "v")).toBe(-75);
  });

  it("renames it on both sides of a pair", () => {
    const d = renameGlyph(font(), "a", "alpha")!;
    const index = kernIndex(d.kerning);

    expect(kernValue(index, "alpha", "v")).toBe(-75);
    expect(kernValue(index, "v", "alpha")).toBe(-20);
    expect(kernValue(index, "v", "a")).toBe(0);
  });

  it("leaves a group whose name merely looks like the glyph alone", () => {
    // A group called "a" containing a glyph called "a" is a coincidence, not a
    // link: renaming the glyph must not rename the group.
    let k = setKernGroup(EMPTY_KERNING, "first", "a", ["a"]);
    k = setKern(k, groupKey("a"), "v", -10);
    const d = renameGlyph(setKerning(font(), k), "a", "alpha")!;

    expect(Object.keys(d.kerning.firstGroups)).toContain("a");
    expect(d.kerning.firstGroups["a"]).toEqual(["alpha"]);
  });

  it("does nothing at all when the name is unchanged", () => {
    const before = font();
    expect(renameGlyph(before, "a", "a")).toBe(before);
  });

  it("refuses a name another glyph already has", () => {
    expect(renameGlyph(font(), "a", "v")).toBeNull();
    expect(renameProblem(font(), "a", "v")).toBe("taken");
  });

  it("refuses an empty name", () => {
    expect(renameGlyph(font(), "a", "   ")).toBeNull();
    expect(renameProblem(font(), "a", "")).toBe("empty");
  });

  it("refuses to rename a glyph that is not there", () => {
    expect(renameGlyph(font(), "nope", "x")).toBeNull();
    expect(renameProblem(font(), "nope", "x")).toBe("missing");
  });

  it("leaves the glyphs it did not touch as the very same objects", () => {
    // Reference equality is how autosave decides what to write, so a rename must
    // not make every glyph in the font look changed.
    const before = font();
    const after = renameGlyph(before, "a", "alpha")!;

    expect(after.glyphs["v"]).toBe(before.glyphs["v"]);
    expect(after.glyphs["acute"]).toBe(before.glyphs["acute"]);
    // The composite really did change, so it is a new object.
    expect(after.glyphs["aacute"]).not.toBe(before.glyphs["aacute"]);
  });

  it("merges rather than drops when a name is freed and reused", () => {
    // Renaming "a" to "v" is refused, but the same collision can be reached
    // through a chain, and the pairs have to survive it.
    let d = renameGlyph(font(), "v", "vee")!;
    d = renameGlyph(d, "a", "v")!;
    expect(kernValue(kernIndex(d.kerning), "v", "vee")).toBe(-75);
  });
});

describe("the one name that is not ours to change", () => {
  it("refuses to rename .notdef", () => {
    // The OTF writer finds it by name and puts it at glyph id zero. A renamed
    // one is not found, and a blank is synthesised over whatever was drawn.
    const d = fontDocument([glyph(".notdef", { advance: 500 }), glyph("a", { advance: 500 })]);

    expect(renameProblem(d, ".notdef", "notdef")).toBe("reserved");
    expect(renameGlyph(d, ".notdef", "notdef")).toBeNull();
  });

  it("does not stand in the way of renaming anything else to it", () => {
    // Nothing here is claiming the name is magic in both directions: a font
    // without a .notdef may well want to promote one.
    const d = fontDocument([glyph("a", { advance: 500 })]);
    expect(renameGlyph(d, "a", ".notdef")?.glyphOrder).toEqual([".notdef"]);
  });
});

describe("deleting .notdef", () => {
  const d = () => fontDocument([glyph(".notdef", { advance: 500 }), glyph("a", { advance: 500 })]);

  it("is refused, and says why", () => {
    expect(deleteProblem(d(), ".notdef")).toBe("reserved");
    expect(removeGlyph(d(), ".notdef")).toBeNull();
  });

  it("does not stand in the way of deleting anything else", () => {
    expect(removeGlyph(d(), "a")?.glyphOrder).toEqual([".notdef"]);
    expect(deleteProblem(d(), "a")).toBeNull();
  });

  it("still tells a missing glyph apart from a reserved one", () => {
    expect(deleteProblem(d(), "nope")).toBe("missing");
  });
});
