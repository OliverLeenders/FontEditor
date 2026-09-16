import {
  type Axis,
  type Instance,
  type InstanceId,
  type KeptXml,
  type Location,
  type Master,
  type MasterId,
  defaultLocation,
  inAxisOrder,
  instance as makeInstance,
  master as makeMaster,
  sameLocation,
  settledLocation,
} from "./designspace.js";
import type { FontDocument } from "./document.js";
import type { Rule, RuleId, RulesProcessing } from "./rules.js";

/**
 * A typeface, which may be drawn more than once.
 *
 * A `FontDocument` is one master: a whole font, every glyph, complete. A
 * project is the axes, the masters placed along them, and one document each.
 *
 * The consequence worth understanding is that a font with a single master is a
 * project with a single master, and everything below this — the tools, the
 * canvas, the readers and the writers — never learns that masters exist. They
 * are handed a document, which is what they have always been handed. That is
 * the whole reason for putting the multiplicity here rather than inside a
 * glyph: the alternative is a change to every line that reads a contour.
 *
 * What it costs is that undo belongs to a master. The session versions one
 * document, so a step taken in Bold is undone in Bold. Each master is a file,
 * and that is how files behave; it is still a thing to know rather than a thing
 * to discover.
 */
export type FontProject = {
  readonly axes: readonly Axis[];
  /** Never empty. A font is at least one drawing of itself. */
  readonly masters: readonly Master[];
  readonly sources: Readonly<Record<MasterId, FontDocument>>;
  /** The one being edited. Always one of `masters`. */
  readonly current: MasterId;
  /**
   * The styles the family is meant to have, between the masters.
   *
   * Empty for most fonts, and that is not the same as having none worth naming:
   * a family drawn at Light and Black with nothing said about the middle ships
   * a variable font whose style menu offers Light and Black, which is a menu of
   * its corners rather than of its styles.
   *
   * Not sources. There is nothing to draw in an instance — it is a name and a
   * place, and what it looks like is worked out — so it has no document and
   * cannot be switched to.
   */
  readonly instances: readonly Instance[];
  /** The glyphs swapped for others in parts of the designspace. See `rules.ts`. */
  readonly rules: readonly Rule[];
  readonly rulesProcessing: RulesProcessing;
  /**
   * What the designspace file said that the model does not read: its format
   * version, its `lib`, its labels and variable-font definitions. `null` for a
   * family that was never a file, which is every family begun here.
   */
  readonly kept: KeptXml | null;
};

/** The name a font's first master is given, before anybody says otherwise. */
export const FIRST_MASTER = "Regular";

/**
 * A project around a single document.
 *
 * How every font here begins, and what an ordinary font stays. No axes,
 * because a font with one drawing has no dimension to move along — the axes
 * arrive with the second master, which is when they start to mean something.
 */
export function project(
  document: FontDocument,
  options: { id?: MasterId; name?: string } = {},
): FontProject {
  const id = options.id ?? "master-1";
  return {
    axes: [],
    masters: [makeMaster(id, options.name ?? FIRST_MASTER)],
    sources: { [id]: document },
    current: id,
    instances: [],
    rules: [],
    rulesProcessing: "first",
    kept: null,
  };
}

/** The document being edited. */
export function currentSource(p: FontProject): FontDocument {
  const found = p.sources[p.current];
  // Not reachable: `current` is always one of the masters, and every master has
  // a source. Cheaper to say than to prove at every call site.
  if (found === undefined) throw new Error(`no source for the master ${p.current}`);
  return found;
}

export function sourceOf(p: FontProject, id: MasterId): FontDocument | null {
  return p.sources[id] ?? null;
}

export function masterById(p: FontProject, id: MasterId): Master | null {
  return p.masters.find((m) => m.id === id) ?? null;
}

export function currentMaster(p: FontProject): Master {
  const found = masterById(p, p.current);
  if (found === null) throw new Error(`no master ${p.current}`);
  return found;
}

/** The masters lightest first, which is the only order that is about the design. */
export function orderedMasters(p: FontProject): Master[] {
  return inAxisOrder(p.axes, p.masters);
}

/** Whether this project has anything to interpolate. */
export const hasMasters = (p: FontProject): boolean => p.masters.length > 1;

/** Put a document in as one master's, leaving everything else alone. */
export function withSource(p: FontProject, id: MasterId, document: FontDocument): FontProject {
  if (p.sources[id] === document) return p;
  return { ...p, sources: { ...p.sources, [id]: document } };
}

/** The document being edited, replaced. */
export const withCurrentSource = (p: FontProject, document: FontDocument): FontProject =>
  withSource(p, p.current, document);

/**
 * Edit which master is in front of you.
 *
 * Not an edit to the font, and deliberately not undoable: it is where you are
 * standing rather than something you did. The document that was being edited
 * stays exactly as it was.
 */
export function switchTo(p: FontProject, id: MasterId): FontProject {
  if (id === p.current || p.sources[id] === undefined) return p;
  return { ...p, current: id };
}

/** Replace the axes, settling every master's location onto them. */
export function setAxes(p: FontProject, axes: readonly Axis[]): FontProject {
  return {
    ...p,
    axes,
    masters: p.masters.map((m) => ({ ...m, location: settledLocation(axes, m.location) })),
  };
}

/** Why a master could not be added or moved, or `null` when it can. */
export type MasterProblem =
  "no-name" | "name-taken" | "location-taken" | "last-master" | "missing" | "holds-layers";

/**
 * Add a master, drawn from one that is already there.
 *
 * Copied rather than started empty, and this is the most important decision in
 * the file. Interpolation needs every glyph to have the same points in the same
 * order in every master; a new master that began blank would be incompatible
 * with the font in every glyph at once, and getting from there to a working
 * designspace is a week of work. Beginning as a copy means the new master is
 * compatible on the day it is made, and stays compatible for as long as the
 * shapes are moved rather than rebuilt.
 */
export function addMaster(
  p: FontProject,
  id: MasterId,
  name: string,
  location: Location,
  from: MasterId = p.current,
): FontProject | MasterProblem {
  const trimmed = name.trim();
  if (trimmed === "") return "no-name";
  if (p.masters.some((m) => m.name === trimmed)) return "name-taken";

  const at = settledLocation(p.axes, location);
  if (p.masters.some((m) => sameLocation(p.axes, m.location, at))) return "location-taken";

  // A sparse master is a handful of glyphs, and a new master is a whole font:
  // it is drawn from the master the layer belongs to.
  const whole = masterById(p, from)?.sparse?.of ?? from;
  const source = p.sources[whole];
  if (source === undefined) return "missing";

  return {
    ...p,
    masters: [...p.masters, makeMaster(id, trimmed, at)],
    sources: { ...p.sources, [id]: source },
  };
}

/**
 * Take a master away.
 *
 * The last one cannot go: a font with no drawings is not a font, and there
 * would be nothing to put on the screen.
 */
export function removeMaster(p: FontProject, id: MasterId): FontProject | MasterProblem {
  if (p.masters.length <= 1) return "last-master";
  if (masterById(p, id) === null) return "missing";
  // The sparse masters kept in its file would have nowhere to be written.
  if (p.masters.some((m) => m.sparse?.of === id)) return "holds-layers";

  const sources = { ...p.sources };
  delete sources[id];
  const masters = p.masters.filter((m) => m.id !== id);

  // If the one being edited has gone, stand in the nearest place there is.
  const current = p.current === id ? (inAxisOrder(p.axes, masters)[0]?.id ?? "") : p.current;
  return { ...p, masters, sources, current };
}

export function renameMaster(
  p: FontProject,
  id: MasterId,
  name: string,
): FontProject | MasterProblem {
  const trimmed = name.trim();
  if (trimmed === "") return "no-name";
  if (p.masters.some((m) => m.name === trimmed && m.id !== id)) return "name-taken";
  if (masterById(p, id) === null) return "missing";

  return { ...p, masters: p.masters.map((m) => (m.id === id ? { ...m, name: trimmed } : m)) };
}

/** Move a master to another place on the axes. */
export function moveMaster(
  p: FontProject,
  id: MasterId,
  location: Location,
): FontProject | MasterProblem {
  if (masterById(p, id) === null) return "missing";

  const at = settledLocation(p.axes, location);
  if (p.masters.some((m) => m.id !== id && sameLocation(p.axes, m.location, at))) {
    return "location-taken";
  }

  return { ...p, masters: p.masters.map((m) => (m.id === id ? { ...m, location: at } : m)) };
}

/**
 * The instances, in the order they sit on the axes.
 *
 * The same order the masters are given in, and for the same reason: a list of
 * styles running Light, Regular, Bold reads as the family it describes, and one
 * in the order somebody happened to type them does not.
 */
export function orderedInstances(p: FontProject): Instance[] {
  return inAxisOrder(p.axes, p.instances);
}

export function instanceById(p: FontProject, id: InstanceId): Instance | null {
  return p.instances.find((i) => i.id === id) ?? null;
}

/** Why an instance could not be added or changed, or `null` when it can. */
export type InstanceProblem = "no-name" | "name-taken" | "missing";

/**
 * Name a style, at a place on the axes.
 *
 * Duplicate locations are allowed where duplicate names are not, which is the
 * other way round from masters — and both follow from what the thing is. Two
 * masters in one place would be two drawings of the same font with nothing to
 * choose between them. Two instances in one place is ordinary: a family that
 * sells its Condensed separately names the same drawing twice, once in each
 * family. What must be unique is the name, because that is what a menu shows
 * and what a file is called.
 */
export function addInstance(
  p: FontProject,
  id: InstanceId,
  name: string,
  location: Location,
  familyName = "",
): FontProject | InstanceProblem {
  const trimmed = name.trim();
  if (trimmed === "") return "no-name";
  if (p.instances.some((i) => i.name === trimmed)) return "name-taken";

  const at = settledLocation(p.axes, location);
  return { ...p, instances: [...p.instances, makeInstance(id, trimmed, at, familyName.trim())] };
}

export function removeInstance(p: FontProject, id: InstanceId): FontProject | InstanceProblem {
  if (instanceById(p, id) === null) return "missing";
  return { ...p, instances: p.instances.filter((i) => i.id !== id) };
}

export function renameInstance(
  p: FontProject,
  id: InstanceId,
  name: string,
): FontProject | InstanceProblem {
  const trimmed = name.trim();
  if (trimmed === "") return "no-name";
  if (p.instances.some((i) => i.name === trimmed && i.id !== id)) return "name-taken";
  if (instanceById(p, id) === null) return "missing";

  return { ...p, instances: p.instances.map((i) => (i.id === id ? { ...i, name: trimmed } : i)) };
}

/** Move an instance to another place on the axes. */
export function moveInstance(
  p: FontProject,
  id: InstanceId,
  location: Location,
): FontProject | InstanceProblem {
  if (instanceById(p, id) === null) return "missing";

  const at = settledLocation(p.axes, location);
  return { ...p, instances: p.instances.map((i) => (i.id === id ? { ...i, location: at } : i)) };
}

/** Say which family an instance belongs to, or `""` for this one. */
export function setInstanceFamily(
  p: FontProject,
  id: InstanceId,
  familyName: string,
): FontProject | InstanceProblem {
  if (instanceById(p, id) === null) return "missing";
  const trimmed = familyName.trim();

  return {
    ...p,
    instances: p.instances.map((i) => (i.id === id ? { ...i, familyName: trimmed } : i)),
  };
}

export function setInstances(p: FontProject, instances: readonly Instance[]): FontProject {
  return { ...p, instances };
}

/** What went wrong, said to somebody who was trying to do it. */
export function instanceProblemSays(problem: InstanceProblem): string {
  switch (problem) {
    case "no-name":
      return "An instance needs a name.";
    case "name-taken":
      return "There is already an instance with that name.";
    case "missing":
      return "That instance is not in this font.";
  }
}

/** What went wrong, said to somebody who was trying to do it. */
export function masterProblemSays(problem: MasterProblem): string {
  switch (problem) {
    case "no-name":
      return "A master needs a name.";
    case "name-taken":
      return "There is already a master with that name.";
    case "location-taken":
      return "There is already a master in that place on the axes.";
    case "last-master":
      return "A font needs at least one master.";
    case "missing":
      return "That master is not in this font.";
    case "holds-layers":
      return "Other masters are drawn as layers of this one; remove those first.";
  }
}

/** Add a rule at the end, where it is applied last. */
export function addRule(p: FontProject, r: Rule): FontProject {
  return { ...p, rules: [...p.rules, r] };
}

/** Replace a rule, keeping its place in the order. */
export function replaceRule(p: FontProject, r: Rule): FontProject {
  if (!p.rules.some((it) => it.id === r.id)) return p;
  return { ...p, rules: p.rules.map((it) => (it.id === r.id ? r : it)) };
}

export function removeRule(p: FontProject, id: RuleId): FontProject {
  return { ...p, rules: p.rules.filter((it) => it.id !== id) };
}

export function setRulesProcessing(p: FontProject, processing: RulesProcessing): FontProject {
  return p.rulesProcessing === processing ? p : { ...p, rulesProcessing: processing };
}

/** Which masters draw only some glyphs, in the order the project lists them. */
export function sparseFlags(p: FontProject): boolean[] {
  return p.masters.map((m) => m.sparse !== undefined);
}

/** Whether a value the model handed back is a project or a refusal. */
export const isProject = (out: FontProject | MasterProblem | InstanceProblem): out is FontProject =>
  typeof out !== "string";

export { defaultLocation };
