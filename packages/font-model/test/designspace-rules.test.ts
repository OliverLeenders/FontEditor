import { vec } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { contour } from "../src/contour.js";
import {
  type Axis,
  WEIGHT,
  avarSegments,
  axis,
  master,
  toDesign,
  toUser,
  userLocation,
  userRange,
} from "../src/designspace.js";
import { fontDocument } from "../src/document.js";
import { addContour, glyph } from "../src/glyph.js";
import { interpolateFont } from "../src/interpolate.js";
import { node } from "../src/node.js";
import {
  addMaster,
  addRule,
  isProject,
  project,
  removeMaster,
  removeRule,
  replaceRule,
  setRulesProcessing,
} from "../src/project.js";
import { rule, ruleApplies, swapsAt } from "../src/rules.js";
import { masterWeights, variationModel, weightsAmong } from "../src/variation.js";

/**
 * The parts of a designspace that are not a list of masters: the map between
 * what a user asks for and where the drawings are, the stops of an axis with
 * nothing between them, masters that draw a few glyphs, and the glyphs swapped
 * in part of the space.
 */

/** Stems of 20, 80 and 220 units, offered as weights 100, 400 and 900. */
const STEMS: Axis = {
  ...axis("wght", "Weight", 20, 80, 220),
  map: [
    [100, 20],
    [400, 80],
    [900, 220],
  ],
};

describe("an axis whose drawings are not where its menu says", () => {
  it("reads a user value as a design value, and back", () => {
    expect(toDesign(STEMS, 400)).toBe(80);
    expect(toDesign(STEMS, 650)).toBe(150);
    expect(toUser(STEMS, 150)).toBe(650);
    expect(toUser(STEMS, 220)).toBe(900);
  });

  it("carries on past the ends at the offset of the nearest pair", () => {
    // What fontTools does with a value outside the map.
    expect(toDesign(STEMS, 50)).toBe(-30);
    expect(toUser(STEMS, 240)).toBe(920);
  });

  it("offers the range on the user scale", () => {
    expect(userRange(STEMS)).toEqual({ min: 100, default: 400, max: 900 });
    expect(userLocation([STEMS], { wght: 150 })).toEqual({ wght: 650 });
  });

  it("is the same scale both ways without a map", () => {
    expect(toDesign(WEIGHT, 700)).toBe(700);
    expect(toUser(WEIGHT, 700)).toBe(700);
    expect(avarSegments(WEIGHT)).toBeNull();
  });

  it("gives avar nothing to say for a map that is a straight line", () => {
    const straight: Axis = {
      ...WEIGHT,
      map: [
        [100, 100],
        [900, 900],
      ],
    };
    expect(avarSegments(straight)).toBeNull();
  });

  it("gives avar the map normalised at both ends", () => {
    const bent: Axis = {
      ...axis("wght", "Weight", 20, 80, 220),
      map: [
        [100, 20],
        [400, 80],
        [700, 100],
        [900, 220],
      ],
    };
    // 700 is 0.6 of the way up the user half; 100 is 20/140 of the design half.
    expect(avarSegments(bent)).toEqual([
      [-1, -1],
      [0, 0],
      [0.6, 20 / 140],
      [1, 1],
    ]);
  });
});

describe("the model a variable font writes", () => {
  it("takes the edges out of a corner's delta", () => {
    const WIDTH = axis("wdth", "Width", 75, 100, 125);
    const locations = [
      { wght: 400, wdth: 100 },
      { wght: 900, wdth: 100 },
      { wght: 400, wdth: 75 },
      { wght: 900, wdth: 75 },
    ];
    const { deltas } = variationModel([WEIGHT, WIDTH], locations);

    // The corner is itself, less both edges, plus the default they both took
    // away: a plain difference from the default would leave the edges in.
    expect(deltas[3]).toEqual([1, -1, -1, 1]);
    expect(deltas[1]).toEqual([-1, 1, 0, 0]);
  });
});

describe("masters that are not all there", () => {
  const locations = [{ wght: 400 }, { wght: 900 }, { wght: 650 }];

  it("works a glyph out as if a sparse master that lacks it did not exist", () => {
    const without = weightsAmong([WEIGHT], locations, [true, true, false], { wght: 650 });
    expect(without[0]).toBeCloseTo(0.5, 10);
    expect(without[1]).toBeCloseTo(0.5, 10);
    expect(without[2]).toBe(0);

    const with_ = weightsAmong([WEIGHT], locations, [true, true, true], { wght: 650 });
    expect(with_).toEqual(masterWeights([WEIGHT], locations, { wght: 650 }));
    expect(with_[2]).toBeCloseTo(1, 10);
  });

  it("does not work anything out across an axis with stops", () => {
    const italic: Axis = { ...axis("ital", "Italic", 0, 0, 1), values: [0, 1] };
    const at = [
      { wght: 400, ital: 0 },
      { wght: 900, ital: 0 },
      { wght: 400, ital: 1 },
      { wght: 900, ital: 1 },
    ];
    const weights = weightsAmong([WEIGHT, italic], at, [true, true, true, true], {
      wght: 650,
      ital: 1,
    });
    expect(weights[0]).toBe(0);
    expect(weights[1]).toBe(0);
    expect(weights[2]).toBeCloseTo(0.5, 10);
    expect(weights[3]).toBeCloseTo(0.5, 10);
  });

  let ids = 0;
  const id = () => `s${String(++ids)}`;
  const stem = (width: number, name = "n") =>
    addContour(
      glyph(name),
      contour(id(), [node(id(), vec(0, 0)), node(id(), vec(width, 700))], true),
    );

  it("takes a sparse master's glyph where it draws one, and leaves it out elsewhere", () => {
    const regular = fontDocument([stem(80), stem(80, "o")]);
    const black = fontDocument([stem(220), stem(220, "o")]);
    // Halfway, the n is drawn wider than the straight line would have it.
    const middle = fontDocument([stem(200)]);

    const { document, refused } = interpolateFont(
      [WEIGHT],
      locations,
      [regular, black, middle],
      { wght: 650 },
      [false, false, true],
    );
    expect(refused).toEqual([]);
    expect(document.glyphs["n"]?.contours[0]?.nodes[1]?.pt.x).toBeCloseTo(200, 10);
    expect(document.glyphs["o"]?.contours[0]?.nodes[1]?.pt.x).toBeCloseTo(150, 10);
  });

  it("still refuses a glyph a whole master is missing", () => {
    const regular = fontDocument([stem(80), stem(80, "o")]);
    const black = fontDocument([stem(220)]);
    const { refused } = interpolateFont([WEIGHT], locations.slice(0, 2), [regular, black], {
      wght: 650,
    });
    expect(refused).toEqual(["o"]);
  });
});

describe("rules", () => {
  const heavy = rule(
    "r1",
    "heavy dollar",
    [[{ tag: "wght", min: 600, max: null }]],
    [["dollar", "dollar.rvrn"]],
  );

  it("applies where every range in a set holds", () => {
    expect(ruleApplies([WEIGHT], heavy, { wght: 700 })).toBe(true);
    expect(ruleApplies([WEIGHT], heavy, { wght: 600 })).toBe(true);
    expect(ruleApplies([WEIGHT], heavy, { wght: 599 })).toBe(false);
    // An axis the location leaves out is at its default.
    expect(ruleApplies([WEIGHT], heavy, {})).toBe(false);
  });

  it("applies nowhere without a set, and everywhere with an empty one", () => {
    expect(ruleApplies([WEIGHT], rule("r", "none", []), { wght: 900 })).toBe(false);
    expect(ruleApplies([WEIGHT], rule("r", "all", [[]]), { wght: 100 })).toBe(true);
  });

  it("lists the swaps in effect, in rule order", () => {
    const narrow = rule("r2", "narrow", [[{ tag: "wght", min: null, max: 300 }]], [["g", "g.alt"]]);
    expect(swapsAt([WEIGHT], [heavy, narrow], { wght: 900 })).toEqual([["dollar", "dollar.rvrn"]]);
    expect(swapsAt([WEIGHT], [heavy, narrow], { wght: 200 })).toEqual([["g", "g.alt"]]);
  });

  it("are added, replaced in place, removed and ordered by the project", () => {
    let p = addRule(project(fontDocument()), heavy);
    p = addRule(p, rule("r2", "other"));
    p = replaceRule(p, { ...heavy, name: "renamed" });
    expect(p.rules.map((r) => r.name)).toEqual(["renamed", "other"]);

    p = removeRule(p, "r1");
    expect(p.rules.map((r) => r.id)).toEqual(["r2"]);
    expect(setRulesProcessing(p, "last").rulesProcessing).toBe("last");
  });
});

describe("a master drawn as a layer of another", () => {
  it("keeps the master it lives in from being removed first", () => {
    let p = project(fontDocument());
    const added = addMaster({ ...p, axes: [WEIGHT] }, "bold", "Bold", { wght: 900 });
    if (!isProject(added)) throw new Error(added);
    p = {
      ...added,
      masters: [
        ...added.masters,
        { ...master("mid", "Mid", { wght: 650 }), sparse: { of: "bold", layer: "{650}" } },
      ],
      sources: { ...added.sources, mid: fontDocument() },
    };

    expect(removeMaster(p, "bold")).toBe("holds-layers");
    const without = removeMaster(p, "mid");
    expect(isProject(without) && removeMaster(without, "bold")).not.toBe("holds-layers");
  });
});
