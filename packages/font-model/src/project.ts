import {
  type Axis,
  type Location,
  type Master,
  type MasterId,
  defaultLocation,
  inAxisOrder,
  master as makeMaster,
  sameLocation,
  settledLocation,
} from "./designspace.js";
import type { FontDocument } from "./document.js";

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
export type MasterProblem = "no-name" | "name-taken" | "location-taken" | "last-master" | "missing";

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

  const source = p.sources[from];
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
  }
}

/** Whether a value the model handed back is a project or a refusal. */
export const isProject = (out: FontProject | MasterProblem): out is FontProject =>
  typeof out !== "string";

export { defaultLocation };
