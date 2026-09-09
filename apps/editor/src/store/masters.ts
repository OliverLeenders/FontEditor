import {
  type Axis,
  type FontDocument,
  type Instance,
  type InstanceId,
  type Location,
  type Master,
  type MasterId,
  addInstance as addToInstances,
  addMaster as addToProject,
  instanceProblemSays,
  incompatibilities,
  isProject,
  masterProblemSays,
  moveInstance as moveInInstances,
  moveMaster as moveInProject,
  removeInstance as removeFromInstances,
  removeMaster as removeFromProject,
  renameInstance as renameInInstances,
  renameMaster as renameInProject,
  setInstanceFamily as setFamilyInInstances,
  project as makeProject,
  setAxes as setProjectAxes,
  switchTo as switchProjectTo,
} from "@fonteditor/font-model";

import type { FontHost } from "./fonts.js";
import { showDocument } from "./fonts.js";

/**
 * Several drawings of one typeface, and moving between them.
 *
 * The arrangement: a `FontDocument` is one master, whole and complete, and the
 * editor is always editing exactly one. The others are parked on disk. So
 * switching master is a save and a load — the same two operations opening a
 * font is made of — rather than a new kind of state for everything below to
 * learn about.
 *
 * What that costs is that undo belongs to the master. A step taken in Bold is
 * undone in Bold, and switching is not itself undoable. Each master is a file,
 * and that is how files behave.
 */

/** What switching turned out to do, for a panel that has to say something. */
export type MasterReport = {
  readonly name: string;
  readonly glyphs: number;
  readonly problems: readonly string[];
};

/**
 * Go to another master.
 *
 * The order is the whole of it: park what is open before reading what is not,
 * so a crash between the two loses nothing. `null` where there is nothing to
 * go to, which a panel treats as "you are already there".
 */
export async function switchMaster(host: FontHost, id: MasterId): Promise<MasterReport | null> {
  const project = host.state().project;
  if (id === project.current) return null;

  const master = project.masters.find((m) => m.id === id);
  if (master === undefined) return null;

  await parkCurrent(host);

  const found = await host.disk.getMaster(id);
  if (found === null) {
    throw new Error(`${master.name} could not be read back`);
  }

  const next = switchProjectTo(project, id);
  host.patch({ project: next });
  showDocument(host, found.document, false);
  await host.disk.replaceAll(found.document);
  await rememberDesignspace(host, next);

  return { name: master.name, glyphs: found.document.glyphOrder.length, problems: found.problems };
}

/**
 * Add a master, drawn from the one in front of you.
 *
 * A copy rather than a blank, which is the decision the whole feature rests on:
 * interpolation needs the same points in the same order in every master, and a
 * master that began empty would be incompatible with the font in every glyph at
 * once.
 */
export async function addMaster(
  host: FontHost,
  id: MasterId,
  name: string,
  location: Location,
): Promise<void> {
  const project = host.state().project;
  const out = addToProject(project, id, name, location, project.current);
  if (!isProject(out)) throw new Error(masterProblemSays(out));

  // Parked at once, and from the document as it stands rather than from
  // whatever the project happens to be holding: the open master's document
  // lives in the session, and the project's copy of it is only as fresh as the
  // last time anything asked.
  await host.disk.putMaster(id, host.state().session.editor.document);
  host.patch({ project: out });
  await rememberDesignspace(host, out);
}

export async function removeMaster(host: FontHost, id: MasterId): Promise<void> {
  const project = host.state().project;
  const out = removeFromProject(project, id);
  if (!isProject(out)) throw new Error(masterProblemSays(out));

  // If the one being drawn has gone, what is on screen belongs to nothing: the
  // project has already chosen where to stand, so go there.
  const wasCurrent = project.current === id;
  host.patch({ project: out });
  await host.disk.dropMaster(id);
  await rememberDesignspace(host, out);

  if (!wasCurrent) return;
  const found = await host.disk.getMaster(out.current);
  if (found === null) return;
  showDocument(host, found.document, false);
  await host.disk.replaceAll(found.document);
}

export async function renameMaster(host: FontHost, id: MasterId, name: string): Promise<void> {
  const out = renameInProject(host.state().project, id, name);
  if (!isProject(out)) throw new Error(masterProblemSays(out));

  host.patch({ project: out });
  await rememberDesignspace(host, out);
}

export async function moveMaster(host: FontHost, id: MasterId, location: Location): Promise<void> {
  const out = moveInProject(host.state().project, id, location);
  if (!isProject(out)) throw new Error(masterProblemSays(out));

  host.patch({ project: out });
  await rememberDesignspace(host, out);
}

export async function setAxes(host: FontHost, axes: readonly Axis[]): Promise<void> {
  const out = setProjectAxes(host.state().project, axes);
  host.patch({ project: out });
  await rememberDesignspace(host, out);
}

/**
 * Begin again around one document: one master, and the old ones gone.
 *
 * Opening a font replaces everything, and the masters of the font that was open
 * are drawings of a typeface that is no longer here. Leaving them parked would
 * mean a project whose designspace describes one font and whose files hold two.
 */
export async function startFresh(host: FontHost, document: FontDocument): Promise<void> {
  for (const m of host.state().project.masters) await host.disk.dropMaster(m.id);

  const next = makeProject(document, { id: `master-${String(Date.now())}` });
  host.patch({ project: next });
  await host.disk.putMaster(next.current, document);
  await rememberDesignspace(host, next);
}

/**
 * Take on a whole family: the axes, and a master per source.
 *
 * The first master goes on screen and into the ordinary layout; the rest are
 * parked, which is where masters that are not being drawn live. Ids are made
 * here rather than read from the file — a designspace names its sources by
 * filename, and a filename is a thing people change.
 */
export async function adoptFamily(
  host: FontHost,
  family: {
    readonly axes: readonly Axis[];
    readonly masters: readonly {
      readonly name: string;
      readonly location: Location;
      readonly document: FontDocument;
      readonly images: ReadonlyMap<string, Uint8Array>;
    }[];
    readonly instances: readonly { name: string; location: Location; familyName: string }[];
  },
): Promise<void> {
  for (const m of host.state().project.masters) await host.disk.dropMaster(m.id);

  const stamp = Date.now();
  const masters = family.masters.map((m, i) => ({
    id: `master-${String(stamp)}-${String(i)}`,
    name: m.name,
    location: m.location,
  }));

  const first = masters[0];
  const opened = family.masters[0];
  if (first === undefined || opened === undefined) return;

  const next = {
    axes: family.axes,
    masters,
    sources: { [first.id]: opened.document },
    current: first.id,
    // The styles the designspace named between its masters, kept with a fresh
    // id each: what came out of the file is a name and a place, and the id is
    // this session's way of pointing at a row.
    instances: family.instances.map((it, i) => ({
      ...it,
      id: `instance-${String(stamp)}-${String(i)}`,
    })),
  };
  host.patch({ project: next });

  for (const [i, m] of masters.entries()) {
    const source = family.masters[i];
    if (source !== undefined) await host.disk.putMaster(m.id, source.document);
  }
  await rememberDesignspace(host, next);
}

/**
 * The project a stored designspace describes, around the document just loaded.
 *
 * The document is the master that was open when the tab last closed, so it goes
 * in as that master's source and the rest stay parked. A designspace that names
 * a master the file no longer holds is repaired rather than refused: what is
 * actually on disk is the truth about what the font has.
 */
export function projectFrom(
  stored: {
    axes: readonly Axis[];
    masters: readonly Master[];
    current: MasterId;
    instances?: readonly Instance[];
  } | null,
  document: FontDocument,
): ReturnType<typeof makeProject> {
  if (stored === null || stored.masters.length === 0) return makeProject(document);

  const current =
    stored.masters.find((m) => m.id === stored.current)?.id ?? stored.masters[0]?.id ?? "";
  return {
    axes: stored.axes,
    masters: stored.masters,
    sources: { [current]: document },
    current,
    // Absent in every project written before instances existed.
    instances: stored.instances ?? [],
  };
}

/**
 * Read every parked master into the project.
 *
 * Interpolation needs them all at once, and they live on disk one file each —
 * so previewing an instance means bringing them into memory. Done when a
 * preview is asked for rather than on opening a font: a designspace of six
 * masters is six fonts, and five of them are of no interest until somebody
 * wants to see between them.
 */
export async function loadSources(host: FontHost): Promise<void> {
  const project = host.state().project;
  const sources: Record<string, FontDocument> = {
    ...project.sources,
    // The open one is whatever is on the screen, not whatever was parked.
    [project.current]: host.state().session.editor.document,
  };

  for (const m of project.masters) {
    if (m.id === project.current || sources[m.id] !== undefined) continue;
    const found = await host.disk.getMaster(m.id);
    if (found !== null) sources[m.id] = found.document;
  }

  host.patch({ project: { ...project, sources } });
}

/**
 * Write what is open into its parked file.
 *
 * Called before leaving a master, and before anything that replaces the font.
 * The open master lives in the ordinary layout as well; this is the copy the
 * *other* masters are read from, and it is stale for exactly as long as you are
 * drawing.
 */
export async function parkCurrent(host: FontHost): Promise<void> {
  const state = host.state();
  await host.disk.putMaster(state.project.current, state.session.editor.document);
}

/** Keep the axes and the masters beside the fonts, so a reload comes back here. */
export async function rememberDesignspace(
  host: FontHost,
  project = host.state().project,
): Promise<void> {
  await host.disk.putDesignspace({
    axes: project.axes,
    masters: project.masters,
    current: project.current,
    instances: project.instances,
  });
}

/**
 * The styles named between the masters.
 *
 * Simpler than the master commands throughout, and for one reason: an instance
 * has no source. There is no file to write, none to drop, and nothing on screen
 * that could be standing in a place that has just gone — so each of these is
 * the project's own answer, remembered.
 */
export async function addInstance(
  host: FontHost,
  id: InstanceId,
  name: string,
  location: Location,
): Promise<void> {
  const out = addToInstances(host.state().project, id, name, location);
  if (!isProject(out)) throw new Error(instanceProblemSays(out));

  host.patch({ project: out });
  await rememberDesignspace(host, out);
}

export async function removeInstance(host: FontHost, id: InstanceId): Promise<void> {
  const out = removeFromInstances(host.state().project, id);
  if (!isProject(out)) throw new Error(instanceProblemSays(out));

  host.patch({ project: out });
  await rememberDesignspace(host, out);
}

export async function renameInstance(host: FontHost, id: InstanceId, name: string): Promise<void> {
  const out = renameInInstances(host.state().project, id, name);
  if (!isProject(out)) throw new Error(instanceProblemSays(out));

  host.patch({ project: out });
  await rememberDesignspace(host, out);
}

export async function moveInstance(
  host: FontHost,
  id: InstanceId,
  location: Location,
): Promise<void> {
  const out = moveInInstances(host.state().project, id, location);
  if (!isProject(out)) throw new Error(instanceProblemSays(out));

  host.patch({ project: out });
  await rememberDesignspace(host, out);
}

export async function setInstanceFamily(
  host: FontHost,
  id: InstanceId,
  familyName: string,
): Promise<void> {
  const out = setFamilyInInstances(host.state().project, id, familyName);
  if (!isProject(out)) throw new Error(instanceProblemSays(out));

  host.patch({ project: out });
  await rememberDesignspace(host, out);
}

/**
 * Which glyphs cannot be worked out between this master and another.
 *
 * Read against a parked master rather than against the project's copy of one,
 * because the project holds documents only for masters that have been open
 * this session — everything else is on disk.
 */
export async function compareWith(
  host: FontHost,
  id: MasterId,
): Promise<{ master: Master; found: ReturnType<typeof incompatibilities> } | null> {
  const project = host.state().project;
  const master = project.masters.find((m) => m.id === id);
  if (master === undefined || id === project.current) return null;

  const found = await host.disk.getMaster(id);
  if (found === null) return null;

  return {
    master,
    found: incompatibilities(host.state().session.editor.document, found.document),
  };
}

/** The document of a parked master, for anything that wants to read one. */
export async function documentOfMaster(host: FontHost, id: MasterId): Promise<FontDocument | null> {
  if (id === host.state().project.current) return host.state().session.editor.document;
  return (await host.disk.getMaster(id))?.document ?? null;
}
