import { describe, expect, it } from "vitest";

import { type Contour, contour } from "../src/contour.js";
import { type FontDocument, fontDocument } from "../src/document.js";
import { glyph } from "../src/glyph.js";
import { counterIds } from "../src/ids.js";
import { node } from "../src/node.js";
import { type EndSerif, type SerifStyle, DEFAULT_SERIF } from "../src/serif.js";
import { addedSerifStyle, changedSerifStyle, removedSerifStyle } from "../src/serif-styles.js";
import { withNib } from "../src/stroke.js";
import {
  applyStructure,
  sameStructure,
  structuralChange,
  structuralDifferences,
  structureCopy,
} from "../src/structure.js";

/**
 * Serif styles between the masters of a family.
 *
 * That there is a style of a name is the family's, and what its numbers are is
 * each master's: a foot slight in the light and heavy in the bold is how a
 * serif varies. So what is asked is that a style added, renamed or removed in
 * one master is so in the others, with their ends, and that a style's numbers
 * changed in one master change in no other.
 */

const ids = counterIds("st-serif");
const LIGHT: SerifStyle = { ...DEFAULT_SERIF, name: "Foot", left: 30, right: 30, height: 12 };
const BOLD: SerifStyle = { ...DEFAULT_SERIF, name: "Foot", left: 80, right: 80, height: 40 };

const stem = (serif: EndSerif): Contour =>
  withNib(
    contour(
      ids.contour(),
      [
        node(ids.node(), { x: 200, y: 600 }),
        node(ids.node(), { x: 200, y: 0 }, { end: { cut: 0, serif } }),
      ],
      false,
    ),
    { angle: 30, width: 80 },
  );

const master = (style: SerifStyle): FontDocument => {
  const { name, ...numbers } = style;
  return {
    ...fontDocument([glyph("l", { advance: 400, contours: [stem({ ...numbers, style: name })] })]),
    serifs: [style],
  };
};
const footOf = (document: FontDocument) => document.glyphs["l"]!.contours[0]!.nodes[1]!.end!.serif!;

describe("a serif style changed in one master", () => {
  it("is nothing to carry where only its numbers changed", () => {
    const light = master(LIGHT);
    const heavier = changedSerifStyle(light, "Foot", { ...LIGHT, left: 44 })!;
    expect(structuralChange(light, heavier)).toBeNull();
  });

  it("is added to the others, as a copy to be made their own", () => {
    const light = master(LIGHT);
    const head: SerifStyle = { ...DEFAULT_SERIF, name: "Head", height: 20 };
    const change = structuralChange(light, addedSerifStyle(light, head)!)!;
    expect(change.serifs).toEqual({ renamed: [], removed: [], added: [head] });

    const bold = applyStructure(master(BOLD), change);
    expect(bold.serifs).toEqual([BOLD, head]);
    // And not twice, nor over a style of that name the master already has.
    expect(applyStructure(bold, change)).toBe(bold);
  });

  it("is renamed in the others, each keeping its own numbers, and on their ends", () => {
    const light = master(LIGHT);
    const renamed = changedSerifStyle(light, "Foot", { ...LIGHT, name: "Base" })!;
    const change = structuralChange(light, renamed)!;
    expect(change.serifs).toEqual({ renamed: [["Foot", "Base"]], removed: [], added: [] });

    const bold = applyStructure(master(BOLD), change);
    expect(bold.serifs).toEqual([{ ...BOLD, name: "Base" }]);
    expect(footOf(bold)).toMatchObject({ left: 80, height: 40, style: "Base" });
  });

  it("is still a rename where its numbers were changed in the same sitting", () => {
    const light = master(LIGHT);
    const both = changedSerifStyle(light, "Foot", { ...LIGHT, name: "Base", left: 44 })!;
    expect(structuralChange(light, both)!.serifs!.renamed).toEqual([["Foot", "Base"]]);
  });

  it("is removed from the others, whose letters keep their serifs", () => {
    const light = master(LIGHT);
    const change = structuralChange(light, removedSerifStyle(light, "Foot"))!;
    expect(change.serifs).toEqual({ renamed: [], removed: ["Foot"], added: [] });

    const bold = applyStructure(master(BOLD), change);
    expect(bold.serifs).toEqual([]);
    expect(footOf(bold)).toEqual({ ...DEFAULT_SERIF, left: 80, right: 80, height: 40 });
  });

  it("is followed by a master that is a layer of another in its ends, having no list", () => {
    const light = master(LIGHT);
    const layer = { ...master(BOLD), serifs: [] };
    const renamed = structuralChange(
      light,
      changedSerifStyle(light, "Foot", { ...LIGHT, name: "Base" })!,
    )!;
    expect(footOf(applyStructure(layer, renamed, true)).style).toBe("Base");

    const head: SerifStyle = { ...DEFAULT_SERIF, name: "Head" };
    const added = structuralChange(light, addedSerifStyle(light, head)!)!;
    expect(applyStructure(layer, added, true).serifs).toEqual([]);
  });
});

describe("a serif put on an end in one master", () => {
  /** A master whose l has a bare stem, cut or not, and the style to give it. */
  const bare = (style: SerifStyle, cut?: number): FontDocument => {
    const m = master(style);
    const g = m.glyphs["l"]!;
    const c = g.contours[0]!;
    const nodes = c.nodes.map((n, i) => {
      if (i !== 1) return n;
      const { end: _end, ...rest } = n;
      return cut === undefined ? rest : { ...rest, end: { cut } };
    });
    return { ...m, glyphs: { l: { ...g, contours: [{ ...c, nodes }] } } };
  };
  /** The same master with its l's foot ended otherwise. */
  const footed = (m: FontDocument, end: { cut: number; serif?: EndSerif } | null): FontDocument => {
    const g = m.glyphs["l"]!;
    const c = g.contours[0]!;
    const nodes = c.nodes.map((n, i) => {
      if (i !== 1) return n;
      const { end: _end, ...rest } = n;
      return end === null ? rest : { ...rest, end };
    });
    return { ...m, glyphs: { l: { ...g, contours: [{ ...c, nodes }] } } };
  };
  const { name: _name, ...LIGHT_NUMBERS } = LIGHT;
  const endOf = (m: FontDocument) => m.glyphs["l"]!.contours[0]!.nodes[1]!.end;

  it("is put on that end in the others, with each master's own numbers for the style", () => {
    const light = bare(LIGHT);
    const given = footed(light, { cut: 0, serif: { ...LIGHT_NUMBERS, style: "Foot" } });
    const change = structuralChange(light, given)!;
    expect(change.ends).toEqual([
      { glyph: "l", contour: 0, which: "end", cut: 0, serif: { ...LIGHT_NUMBERS, style: "Foot" } },
    ]);

    const bold = applyStructure(bare(BOLD), change);
    expect(endOf(bold)).toEqual({
      cut: 0,
      serif: { ...DEFAULT_SERIF, left: 80, right: 80, height: 40, style: "Foot" },
    });
    // Made twice it is made once.
    expect(applyStructure(bold, change)).toBe(bold);
  });

  it("stands on the other master's own cut where its end is cut already", () => {
    const light = bare(LIGHT);
    const change = structuralChange(
      light,
      footed(light, { cut: 0, serif: { ...LIGHT_NUMBERS, style: "Foot" } }),
    )!;
    expect(endOf(applyStructure(bare(BOLD, 12), change))!.cut).toBe(12);
  });

  it("comes with its numbers where it has no style, to be made the other master's own", () => {
    const light = bare(LIGHT);
    const own = { ...LIGHT_NUMBERS, left: 7 };
    const change = structuralChange(light, footed(light, { cut: 0, serif: own }))!;
    expect(endOf(applyStructure(bare(BOLD), change))!.serif).toEqual(own);
  });

  it("is taken off in the others where it is taken off, their cut left", () => {
    const light = master(LIGHT);
    const change = structuralChange(light, footed(light, { cut: 0 }))!;
    expect(change.ends).toEqual([{ glyph: "l", contour: 0, which: "end", cut: 0, serif: null }]);
    expect(endOf(applyStructure(master(BOLD), change))).toEqual({ cut: 0 });
  });

  it("changes its style in the others where its style was changed", () => {
    const head: SerifStyle = { ...DEFAULT_SERIF, name: "Head", height: 20 };
    const { name: _head, ...headNumbers } = head;
    const light = addedSerifStyle(master(LIGHT), head)!;
    const change = structuralChange(
      light,
      footed(light, { cut: 0, serif: { ...headNumbers, style: "Head" } }),
    )!;
    const bold = applyStructure(addedSerifStyle(master(BOLD), { ...head, height: 66 })!, change);
    expect(endOf(bold)!.serif).toMatchObject({ height: 66, style: "Head" });
  });

  it("is nothing to carry where only its numbers changed, on the end or in the style", () => {
    const light = master(LIGHT);
    const tuned = footed(light, {
      cut: 0,
      serif: { ...LIGHT_NUMBERS, right: 5, style: "Foot", own: ["right"] },
    });
    expect(structuralChange(light, tuned)).toBeNull();
  });

  it("arrives with a style added in the same sitting, the style first", () => {
    const light = { ...bare(LIGHT), serifs: [] };
    const styled = footed(addedSerifStyle(light, LIGHT)!, {
      cut: 0,
      serif: { ...LIGHT_NUMBERS, style: "Foot" },
    });
    const bold = applyStructure({ ...bare(BOLD), serifs: [] }, structuralChange(light, styled)!);
    expect(bold.serifs).toEqual([LIGHT]);
    expect(endOf(bold)!.serif).toEqual({ ...LIGHT_NUMBERS, style: "Foot" });
  });

  it("leaves a master alone that has no such stroke, or an outline in its place", () => {
    const light = bare(LIGHT);
    const change = structuralChange(
      light,
      footed(light, { cut: 0, serif: { ...LIGHT_NUMBERS, style: "Foot" } }),
    )!;
    const empty = { ...fontDocument([glyph("l", { advance: 400 })]), serifs: [BOLD] };
    expect(applyStructure(empty, change)).toBe(empty);
    const b = bare(BOLD);
    const g = b.glyphs["l"]!;
    const { nib: _nib, ...outline } = g.contours[0]!;
    const outlined = { ...b, glyphs: { l: { ...g, contours: [outline] } } };
    expect(applyStructure(outlined, change)).toBe(outlined);
  });
});

describe("masters whose serif styles have come apart", () => {
  const head: SerifStyle = { ...DEFAULT_SERIF, name: "Head", height: 20 };
  const flag: SerifStyle = { ...DEFAULT_SERIF, name: "Flag", right: 0 };

  it("agree where the names are the same, whatever the numbers", () => {
    expect(sameStructure(structuralDifferences(master(LIGHT), master(BOLD)))).toBe(true);
  });

  it("are told which styles only one of them has", () => {
    const here = addedSerifStyle(master(LIGHT), head)!;
    const there = addedSerifStyle(master(BOLD), flag)!;
    const differences = structuralDifferences(here, there);
    expect(differences.serifsOnlyHere).toEqual(["Head"]);
    expect(differences.serifsOnlyThere).toEqual(["Flag"]);
    expect(sameStructure(differences)).toBe(false);
  });

  it("are made to agree a style at a time, one way and the other", () => {
    const here = addedSerifStyle(master(LIGHT), head)!;
    const there = addedSerifStyle(master(BOLD), flag)!;
    const given = applyStructure(there, structureCopy(here, there, "serifsOnlyHere"));
    expect(given.serifs.map((style) => style.name)).toEqual(["Foot", "Flag", "Head"]);
    // The style they both had is left as each has it.
    expect(given.serifs[0]).toEqual(BOLD);

    const taken = applyStructure(here, structureCopy(given, here, "serifsOnlyHere"));
    expect(sameStructure(structuralDifferences(taken, given))).toBe(true);
  });
});
