import type { ExtraLayer } from "@typewright/font-io";
import {
  type Axis,
  type FontDocument,
  type FontProject,
  type Glyph,
  type Instance,
  type InstanceId,
  type KeptXml,
  type Location,
  type Master,
  type MasterId,
  type Rule,
  type RuleId,
  type RulesProcessing,
  type SparseSource,
  type StructureDifferences,
  addInstance as addToInstances,
  addRule as addToRules,
  removeRule as removeFromRules,
  replaceRule as replaceInRules,
  setRulesProcessing as setProcessing,
  addMaster as addToProject,
  instanceProblemSays,
  glyphPresence,
  incompatibilities,
  interpolateGlyph,
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
  structuralDifferences,
  switchTo as switchProjectTo,
  weightsAmong,
} from "@typewright/font-model";

import { noteDesignspace, noteMasterAdded, noteMasterOpened } from "./family-folder.js";
import type { FontHost } from "./fonts.js";
import { showDocument } from "./fonts.js";
import { painted, shown } from "./opening.js";
import { shareStructure } from "./structure.js";

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
 *
 * Which master is open and which document is on screen change together, or
 * neither does. They once could come apart: the project would not go to a
 * master whose document it was not holding, and after a reload it holds only
 * the open one's — so the other master's drawing came on screen under the name
 * of the one left, and the next switch parked it there, over that master's own.
 *
 * It is finished once the drawing is on screen. Making the working copy that
 * master's is every glyph written again — seconds, for a large font — and that
 * goes on afterwards, said by the status bar as any save is. The next switch
 * waits for it, since what it parks and what it writes have to follow in order;
 * drawing does not.
 */
export async function switchMaster(host: FontHost, id: MasterId): Promise<MasterReport | null> {
  // The master before this one may still be on its way into the working copy.
  await written(host);

  const asked = host.state().project;
  if (id === asked.current) return null;

  const master = asked.masters.find((m) => m.id === id);
  if (master === undefined) return null;

  // What this master has had done to it that every master shares — a glyph
  // added or renamed, the features — made in the others, before the one gone
  // to is read.
  await shareStructure(host);

  const left = host.state().session.editor.document;
  await parkCurrent(host);

  const found = await host.disk.getMaster(id);
  if (found === null) {
    throw new Error(`${master.name} could not be read back`);
  }

  // The project as it is now, not as it was before the waiting: reading a
  // master of a large font is seconds, and anything may have been renamed,
  // moved or read in meanwhile.
  const project = host.state().project;
  if (!project.masters.some((m) => m.id === id)) return null;
  const next = switchProjectTo(
    {
      ...project,
      // Both held from here on: the one arrived at, which is what lets the
      // project go to it, and the one left, as it was parked a moment ago.
      sources: { ...project.sources, [project.current]: left, [id]: found.document },
    },
    id,
  );
  showDocument(host, found.document, false, { project: next });
  noteMasterOpened(host, project.current, id, found.document, left);
  // A master that draws only some glyphs is shown against the one it is a
  // layer of, so that one is read in as well.
  await loadWhole(host);

  writing.set(host, makeCurrent(host, id, found.document));

  return { name: master.name, glyphs: found.document.glyphOrder.length, problems: found.problems };
}

/**
 * Make the working copy a master's: its glyphs written, and then the project
 * saying it is the one open.
 *
 * In that order, and the second saying *this* master whatever is open by then:
 * what the project names as open has to be what the working copy holds, since
 * that is the pair a reload reads back. Never rejects — it runs after the
 * switch that began it has answered, so what goes wrong is said where a failed
 * save is said.
 */
async function makeCurrent(host: FontHost, id: MasterId, document: FontDocument): Promise<void> {
  try {
    await host.disk.replaceAll(document, id);
    // The project as it is by now, with this master the one open — unless the
    // font has been replaced meanwhile and this master is not in it at all.
    const project = host.state().project;
    if (project.masters.some((m) => m.id === id)) {
      await writeDesignspace(host, { ...project, current: id });
    }
  } catch (error) {
    host.patch({
      saveStatus: "failed",
      storageDetail: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The master being written into the working copy, for each store that is writing one. */
const writing = new WeakMap<FontHost, Promise<void>>();

/** Wait for a master on its way into the working copy to be there. */
export async function written(host: FontHost): Promise<void> {
  await writing.get(host);
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
  // What this master has changed that the others share, made in them first.
  // The new master is a copy of this one as it stands, changes and all — and a
  // change taken back afterwards has to be taken back in the copy too, which
  // it can only be if it is counted from here: carried later, a change undone
  // was no change at all, and the copy kept a glyph, or a name, that no other
  // master had.
  await shareStructure(host);

  const project = host.state().project;

  // What it is a copy of: the document as it stands rather than whatever the
  // project happens to be holding. The open master's document lives in the
  // session, and the project's copy of it is only as fresh as the last time
  // anything asked — a master made from that came out as the font was when it
  // was loaded, for an export or a preview that did not visit it first. A
  // master drawn as a layer is a handful of glyphs, and a new master is a
  // whole font, so that is copied from the master the layer belongs to.
  const of = project.masters.find((m) => m.id === project.current)?.sparse?.of ?? project.current;
  const from =
    of === project.current
      ? host.state().session.editor.document
      : (project.sources[of] ?? (await host.disk.getMaster(of))?.document);
  if (from === undefined) throw new Error(masterProblemSays("missing"));

  const now = host.state().project;
  const out = addToProject(
    { ...now, sources: { ...now.sources, [of]: from } },
    id,
    name,
    location,
    now.current,
  );
  if (!isProject(out)) throw new Error(masterProblemSays(out));

  // Parked at once, and the same document the project now holds for it.
  await host.disk.putMaster(id, from);
  host.patch({ project: out });
  noteMasterAdded(host, id);
  await rememberDesignspace(host, out);
}

export async function removeMaster(host: FontHost, id: MasterId): Promise<void> {
  const project = host.state().project;
  const out = removeFromProject(project, id);
  if (!isProject(out)) throw new Error(masterProblemSays(out));

  if (project.current !== id) {
    host.patch({ project: out });
    // The project said to be without it, and then its file taken away. The
    // other way round and stopped between the two, the project named a master
    // whose drawing was gone, which could not be gone to or checked against.
    await rememberDesignspace(host, out);
    await host.disk.dropMaster(id);
    return;
  }

  // The one being drawn is going, so what is on screen has to become the master
  // the project will stand in — and the two at once. It is read before anything
  // changes: told first, the project named that master over this one's drawing
  // for as long as the reading took, and a window closed then parked this
  // drawing as that master's. One that cannot be read leaves everything as it
  // was.
  await written(host);
  const found = await host.disk.getMaster(out.current);
  if (found === null) {
    const other = out.masters.find((m) => m.id === out.current)?.name ?? "The other master";
    throw new Error(`${other} could not be read back, so nothing was removed`);
  }

  const now = removeFromProject(host.state().project, id);
  if (!isProject(now)) throw new Error(masterProblemSays(now));
  const next = { ...now, sources: { ...now.sources, [now.current]: found.document } };
  const was = host.state().session.editor.document;
  showDocument(host, found.document, false, { project: next });
  noteMasterOpened(host, null, next.current, found.document, was);

  // Written down as a switch is: the working copy made that master's, then the
  // project saying so, and the file of the one removed last — so stopping part
  // of the way leaves a font that still has it rather than one that names a
  // master whose drawing is not there.
  await host.disk.replaceAll(found.document, next.current);
  await rememberDesignspace(host);
  await host.disk.dropMaster(id);
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
 *
 * In two halves: the project is one master around the document at once, and
 * what comes back writes that down when it is called. Two because writing it down is slow where the font is large — its one
 * master is parked whole, every glyph of it — and a font being opened should be
 * on screen before that rather than after it. The first half is all the screen
 * needs.
 */
export function beginFresh(host: FontHost, document: FontDocument): () => Promise<void> {
  const gone = host.state().project.masters.map((m) => m.id);
  const next = makeProject(document, { id: `master-${String(Date.now())}` });
  host.patch({ project: next });

  return async () => {
    for (const id of gone) await host.disk.dropMaster(id);
    await host.disk.putMaster(next.current, document);
    // The project as it is by now: a master may have been added since the font
    // was shown, and what was made above no longer says so.
    await rememberDesignspace(host);
  };
}

/**
 * Take on a whole family: the axes, and a master per source.
 *
 * One master goes on screen and into the ordinary layout — the first, or the
 * one asked for — and the rest are parked, which is where masters that are not
 * being drawn live. Ids are made here rather than read from the file — a
 * designspace names its sources by filename, and a filename is a thing people
 * change.
 *
 * The master and the project go on screen in one step, and before anything is
 * written: a family is as many fonts as it has masters, and writing them is
 * seconds nobody needs to spend behind a pane.
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
      readonly layers?: readonly ExtraLayer[];
      readonly sparse?: Omit<SparseSource, "of"> & { readonly of: number };
      readonly kept?: KeptXml;
    }[];
    readonly instances: readonly {
      name: string;
      location: Location;
      familyName: string;
      kept?: KeptXml;
    }[];
    readonly rules?: readonly Rule[];
    readonly rulesProcessing?: RulesProcessing;
    readonly kept?: KeptXml | null;
  },
  /** Which master to open, by its place in the family. */
  open = 0,
): Promise<void> {
  const gone = host.state().project.masters.map((m) => m.id);

  const stamp = Date.now();
  const ids = family.masters.map((_, i) => `master-${String(stamp)}-${String(i)}`);
  const masters: Master[] = family.masters.map((m, i) => ({
    id: ids[i]!,
    name: m.name,
    location: m.location,
    // The master a layer lives in, by its id now rather than by where it was
    // in the file's list.
    ...(m.sparse === undefined || ids[m.sparse.of] === undefined
      ? {}
      : { sparse: { ...m.sparse, of: ids[m.sparse.of]! } }),
    ...(m.kept === undefined ? {} : { kept: m.kept }),
  }));

  const at = masters[open] === undefined ? 0 : open;
  const first = masters[at];
  const opened = family.masters[at];
  if (first === undefined || opened === undefined) return;

  const next: FontProject = {
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
    rules: family.rules ?? [],
    rulesProcessing: family.rulesProcessing ?? "first",
    kept: family.kept ?? null,
  };
  showDocument(host, opened.document, false, { project: next });
  shown(host);
  await painted();

  for (const id of gone) await host.disk.dropMaster(id);
  for (const [i, m] of masters.entries()) {
    const source = family.masters[i];
    if (source !== undefined) await host.disk.putMaster(m.id, source.document);
  }

  // Each master's layers are in its own document; the file they were once
  // kept in beside the font is cleared.
  await host.disk.putLayers([]);

  // The working copy made the open master's, and then the project saying so:
  // the order a switch writes them in, for the reason it does.
  await written(host);
  await host.disk.replaceAll(opened.document, next.current);
  await rememberDesignspace(host, next);
  // A master that draws only some glyphs is shown against the one it is a
  // layer of.
  await loadWhole(host);
}

/**
 * Change one axis: its name, its range, its map or its stops.
 *
 * Found by tag, which is what every location refers to it by — so a new tag is
 * a new axis, and changing one is not done here.
 *
 * The masters stay where they are drawn. Moving a map's end moves where the
 * axis's range is on the design scale, and a master left outside it is a
 * mistake to be shown rather than a location to quietly change: it is where
 * somebody drew that font.
 */
export async function updateAxis(host: FontHost, tag: string, axis: Axis): Promise<void> {
  const project = host.state().project;
  if (!project.axes.some((a) => a.tag === tag)) return;
  const next = { ...project, axes: project.axes.map((a) => (a.tag === tag ? axis : a)) };
  host.patch({ project: next });
  await rememberDesignspace(host, next);
}

export async function addRule(host: FontHost, rule: Rule): Promise<void> {
  await rememberRules(host, addToRules(host.state().project, rule));
}

export async function replaceRule(host: FontHost, rule: Rule): Promise<void> {
  await rememberRules(host, replaceInRules(host.state().project, rule));
}

export async function removeRule(host: FontHost, id: RuleId): Promise<void> {
  await rememberRules(host, removeFromRules(host.state().project, id));
}

export async function setRulesProcessing(
  host: FontHost,
  processing: RulesProcessing,
): Promise<void> {
  await rememberRules(host, setProcessing(host.state().project, processing));
}

async function rememberRules(host: FontHost, next: FontProject): Promise<void> {
  if (next === host.state().project) return;
  host.patch({ project: next });
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
    rules?: readonly Rule[];
    rulesProcessing?: RulesProcessing;
    kept?: KeptXml | null;
  } | null,
  document: FontDocument,
  /**
   * The master the working copy says the document is, where it says.
   *
   * Believed over what the designspace calls open. The two are written apart —
   * every glyph of the master, then the designspace — and this was written
   * with the glyphs, so where they disagree it is the designspace that is a
   * step behind.
   */
  held: MasterId | null = null,
): ReturnType<typeof makeProject> {
  if (stored === null || stored.masters.length === 0) return makeProject(document);

  const current =
    stored.masters.find((m) => m.id === held)?.id ??
    stored.masters.find((m) => m.id === stored.current)?.id ??
    stored.masters[0]?.id ??
    "";
  return {
    axes: stored.axes,
    masters: stored.masters,
    sources: { [current]: document },
    current,
    // Absent in every project written before instances existed.
    instances: stored.instances ?? [],
    // And these before rules were kept.
    rules: stored.rules ?? [],
    rulesProcessing: stored.rulesProcessing ?? "first",
    kept: stored.kept ?? null,
  };
}

/**
 * The master a sparse one is a layer of, read in if it is not already.
 *
 * Nothing for a whole master. The glyph grid of a sparse master is the whole
 * font with the glyphs it does not draw shown faint, and the whole font is in
 * the other file.
 */
export async function loadWhole(host: FontHost): Promise<void> {
  const project = host.state().project;
  const of = project.masters.find((m) => m.id === project.current)?.sparse?.of;
  if (of === undefined || project.sources[of] !== undefined) return;

  const found = await host.disk.getMaster(of);
  if (found === null) return;
  const now = host.state().project;
  host.patch({ project: { ...now, sources: { ...now.sources, [of]: found.document } } });
}

/** The whole master the open one is a layer of, where it is one and it has been read. */
export function wholeOf(project: FontProject): FontDocument | null {
  const of = project.masters.find((m) => m.id === project.current)?.sparse?.of;
  return of === undefined ? null : (project.sources[of] ?? null);
}

/**
 * A glyph the open master does not draw, as the rest of the family has it at
 * this master's place.
 *
 * Worked out from every other master, which is what the font would draw there
 * if this master did not exist; where they cannot be worked out, the whole
 * master's own drawing, so there is always something to start from.
 */
export async function glyphFromFamily(host: FontHost, name: string): Promise<Glyph | null> {
  await loadSources(host);
  const { project, session } = host.state();
  const here = project.masters.find((m) => m.id === project.current);
  if (here === undefined) return null;

  const sources = project.masters.map((m) =>
    m.id === project.current ? session.editor.document : (project.sources[m.id] ?? null),
  );
  const present = glyphPresence(
    sources,
    project.masters.map((m) => m.sparse !== undefined),
    name,
  ).map((p, i) => p && project.masters[i]?.id !== project.current);

  const weights = weightsAmong(
    project.axes,
    project.masters.map((m) => m.location),
    present,
    here.location,
  );
  const worked = interpolateGlyph(
    sources.map((s, i) => (present[i] === true ? (s?.glyphs[name] ?? null) : null)),
    weights,
  );
  if (worked !== null) return worked;

  const whole = here.sparse === undefined ? null : project.sources[here.sparse.of];
  return whole?.glyphs[name] ?? null;
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
  const asked = host.state().project;
  const read: Record<string, FontDocument> = {};

  for (const m of asked.masters) {
    if (m.id === asked.current || asked.sources[m.id] !== undefined) continue;
    const found = await host.disk.getMaster(m.id);
    if (found !== null) read[m.id] = found.document;
  }

  // Into the project as it is now. Reading a large font's masters is seconds,
  // and putting back the project as it was before them would undo whatever
  // happened meanwhile — a master gone to, most of all, which would leave one
  // master's name over another's drawing.
  const project = host.state().project;
  host.patch({
    project: {
      ...project,
      sources: {
        ...read,
        ...project.sources,
        // The open one is whatever is on the screen, not whatever was parked.
        [project.current]: host.state().session.editor.document,
      },
    },
  });
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
  // Nothing to keep up to date for a font drawn once: its only master is the
  // working copy, and its parked file is read by nothing until there is a
  // second — which is made from the document, not from the file.
  if (state.project.masters.length < 2) return;
  await host.disk.putMaster(state.project.current, state.session.editor.document);
}

/**
 * Keep the axes and the masters beside the fonts, so a reload comes back here.
 *
 * After a master on its way into the working copy has arrived. What is written
 * here says which master is open, and written sooner it would say so of a
 * working copy that still held the one before — a rename made in the seconds a
 * large font takes to switch, and a reload in the same seconds, would open one
 * master's drawing under another's name.
 */
export async function rememberDesignspace(host: FontHost, project?: FontProject): Promise<void> {
  // Whether the family is still as its folder on disk has it, said at once:
  // every change to the project comes through here.
  noteDesignspace(host);
  await written(host);
  await writeDesignspace(host, project ?? host.state().project);
}

async function writeDesignspace(host: FontHost, project: FontProject): Promise<void> {
  await host.disk.putDesignspace({
    axes: project.axes,
    masters: project.masters,
    current: project.current,
    instances: project.instances,
    rules: project.rules,
    rulesProcessing: project.rulesProcessing,
    kept: project.kept,
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
): Promise<{
  master: Master;
  found: ReturnType<typeof incompatibilities>;
  /** What the two differ in that every master should share. */
  structure: StructureDifferences;
} | null> {
  const project = host.state().project;
  const master = project.masters.find((m) => m.id === id);
  if (master === undefined || id === project.current) return null;

  // What has changed here since this master was arrived at is carried first:
  // it is on its way to the other master, and is not a difference between them.
  await shareStructure(host);

  const found = await host.disk.getMaster(id);
  if (found === null) return null;

  const here = host.state().session.editor.document;
  return {
    master,
    found: incompatibilities(here, found.document),
    structure: structuralDifferences(here, found.document),
  };
}

/** The document of a parked master, for anything that wants to read one. */
export async function documentOfMaster(host: FontHost, id: MasterId): Promise<FontDocument | null> {
  if (id === host.state().project.current) return host.state().session.editor.document;
  return (await host.disk.getMaster(id))?.document ?? null;
}
