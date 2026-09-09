import { describe, expect, it } from "vitest";

import {
  WEIGHT,
  axis,
  describeLocation,
  inAxisOrder,
  master,
  normalised,
} from "../src/designspace.js";
import { DEFAULT_FONT_INFO, fontDocument } from "../src/document.js";
import { glyph } from "../src/glyph.js";
import {
  type FontProject,
  type MasterProblem,
  addInstance,
  addMaster,
  currentSource,
  hasMasters,
  isProject,
  orderedMasters,
  project,
  instanceById,
  moveInstance,
  orderedInstances,
  removeInstance,
  removeMaster,
  renameInstance,
  renameMaster,
  moveMaster,
  setInstanceFamily,
  setAxes,
  switchTo,
  withCurrentSource,
} from "../src/project.js";

/**
 * A typeface drawn more than once.
 *
 * The rules being tested are the ones that keep a designspace usable: no two
 * masters in the same place, never nothing left, and — the one that matters
 * most — a new master starting as a copy of an existing one, so that it is
 * compatible on the day it is made rather than after a week of repair.
 */

const font = (...names: string[]) =>
  fontDocument(
    names.map((name) => glyph(name, { advance: 500 })),
    DEFAULT_FONT_INFO,
  );

const bold = (p: FontProject) => addMaster(p, "m2", "Bold", { wght: 700 });

const settled = (out: FontProject | MasterProblem): FontProject => {
  if (!isProject(out)) throw new Error(`refused: ${out}`);
  return out;
};

describe("a font with one drawing of itself", () => {
  it("is a project with one master, and no axes to move along", () => {
    const p = project(font("a"));

    expect(p.masters).toHaveLength(1);
    expect(p.masters[0]?.name).toBe("Regular");
    expect(p.axes).toEqual([]);
    expect(hasMasters(p)).toBe(false);
  });

  it("hands back the document it was given", () => {
    const document = font("a", "b");
    expect(currentSource(project(document))).toBe(document);
  });

  it("cannot be left with nothing", () => {
    const p = project(font("a"));
    expect(removeMaster(p, p.current)).toBe("last-master");
  });
});

describe("adding a master", () => {
  const withAxis = () => setAxes(project(font("a", "b")), [WEIGHT]);

  it("starts as a copy of the one you were drawing", () => {
    const p = settled(bold(withAxis()));

    // The whole reason: a master that began blank would be incompatible with
    // the font in every glyph at once.
    expect(p.sources["m2"]).toBe(p.sources[p.current]);
    expect(hasMasters(p)).toBe(true);
  });

  it("does not move you to it", () => {
    const before = withAxis();
    const p = settled(bold(before));

    // Making a master and going to it are two acts, and the second is where
    // you decide to stop drawing what you were drawing.
    expect(p.current).toBe(before.current);
  });

  it("settles its location onto the axes", () => {
    const p = settled(addMaster(withAxis(), "m2", "Heavy", { wght: 5000, bogus: 3 }));
    const heavy = p.masters.find((m) => m.id === "m2");

    expect(heavy?.location).toEqual({ wght: 900 });
  });

  it("refuses a name that is taken, or no name at all", () => {
    const p = settled(bold(withAxis()));

    expect(addMaster(p, "m3", "Bold", { wght: 800 })).toBe("name-taken");
    expect(addMaster(p, "m3", "   ", { wght: 800 })).toBe("no-name");
  });

  it("refuses a place that is taken", () => {
    const p = settled(bold(withAxis()));

    // Two masters in one place is not a design with a dimension; it is two
    // answers to the same question.
    expect(addMaster(p, "m3", "Also bold", { wght: 700 })).toBe("location-taken");
  });
});

describe("moving between masters", () => {
  it("changes which document is being edited, and nothing else", () => {
    const p = settled(bold(setAxes(project(font("a")), [WEIGHT])));
    const edited = withCurrentSource(p, font("a", "b"));

    const there = switchTo(edited, "m2");

    expect(there.current).toBe("m2");
    // What was being edited stays exactly as it was: moving is where you are
    // standing, not something you did to the font.
    expect(there.sources[edited.current]).toBe(edited.sources[edited.current]);
  });

  it("ignores a master that is not there", () => {
    const p = project(font("a"));
    expect(switchTo(p, "nowhere")).toBe(p);
  });

  it("stands somewhere real when the one being edited is removed", () => {
    const p = switchTo(settled(bold(setAxes(project(font("a")), [WEIGHT]))), "m2");
    const gone = settled(removeMaster(p, "m2"));

    expect(gone.current).toBe(gone.masters[0]?.id);
    expect(gone.sources["m2"]).toBeUndefined();
  });
});

describe("naming and placing", () => {
  const two = () => settled(bold(setAxes(project(font("a")), [WEIGHT])));

  it("renames one", () => {
    const p = settled(renameMaster(two(), "m2", "Black"));
    expect(p.masters.find((m) => m.id === "m2")?.name).toBe("Black");
  });

  it("refuses a rename onto another master's name", () => {
    expect(renameMaster(two(), "m2", "Regular")).toBe("name-taken");
  });

  it("moves one along the axis", () => {
    const p = settled(moveMaster(two(), "m2", { wght: 900 }));
    expect(p.masters.find((m) => m.id === "m2")?.location).toEqual({ wght: 900 });
  });

  it("refuses a move onto another master's place", () => {
    expect(moveMaster(two(), "m2", { wght: 400 })).toBe("location-taken");
  });

  it("puts every master back on the axes when the axes change", () => {
    const p = two();
    const narrowed = setAxes(p, [axis("wght", "Weight", 300, 400, 500)]);

    // 700 is off the end of the new axis, so the master that was there is now
    // at the end of it rather than outside the design.
    expect(narrowed.masters.find((m) => m.id === "m2")?.location).toEqual({ wght: 500 });
  });
});

describe("the order masters are shown in", () => {
  it("is along the axes, lightest first", () => {
    let p = setAxes(project(font("a")), [WEIGHT]);
    p = settled(addMaster(p, "m3", "Black", { wght: 900 }));
    p = settled(addMaster(p, "m2", "Thin", { wght: 100 }));

    expect(orderedMasters(p).map((m) => m.name)).toEqual(["Thin", "Regular", "Black"]);
  });

  it("falls back on the name where two masters sit together on every axis", () => {
    // No axes at all: every location is the same one, so there is nothing to
    // sort by but the name.
    const masters = [master("b", "Beta"), master("a", "Alpha")];
    expect(inAxisOrder([], masters).map((m) => m.name)).toEqual(["Alpha", "Beta"]);
  });
});

describe("locations", () => {
  it("reads a location the way a person says it", () => {
    const axes = [WEIGHT, axis("wdth", "Width", 75, 100, 125)];
    expect(describeLocation(axes, { wght: 700, wdth: 75 })).toBe("Weight 700 · Width 75");
  });

  it("puts the default at zero, and each end at one", () => {
    const at = normalised([WEIGHT], { wght: 400 });
    expect(at["wght"]).toBe(0);
    expect(normalised([WEIGHT], { wght: 900 })["wght"]).toBe(1);
    expect(normalised([WEIGHT], { wght: 100 })["wght"]).toBe(-1);
  });

  it("scales the two halves separately, the default not being the middle", () => {
    // 100–400–900: 250 is halfway down, 650 is halfway up, and a single linear
    // map through the whole range would say neither.
    expect(normalised([WEIGHT], { wght: 250 })["wght"]).toBeCloseTo(-0.5, 10);
    expect(normalised([WEIGHT], { wght: 650 })["wght"]).toBeCloseTo(0.5, 10);
  });
});

/**
 * The styles named between the masters.
 *
 * A different thing from a master and deliberately looser: a master is a
 * drawing and no two of them can be in the same place, an instance is a name
 * and a place and two of them there is ordinary.
 */
describe("instances", () => {
  const two = (): FontProject => {
    const one = setAxes(project(fontDocument([glyph("a")]), { id: "m1" }), [WEIGHT]);
    const out = addMaster(one, "m2", "Black", { wght: 900 });
    if (!isProject(out)) throw new Error(out);
    return out;
  };

  const named = (p: FontProject, name: string, at: Record<string, number>): FontProject => {
    const out = addInstance(p, `i-${name}`, name, at);
    if (!isProject(out)) throw new Error(out);
    return out;
  };

  it("starts with none, which is what most fonts have", () => {
    expect(project(fontDocument()).instances).toEqual([]);
  });

  it("names a style at a place on the axes", () => {
    const p = named(two(), "Semibold", { wght: 600 });

    expect(p.instances).toHaveLength(1);
    expect(instanceById(p, "i-Semibold")?.location).toEqual({ wght: 600 });
    // Empty means the family it was designed in, which is nearly always right.
    expect(instanceById(p, "i-Semibold")?.familyName).toBe("");
  });

  it("settles a location the way a master's is settled", () => {
    // An axis the font does not have is somebody's leftover; one it does have
    // and the location omits means the default there.
    const p = named(two(), "Odd", { wdth: 50 });
    expect(instanceById(p, "i-Odd")?.location).toEqual({ wght: 400 });
  });

  it("refuses a second style with the same name", () => {
    const p = named(two(), "Semibold", { wght: 600 });
    expect(addInstance(p, "other", "Semibold", { wght: 500 })).toBe("name-taken");
    expect(addInstance(p, "other", "  ", { wght: 500 })).toBe("no-name");
  });

  it("allows two styles in the same place, which a split family has", () => {
    // Chalk Condensed Bold and Chalk Bold can be one drawing under two names,
    // and refusing that would refuse the reason familyName exists.
    let p = named(two(), "Bold", { wght: 700 });
    p = named(p, "Condensed Bold", { wght: 700 });
    expect(p.instances).toHaveLength(2);
  });

  it("renames, moves and re-families one", () => {
    let p = named(two(), "Semibold", { wght: 600 });

    const renamed = renameInstance(p, "i-Semibold", "Demibold");
    if (!isProject(renamed)) throw new Error(renamed);
    p = renamed;
    expect(instanceById(p, "i-Semibold")?.name).toBe("Demibold");

    const moved = moveInstance(p, "i-Semibold", { wght: 550 });
    if (!isProject(moved)) throw new Error(moved);
    p = moved;
    expect(instanceById(p, "i-Semibold")?.location).toEqual({ wght: 550 });

    const split = setInstanceFamily(p, "i-Semibold", "Chalk Text");
    if (!isProject(split)) throw new Error(split);
    expect(instanceById(split, "i-Semibold")?.familyName).toBe("Chalk Text");
  });

  it("says so about a style that is not there", () => {
    const p = two();
    expect(renameInstance(p, "nope", "X")).toBe("missing");
    expect(moveInstance(p, "nope", {})).toBe("missing");
    expect(removeInstance(p, "nope")).toBe("missing");
    expect(setInstanceFamily(p, "nope", "X")).toBe("missing");
  });

  it("takes one away, however many are left", () => {
    // Unlike a master: a font with no styles named is the ordinary case, so
    // there is no last one to protect.
    const p = named(two(), "Semibold", { wght: 600 });
    const out = removeInstance(p, "i-Semibold");
    if (!isProject(out)) throw new Error(out);
    expect(out.instances).toEqual([]);
  });

  it("lists them along the axes, lightest first", () => {
    let p = named(two(), "Bold", { wght: 700 });
    p = named(p, "Light", { wght: 300 });
    p = named(p, "Semibold", { wght: 600 });

    expect(orderedInstances(p).map((i) => i.name)).toEqual(["Light", "Semibold", "Bold"]);
  });
});
