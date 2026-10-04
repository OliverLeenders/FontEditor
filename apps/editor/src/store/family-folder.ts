import {
  type DiskFolder,
  type WrittenFile,
  hashOfWritten,
  readFolder,
  updateProject,
  textAt,
  writeFolder,
} from "@typewright/disk";
import {
  type FamilyImport,
  type FamilyMaster,
  type FamilySource,
  type ZipFile,
  crc32,
  entryBytes,
  familyDesignspace,
  familyUfoFiles,
  familyUfoName,
  isLayerOf,
  parseDesignspace,
  readFamily,
} from "@typewright/font-io";
import {
  type FontDocument,
  type FontProject,
  type MasterId,
  randomIds,
} from "@typewright/font-model";

import type { FontHost } from "./fonts.js";
import type { StoreHost } from "./state.js";

/**
 * A font drawn more than once, kept in a folder.
 *
 * One master is a UFO, and has always been kept as one. Several are a family:
 * a designspace that says how they relate and a UFO for each, in a folder of
 * their own —
 *
 *     Family/
 *       Family.designspace
 *       Family-Regular.ufo/
 *       Family-Bold.ufo/
 *
 * — which is what fontmake is given and what every other editor writes. Until
 * this, saving wrote whichever master was open into the font's one UFO, so the
 * folder was the regular or the bold by turns and the rest of the family was
 * nowhere but the browser's own storage.
 *
 * The folder is the family's alone. That is what lets it be read whole, and
 * what makes it safe to take a master's UFO away when the master has gone.
 *
 * A save writes a master at a time and only the ones that need it: a master is
 * thousands of files, and the one not touched since the last save is already
 * there. Which need it is kept as the masters are gone between — see
 * {@link noteMasterOpened} — because a parked master cannot be asked whether it
 * has changed without reading all of it in.
 */

/** The family's name as its files and its folder are called. */
export function familyStemOf(document: FontDocument): string {
  return document.info.familyName.replace(/[^A-Za-z0-9]/g, "") || "Untitled";
}

/** The designspace file in a folder, by name, or `null` where it holds none. */
export async function designspaceIn(folder: DiskFolder): Promise<string | null> {
  for await (const [name, entry] of folder.entries()) {
    if (entry.kind === "file" && name.endsWith(".designspace")) return name;
  }
  return null;
}

/** The masters as a designspace lists them: a layer's master by its place in the list. */
function sourcesOf(project: FontProject): FamilySource[] {
  return project.masters.map((m) => {
    const of =
      m.sparse === undefined ? -1 : project.masters.findIndex((it) => it.id === m.sparse?.of);
    return {
      name: m.name,
      location: m.location,
      ...(m.sparse === undefined || of < 0 ? {} : { sparse: { ...m.sparse, of } }),
      ...(m.kept === undefined ? {} : { kept: m.kept }),
    };
  });
}

/** The designspace a project would be written as, as a file. */
function designspaceOf(project: FontProject, document: FontDocument) {
  return familyDesignspace(
    familyStemOf(document),
    project.axes,
    sourcesOf(project),
    project.instances,
    { rules: project.rules, rulesProcessing: project.rulesProcessing, kept: project.kept },
  );
}

/** A master's document: the one on screen for the one open, and otherwise as it is parked. */
async function documentOf(host: FontHost, id: MasterId): Promise<FontDocument | null> {
  const state = host.state();
  if (id === state.project.current) return state.session.editor.document;
  return (await host.disk.getMaster(id))?.document ?? null;
}

/** Whether the open master differs from what the folder holds of it. */
function openIsBehind(host: FontHost): boolean {
  const { folder, session } = host.state();
  return folder.behind || folder.saved === null || folder.saved !== session.editor.document;
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

export type FamilyWritten = {
  readonly written: number;
  readonly removed: number;
  readonly notes: readonly string[];
  readonly wrote: ReadonlyMap<string, WrittenFile>;
};

/**
 * Write the family into its folder: the designspace, and the UFO of every
 * master the folder does not already have as it is.
 *
 * `known` is what the last save left there, a path at a time; a master with
 * nothing in it under its UFO's name has never been written and is, whatever
 * else is known of it. Each UFO is written by the same writer a single font's
 * is, into its own folder inside this one, so everything that writer is
 * careful about — skipping what has not changed, taking away the glyph files
 * of glyphs that have gone and nothing else — holds for each.
 */
export async function writeFamily(
  host: FontHost,
  folder: DiskFolder,
  options: {
    readonly known: ReadonlyMap<string, WrittenFile> | undefined;
    readonly verify: boolean;
    readonly onProgress: (done: number, total: number) => void;
  },
): Promise<FamilyWritten> {
  const state = host.state();
  const project = state.project;
  const document = state.session.editor.document;
  const family = familyStemOf(document);
  const sources = sourcesOf(project);
  const images = await host.disk.allImages();

  const notes: string[] = [];
  const wrote = new Map<string, WrittenFile>();
  let written = 0;
  let removed = 0;
  // Counted across the masters, so the number that moves is of the whole save.
  let base = { done: 0, total: 0 };

  const behind = new Set<MasterId>(state.folder.others);
  if (openIsBehind(host)) behind.add(project.current);

  const ufos = new Set<string>();
  for (const [i, master] of project.masters.entries()) {
    if (isLayerOf(sources, i)) continue;

    const ufo = familyUfoName(family, master.name);
    const prefix = `${ufo}/`;
    ufos.add(ufo);

    // This master, and the ones drawn as layers of its file.
    const layers = project.masters.filter(
      (_, j) => sources[j]?.sparse?.of === i && isLayerOf(sources, j),
    );
    const before = under(options.known, prefix);
    const needed = before.size === 0 || [master, ...layers].some((m) => behind.has(m.id));
    if (!needed) {
      for (const [path, file] of before) wrote.set(`${prefix}${path}`, file);
      continue;
    }

    const own = await documentOf(host, master.id);
    if (own === null) {
      notes.push(`${master.name} could not be read, and was left as it is in the folder`);
      for (const [path, file] of before) wrote.set(`${prefix}${path}`, file);
      continue;
    }
    const children: FamilyMaster[] = [];
    for (const layer of layers) {
      const drawn = await documentOf(host, layer.id);
      const at = project.masters.indexOf(layer);
      if (drawn === null || sources[at]?.sparse === undefined) continue;
      children.push({
        name: layer.name,
        location: layer.location,
        document: drawn,
        sparse: sources[at].sparse,
      });
    }

    const entries = familyUfoFiles(
      { name: master.name, location: master.location, document: own, images },
      children,
    );
    const into = await folder.getDirectoryHandle(ufo, { create: true });
    const start = base;
    const report = await writeFolder(into, entries, {
      known: before.size === 0 ? undefined : before,
      verify: options.verify,
      onProgress: (done, total) => {
        base = { done: start.done + done, total: start.total + total };
        options.onProgress(base.done, base.total);
      },
    });
    written += report.written;
    removed += report.removed.length;
    notes.push(...report.notes.map((note) => `${master.name}: ${note}`));
    for (const [path, file] of report.wrote) wrote.set(`${prefix}${path}`, file);
  }

  // The designspace last: it names the UFOs, and a designspace naming one that
  // is not there yet is the one way this folder could be wrong part of the way.
  const designspace = designspaceOf(project, document);
  const top = await writeFolder(folder, [designspace], {
    known: only(options.known, designspace.path),
    verify: options.verify,
  });
  written += top.written;
  for (const [path, file] of top.wrote) wrote.set(path, file);

  // What the last save put here that the family no longer has: the UFO of a
  // master that has gone or been renamed, and a designspace under the family's
  // old name. Only what this editor wrote, by its own record of it.
  const stale = new Set<string>();
  for (const path of options.known?.keys() ?? []) {
    const at = path.indexOf("/");
    const first = at === -1 ? path : path.slice(0, at);
    if (first === designspace.path || ufos.has(first)) continue;
    if (at === -1 ? first.endsWith(".designspace") : first.endsWith(".ufo")) stale.add(first);
  }
  for (const name of stale) {
    try {
      await folder.removeEntry(name, { recursive: true });
      removed += 1;
      notes.push(`${name} is no longer part of the family, and was taken out of the folder`);
    } catch {
      notes.push(`${name} is no longer part of the family, and could not be taken out`);
    }
  }

  return { written, removed, notes, wrote };
}

/** What was written under a folder inside this one, by its path inside that folder. */
function under(
  known: ReadonlyMap<string, WrittenFile> | undefined,
  prefix: string,
): Map<string, WrittenFile> {
  const out = new Map<string, WrittenFile>();
  for (const [path, file] of known ?? []) {
    if (path.startsWith(prefix)) out.set(path.slice(prefix.length), file);
  }
  return out;
}

/** What was written at one path, as a record of that path alone. */
function only(
  known: ReadonlyMap<string, WrittenFile> | undefined,
  path: string,
): Map<string, WrittenFile> | undefined {
  const file = known?.get(path);
  return file === undefined ? undefined : new Map([[path, file]]);
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/**
 * Read a family from its folder: the designspace, and the UFO of each source
 * it names — and nothing else that may be lying beside them.
 */
export async function readFamilyFolder(
  folder: DiskFolder,
  designspace: string,
  progress: (done: number, total: number) => void,
): Promise<FamilyImport> {
  const text = await textAt(folder, designspace);
  const parsed = text === null ? null : parseDesignspace(text);
  if (text === null || parsed === null) {
    throw new Error(`${folder.name}: ${designspace} is not a designspace`);
  }

  const files: ZipFile[] = [{ path: designspace, bytes: new TextEncoder().encode(text) }];
  const read = new Set<string>();
  let base = { done: 0, total: 0 };
  for (const source of parsed.sources) {
    if (read.has(source.filename)) continue;
    read.add(source.filename);

    // A source the designspace names and the folder does not have is said by
    // the reader, which goes on with the masters that are there.
    const inside = await folderAt(folder, source.filename);
    if (inside === null) continue;

    const start = base;
    const found = await readFolder(inside, (done, total) => {
      base = { done: start.done + done, total: start.total + total };
      progress(base.done, base.total);
    });
    for (const file of found) {
      files.push({ path: `${source.filename}/${file.path}`, bytes: file.bytes });
    }
  }

  const family = readFamily(files, randomIds());
  if ("reason" in family) throw new Error(`${folder.name}: ${family.reason}`);
  return family;
}

/** The folder at a path below another, or `null` where it is not there. */
async function folderAt(folder: DiskFolder, path: string): Promise<DiskFolder | null> {
  let at = folder;
  try {
    for (const part of path.split("/").filter((it) => it !== "" && it !== ".")) {
      at = await at.getDirectoryHandle(part);
    }
    return at;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// which masters the folder has
// ---------------------------------------------------------------------------

/**
 * Note that another master is open, for a font kept in a family's folder.
 *
 * The folder's state is about the open master — the document last written, and
 * whether the one on screen has moved since — so it has to be handed over. The
 * master left takes its answer with it into the list of masters the folder
 * does not have; the master arrived at brings its answer out of that list. A
 * master not on the list is in the folder as it is parked, which is how it has
 * just been read.
 *
 * `left` is `null` where the master that was open has been removed.
 */
export function noteMasterOpened(
  host: FontHost,
  left: MasterId | null,
  arrived: MasterId,
  document: FontDocument,
  /** The document that was open, before this one was shown. */
  was: FontDocument,
): void {
  const folder = host.state().folder;
  if (folder.name === null || !folder.family) return;

  const others = new Set(folder.others);
  const leftBehind = folder.behind || folder.saved === null || folder.saved !== was;
  if (left !== null && leftBehind) others.add(left);
  const behind = others.delete(arrived);

  host.patch({
    folder: { ...folder, others: [...others], behind, saved: behind ? null : document },
  });
  void rememberUnsaved(host);
}

/**
 * Note that a master that is not open has been changed where it is parked: by
 * a change carried to it from the master being drawn.
 */
export function noteMasterChanged(host: StoreHost, id: MasterId): void {
  noteMasterAdded(host, id);
}

/** Note that a master has been added, which no folder has yet. */
export function noteMasterAdded(host: StoreHost, id: MasterId): void {
  const folder = host.state().folder;
  if (folder.name === null) return;

  // A font kept as one UFO has nowhere to put a second master: it is behind
  // until it is saved again, which is when it is given a family's folder.
  if (!folder.family) host.patch({ folder: { ...folder, behind: true } });
  else host.patch({ folder: { ...folder, others: [...new Set([...folder.others, id])] } });
  void rememberUnsaved(host);
}

/**
 * Note that the family is not as its designspace on disk says: a master
 * renamed, moved, added or removed, an axis changed, a style named.
 *
 * Asked each time the project is written down, by comparing the designspace it
 * would be saved as with the one the last save left — so a change taken back
 * is no longer a change.
 */
export function noteDesignspace(host: FontHost): void {
  const state = host.state();
  const folder = state.folder;
  if (folder.name === null || !folder.family) return;

  const now = designspaceOf(state.project, state.session.editor.document);
  const before = folder.written.get(now.path);
  const differs = before === undefined || before.crc !== crc32(entryBytes(now));
  if (differs !== folder.designspaceBehind) {
    host.patch({ folder: { ...folder, designspaceBehind: differs } });
  }
}

/** Keep which masters the folder does not have with the font's record, for the next session. */
async function rememberUnsaved(host: StoreHost): Promise<void> {
  const current = host.state().projects.current;
  if (current === null) return;
  // As the folder stands now, not as it does once the record has been read:
  // two of these begun together are written in the order they were asked for.
  const { family, others } = host.state().folder;
  try {
    await updateProject(current, (record) => ({ ...record, family, unsavedMasters: others }));
  } catch {
    // A record that could not be written leaves the folder thought to be up to
    // date next time, for the masters not open; the open one is asked afresh.
  }
}

/**
 * Whether the open master is what the last save left in the family's folder,
 * asked on the way in by comparing what it would be written as with the record
 * of what was written.
 *
 * `null` where it cannot be asked without reading other masters in — the open
 * one has layers drawn as masters of their own — which is taken as agreeing.
 */
export function openMasterSaved(
  project: FontProject,
  document: FontDocument,
  images: ReadonlyMap<string, Uint8Array>,
  wrote: ReadonlyMap<string, WrittenFile>,
): boolean | null {
  const sources = sourcesOf(project);
  const at = project.masters.findIndex((m) => m.id === project.current);
  const master = project.masters[at];
  if (master === undefined || isLayerOf(sources, at)) return null;
  if (project.masters.some((_, j) => sources[j]?.sparse?.of === at && isLayerOf(sources, j))) {
    return null;
  }

  const prefix = `${familyUfoName(familyStemOf(document), master.name)}/`;
  const before = [...under(wrote, prefix)];
  if (before.length === 0) return false;

  const entries = familyUfoFiles(
    { name: master.name, location: master.location, document, images },
    [],
  );
  const now = hashOfWritten(
    entries.map((entry): [string, WrittenFile] => [
      entry.path,
      { crc: crc32(entryBytes(entry)), at: 0 },
    ]),
  );
  return now === hashOfWritten(before);
}

/** Whether the family's designspace is what the last save left, by the same comparison. */
export function designspaceSaved(
  project: FontProject,
  document: FontDocument,
  wrote: ReadonlyMap<string, WrittenFile>,
): boolean {
  const now = designspaceOf(project, document);
  const before = wrote.get(now.path);
  return before !== undefined && before.crc === crc32(entryBytes(now));
}
