import {
  type DiskFolder,
  type WrittenFile,
  type ProjectRecord,
  type RememberedFolder,
  newProject,
  projectById,
  projectFor,
  saveProject,
  accessTo,
  askAccess,
  forgetFolder,
  hashOfWritten,
  pickFolder,
  readFolder,
  rememberFolder,
  textAt,
  writeFolder,
} from "@typewright/disk";
import { crc32, entryBytes, readUfo, ufoFiles, ufoFolderName } from "@typewright/font-io";
import { type FontDocument, randomIds } from "@typewright/font-model";

import { DEFAULT_QUERY } from "@typewright/catalog";

import {
  designspaceIn,
  designspaceSaved,
  familyStemOf,
  openMasterSaved,
  readFamilyFolder,
  writeFamily,
} from "./family-folder.js";
import { type FontHost, adoptAsOpenMaster, adoptDocument, adoptImages } from "./fonts.js";
import { adoptFamily } from "./masters.js";
import { count, tell } from "./opening.js";
import { shareStructure } from "./structure.js";
import { type FolderState, NO_FOLDER } from "./state.js";

/**
 * The font as a folder on the user's disk.
 *
 * Everything else the editor saves is saved for the editor: the working store
 * is the browser's, the snapshots are beside it, and neither can be opened in a
 * file manager or committed to a repository. This is the file the work is
 * actually *in* — a UFO folder the user picked, that other tools can read.
 *
 * Which means the rule here is the opposite of autosave's. Nothing is written
 * to that folder unless someone asks: the browser's own store is where "never
 * lose anything" lives, and a folder the user chose is somewhere the editor is
 * a guest.
 */

/** What opening a folder turned out to hold. */
export type FolderReport = {
  readonly name: string;
  readonly family: string;
  readonly glyphs: number;
  readonly warnings: readonly string[];
  /**
   * The master it was read into, in a font drawn more than once: the others
   * are as they were. `null` where the folder is the whole font.
   */
  readonly master: string | null;
};

/** What writing one did. */
export type SaveReport = {
  readonly name: string;
  readonly written: number;
  readonly removed: number;
  readonly notes: readonly string[];
};

/**
 * Open a UFO folder, replacing what is open.
 *
 * `null` means the user closed the picker, which is not a failure and should
 * leave the editor untouched.
 */
export async function openFolder(host: FontHost): Promise<FolderReport | null> {
  const folder = await pickFolder("readwrite");
  if (folder === null) return null;
  return await adoptFolder(host, folder);
}

/**
 * Read the open font's folder again, replacing what is in the editor.
 *
 * The folder linked to the font on screen — not the one this editor remembers
 * opening last. Those were the same thing while there was one font, and stopped
 * being the same as soon as there were two: after switching fonts, the
 * remembered folder belongs to whichever font was last opened or saved, so
 * re-reading "this" folder quietly read another font's.
 *
 * The handle outlives the tab; permission does not, so this asks for it again
 * and has to be called from a click.
 */
export async function reopenFolder(host: FontHost): Promise<FolderReport | null> {
  const folder = host.folder();
  if (folder === null) return null;

  if (!(await askAccess(folder, "readwrite"))) {
    throw new Error(`${folder.name} cannot be opened again from this window`);
  }
  return await adoptFolder(host, folder);
}

async function adoptFolder(host: FontHost, folder: DiskFolder): Promise<FolderReport> {
  // A family's folder: a designspace, and the UFOs it names beside it.
  if ((await whatItHolds(folder)) === "family") {
    const designspace = await designspaceIn(folder);
    if (designspace !== null) return await adoptFamilyFolder(host, folder, designspace);
  }

  await tell(host, folder.name, "files");
  const files = await readFolder(folder, (done, total) => {
    count(host, done, total);
  });
  // Parsing is this thread's work, with nothing drawn while it lasts, so it is
  // said first.
  await tell(host, folder.name, "parsing");
  const read = readUfo(files, randomIds());
  // A folder that is not a UFO is reported rather than half-adopted, exactly as
  // a damaged archive is: there is no partial font to fall back on.
  if ("reason" in read) throw new Error(`${folder.name}: ${read.reason}`);

  // A font of its own, in a working copy of its own. This is the moment the
  // editor stopped being a single-font program: opening a second font used to
  // write over the first one's working copy, and now it moves to another.
  await tell(host, folder.name, "drawing");
  const before = host.state().projects.current;
  const project = await moveToProjectFor(host, folder, read.document);

  // A copy of what was on screen is kept only when it is being replaced. Moved
  // out of, it is still in its own working copy, and a copy of it here would be
  // a snapshot of another font.
  //
  // A font drawn more than once, read again from its folder, has the drawing
  // in front of you replaced and its other masters left as they are: the
  // folder is one master's.
  const again = project.id === before;
  const masters = host.state().project.masters;
  // Only while the font is still kept as one UFO. Kept as a family, its folder
  // is the family's and is read whole: see `adoptFamilyFolder`.
  const into = again && masters.length > 1;
  if (into) await adoptAsOpenMaster(host, read.document);
  else await adoptDocument(host, read.document, again);
  await adoptImages(host, read.images);
  host.setFolder(folder, folder.name);
  await rememberFolder(folder);
  await saveProject({ ...project, name: nameOf(read.document, folder), folder });

  host.patch({ folder: { ...host.state().folder, saved: read.document, savedAt: null } });

  const { info, glyphOrder } = read.document;
  return {
    name: folder.name,
    family: `${info.familyName} ${info.styleName}`.trim(),
    glyphs: glyphOrder.length,
    warnings: read.warnings.map((w) => (w.glyph === null ? w.message : `${w.glyph}: ${w.message}`)),
    master: into
      ? (masters.find((m) => m.id === host.state().project.current)?.name ?? null)
      : null,
  };
}

/**
 * Open a family from its folder: every master the designspace names.
 *
 * Read again into the font it belongs to, it replaces every master — the
 * folder is the whole family, and reading it is asking for the family as it is
 * on disk — after a copy of the drawing in front of you has been kept. The
 * master that was open is the one opened again, where the folder still has one
 * of that name.
 */
async function adoptFamilyFolder(
  host: FontHost,
  folder: DiskFolder,
  designspace: string,
): Promise<FolderReport> {
  await tell(host, folder.name, "files");
  const family = await readFamilyFolder(folder, designspace, (done, total) => {
    count(host, done, total);
  });
  const first = family.masters[0];
  if (first === undefined) throw new Error(`${folder.name}: the family has no masters`);

  await tell(host, folder.name, "drawing");
  const was = host.state();
  const replaced = was.session.editor.document;
  const wasOpen = was.project.masters.find((m) => m.id === was.project.current)?.name;
  const project = await moveToProjectFor(host, folder, first.document);
  const again = project.id === was.projects.current;

  // Kept before anything is replaced, and only where something is: a font moved
  // out of is still in its own working copy.
  if (again) await host.keepSnapshot(replaced);

  const at = again ? family.masters.findIndex((m) => m.name === wasOpen) : 0;
  const open = Math.max(0, at);
  const opened = family.masters[open] ?? first;

  host.setCatalogQuery(DEFAULT_QUERY);
  await adoptFamily(host, family, open);
  // Every master's pictures, all into the one store: an image belongs to the
  // font rather than to a master.
  for (const m of family.masters) await adoptImages(host, m.images);

  host.setFolder(folder, folder.name);
  await rememberFolder(folder);
  await saveProject({
    ...project,
    name: nameOf(opened.document, folder),
    folder,
    family: true,
    unsavedMasters: [],
  });
  host.patch({
    folder: {
      ...host.state().folder,
      saved: opened.document,
      savedAt: null,
      family: true,
      others: [],
      behind: false,
      designspaceBehind: false,
    },
  });

  return {
    name: folder.name,
    family: `${opened.document.info.familyName} ${opened.name}`.trim(),
    glyphs: opened.document.glyphOrder.length,
    warnings: [
      `${String(family.masters.length)} masters: ${family.masters.map((m) => m.name).join(", ")}`,
      ...family.warnings.map((w) => (w.glyph === null ? w.message : `${w.glyph}: ${w.message}`)),
    ],
    master: null,
  };
}

/**
 * The project this folder belongs to, moved into.
 *
 * A folder already opened once has a project; a folder being opened for the
 * first time gets one. Either way the working copy and the write lock become
 * that project's before anything is written, because what follows writes the
 * font into whichever working copy is open — and writing it into the last
 * font's is the bug this exists to prevent.
 */
async function moveToProjectFor(
  host: FontHost,
  folder: DiskFolder,
  document: FontDocument,
): Promise<ProjectRecord> {
  const found = await projectFor(folder);
  const project = found ?? newProject(nameOf(document, folder), folder);
  if (found === null) await saveProject(project);

  if (host.state().projects.current === project.id) return project;

  await host.enterProject(project.id);
  return project;
}

/** What to call a font in a list of them. Its own name, or its folder's. */
function nameOf(document: FontDocument, folder: DiskFolder): string {
  const named = `${document.info.familyName} ${document.info.styleName}`.trim();
  return named === "" ? folder.name : named;
}

/**
 * Whether the font is kept as a family: a designspace and a UFO for each
 * master. One drawn more than once is, and so is one that has been — its
 * folder is a family's, and stays one.
 */
export function keptAsFamily(state: {
  readonly folder: FolderState;
  readonly project: { readonly masters: readonly unknown[] };
}): boolean {
  return state.folder.family || state.project.masters.length > 1;
}

/**
 * Write the font back to the folder it came from.
 *
 * A font that has gained a second master since it was saved as one UFO has
 * nowhere to write it: a family is kept in a folder of its own, and the UFO it
 * came from is one master's. The browser gives no way from a folder to the one
 * it is in, so the place is asked for once — which is why this can answer
 * `null`, for the picker closed.
 */
export async function saveFolder(host: FontHost): Promise<SaveReport | null> {
  const folder = host.folder();
  if (folder === null) throw new Error("no folder is open; use Save as");
  if (keptAsFamily(host.state()) && !host.state().folder.family) return await saveFolderAs(host);
  // Every master as it should be before any is written: what this one has
  // changed that they share, made in the others.
  await shareStructure(host);
  return await writeTo(host, folder);
}

/**
 * Write the font somewhere the user picks, and work there from now on.
 *
 * What is picked is *where to keep* the font — a folder of fonts, a project's
 * folder — and the font goes into a UFO of its own inside it, named after the
 * font: `Family-Style.ufo`. That is what Save As means everywhere else, and it
 * answers the question a bare folder picker left open, of whether the folder
 * picked is the font or somewhere fonts live.
 *
 * Two exceptions, both where the folder picked is plainly meant to be the font
 * itself: an empty folder whose name ends in `.ufo`, made for this font, and
 * this font's own folder picked again. A folder that is some other font's UFO is
 * refused — it is somebody's font, not a place to put one — and a UFO of the
 * same name already there is never written over: the font gets the next free
 * name beside it instead.
 */
export async function saveFolderAs(host: FontHost): Promise<SaveReport | null> {
  const place = await pickFolder("readwrite", "fonts");
  if (place === null) return null;
  if (!(await askAccess(place, "readwrite"))) throw new Error(`${place.name} cannot be written to`);

  const family = keptAsFamily(host.state());
  // Where the font was kept as one UFO until now, to say so afterwards.
  const single = host.state().folder.family ? null : host.state().folder.name;
  const folder = family ? await familyFolderFor(host, place) : await folderFor(host, place);
  await shareStructure(host);
  const written = await writeTo(host, folder);
  const report =
    family && single !== null
      ? {
          ...written,
          notes: [
            ...written.notes,
            `kept as a family in ${folder.name} from now on; ${single} is still where it was, and is no longer written to`,
          ],
        }
      : written;
  // The same font, kept somewhere else from now on. `writeTo` has already
  // pointed the handle and the font's project at the new folder, together with
  // the record of what it wrote there. Remembering the folder again here, with
  // no record, is what used to make the next session's first save a rewrite.
  host.setFolder(folder, folder.name);

  return report;
}

async function writeTo(host: FontHost, folder: DiskFolder): Promise<SaveReport> {
  if (!(await askAccess(folder, "readwrite"))) {
    throw new Error(`${folder.name} cannot be written to`);
  }

  const before = host.state().folder;
  host.patch({
    folder: { ...before, busy: true, problem: null, progress: { done: 0, total: 0 } },
  });
  try {
    const document = host.state().session.editor.document;
    const family = keptAsFamily(host.state());
    const options = {
      // Only the files that differ from what the last save left. A UFO is one
      // file per glyph, so moving one point changes one of several hundred,
      // and rewriting the rest is the whole of the wait.
      known: sameFolder(before, folder) ? before.written : undefined,
      // A record made in an earlier session describes a folder nothing has
      // watched since, so each file is asked whether anything else has
      // touched it. Within a session nothing has, and asking would be a read
      // per file for an answer that is always the same.
      verify: !before.checked,
      onProgress: (done: number, total: number) => {
        host.patch({
          folder: { ...host.state().folder, progress: { done, total } },
        });
      },
    };
    // The pictures and the other layers go with it. A folder holding a font
    // that names images it does not contain opens blank in every other tool,
    // and one whose `layercontents.plist` lists only the layer we edit has
    // thrown away the designer's sketch as far as anything reading it can tell.
    const written = family
      ? await writeFamily(host, folder, options)
      : await (async () => {
          const one = await writeFolder(
            folder,
            ufoFiles(document, await host.disk.allImages()),
            options,
          );
          return { ...one, removed: one.removed.length };
        })();

    host.patch({
      folder: {
        name: folder.name,
        remembered: null,
        saved: document,
        savedAt: Date.now(),
        busy: false,
        progress: null,
        written: written.wrote,
        checked: true,
        behind: false,
        family,
        // Every master the folder lacked has just been written to it.
        others: [],
        designspaceBehind: false,
        problem: null,
      },
    });
    // Kept with the handle, so the next session's first save is as small as
    // this one was rather than a rewrite of the whole font.
    await rememberFolder(folder, written.wrote);

    // And with the font's project, which is where the next session looks. The
    // handle above is what an editor before projects read; a save that updated
    // only the handle left every restart rewriting the whole folder, dating its
    // last save to whenever the project was first recorded, and unable to say
    // whether the font on screen was the one on disk.
    const current = host.state().projects.current;
    const project = current === null ? null : await projectById(current);
    if (project !== null) {
      const wrote = [...written.wrote];
      await saveProject({
        ...project,
        folder,
        name: nameOf(document, folder),
        savedAt: host.state().folder.savedAt,
        savedHash: hashOfWritten(wrote),
        wrote,
        family,
        unsavedMasters: [],
      });
    }

    return {
      name: folder.name,
      written: written.written,
      removed: written.removed,
      notes: written.notes,
    };
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    host.patch({
      folder: { ...host.state().folder, busy: false, progress: null, problem },
    });
    throw error;
  }
}

/**
 * Whether what the last save recorded is about the folder being written to.
 *
 * Save-as points at somewhere else, and a record of what is in *this* folder
 * says nothing about what is in that one — so it writes everything, which is
 * what saving into an empty folder has to do anyway.
 */
function sameFolder(state: { readonly name: string | null }, folder: DiskFolder): boolean {
  return state.name !== null && state.name === folder.name;
}

/** Stop pointing at a folder, and stop remembering it for next time. */
export async function forgetOpenFolder(host: FontHost): Promise<void> {
  host.setFolder(null);
  host.patch({
    folder: NO_FOLDER,
  });
  await forgetFolder();
}

/**
 * Pick up, on the way in, the folder of the font being opened.
 *
 * Linked, not read. Reading would replace the font recovered from the working
 * store — which is the one somebody left off in — with whatever is on disk, and
 * that is a decision rather than a thing to do to them at startup. So the
 * handle becomes the save target and the document stays as it was: Ctrl-S then
 * writes where it wrote last time, with no folder to pick.
 *
 * What comes with it is the record of what that save left there, so the first
 * save of a session is as small as any other. The record describes a folder
 * nothing has watched since, though, so it is marked as wanting a check — see
 * `writeTo`, which does it at the moment there is a gesture to do it under.
 *
 * Permission is the reason for that shape. A handle survives a reload and
 * permission does not: asking needs a click behind it, so it cannot happen
 * here. Where permission *has* survived — an installed app may keep it — the
 * check happens here instead and the first save is silent.
 */
export async function noteFolder(
  host: FontHost,
  remembered: RememberedFolder,
  /** What the font's record says of a folder that is a family's. */
  kept: { readonly family: boolean; readonly unsavedMasters: readonly string[] } = {
    family: false,
    unsavedMasters: [],
  },
): Promise<void> {
  if (host.state().folder.name !== null) return;

  // The masters the folder was left without, of those the font still has. The
  // open one is asked afresh, by comparing it with what the last save left.
  const project = host.state().project;
  const others = kept.unsavedMasters.filter(
    (id) => id !== project.current && project.masters.some((m) => m.id === id),
  );

  host.setFolder(remembered.folder, remembered.name);
  host.patch({
    folder: {
      ...host.state().folder,
      name: remembered.name,
      remembered: null,
      savedAt: remembered.at,
      family: kept.family,
      others,
      // Left with changes and come back to: it is behind, whatever the
      // comparison that follows can or cannot say.
      behind: kept.family && kept.unsavedMasters.includes(project.current),
      written: new Map(remembered.wrote),
      // Nothing has looked at the folder since the last session, so what the
      // record says about it is a belief rather than a fact.
      checked: false,
    },
  });

  // If permission outlived the restart there is nothing to wait for.
  if ((await accessTo(remembered.folder, "readwrite")) === "granted") {
    await checkFolder(host, remembered.folder);
  }
}

/**
 * Whether the folder still holds what the last save left in it.
 *
 * Three small files rather than all of them: `metainfo.plist` says it is still
 * a UFO, `fontinfo.plist` moves whenever the font's own numbers do, and
 * `glyphs/contents.plist` moves whenever a glyph is added or removed. Between
 * them they catch "this is a different font now" for the price of three reads,
 * which is what a startup can afford.
 *
 * It does not catch every case — somebody could edit one `.glif` and nothing
 * else — and it does not have to: every file is checked against its own
 * timestamp when the save comes to skip it. This is the coarse question asked
 * early, so that a folder which is plainly not ours is said so before anything
 * is written to it.
 */
async function checkFolder(host: FontHost, folder: DiskFolder): Promise<void> {
  const state = host.state().folder;
  const record = state.written;

  const differs: string[] = [];
  for (const path of SENTINELS) {
    const was = record.get(path);
    if (was === undefined) continue;
    const now = await textAt(folder, path);
    if (now === null || crc32(new TextEncoder().encode(now)) !== was.crc) differs.push(path);
  }

  host.patch({
    folder: {
      ...host.state().folder,
      checked: true,
      problem:
        differs.length === 0
          ? null
          : `${folder.name} has changed since this editor last wrote to it — saving will write over it`,
    },
  });
}

/** The files worth reading to ask whether a folder is still the one we left. */
const SENTINELS = ["metainfo.plist", "fontinfo.plist", "glyphs/contents.plist"];

/** Whether a folder is empty, is a UFO already, or is somebody else's. */
/**
 * The folder the font goes into, given the one picked: the font's own UFO inside
 * it, made if need be. See saveFolderAs for the rules.
 */
async function folderFor(host: FontHost, place: DiskFolder): Promise<DiskFolder> {
  const current = host.folder();
  const mine = async (folder: DiskFolder): Promise<boolean> =>
    current !== null && (await sameEntry(current, folder));

  const holds = await whatItHolds(place);
  if (holds === "ufo") {
    if (await mine(place)) return place;
    throw new Error(
      `${place.name} is another font's UFO. Pick the folder you want this font kept in, and it will be saved there as a UFO of its own.`,
    );
  }
  if (holds === "empty" && place.name.toLowerCase().endsWith(".ufo")) return place;

  const wanted = ufoFolderName(host.state().session.editor.document);
  const stem = wanted.slice(0, -".ufo".length);
  for (let n = 1; n < 100; n++) {
    const name = n === 1 ? wanted : `${stem}-${String(n)}.ufo`;
    const existing = await childFolder(place, name);
    if (existing === null) return await place.getDirectoryHandle(name, { create: true });
    const inside = await whatItHolds(existing);
    if (inside === "empty" || (inside === "ufo" && (await mine(existing)))) return existing;
  }
  throw new Error(`${place.name} already holds a hundred fonts called ${stem}`);
}

/**
 * The folder a family goes into, given the one picked: a folder of its own
 * inside it, named for the family and made if need be.
 *
 * A folder of its own, because a family is several things — a designspace and
 * a UFO for each master — and they are read back by reading the folder: it has
 * to hold the family and nothing else. The same care as for one UFO otherwise:
 * a folder that is some other font's is refused, and one of the family's name
 * already there is never written over — the family gets the next free name
 * beside it.
 */
async function familyFolderFor(host: FontHost, place: DiskFolder): Promise<DiskFolder> {
  const current = host.folder();
  const mine = async (folder: DiskFolder): Promise<boolean> =>
    current !== null && host.state().folder.family && (await sameEntry(current, folder));

  const holds = await whatItHolds(place);
  if (holds === "family") {
    if (await mine(place)) return place;
    throw new Error(
      `${place.name} is another family's folder. Pick the folder you want this one kept in, and it will be saved there in a folder of its own.`,
    );
  }
  if (holds === "ufo") {
    throw new Error(
      `${place.name} is a font's UFO. Pick the folder you want this family kept in, and it will be saved there in a folder of its own.`,
    );
  }

  const stem = familyStemOf(host.state().session.editor.document);
  for (let n = 1; n < 100; n++) {
    const name = n === 1 ? stem : `${stem}-${String(n)}`;
    const existing = await childFolder(place, name);
    if (existing === null) return await place.getDirectoryHandle(name, { create: true });
    const inside = await whatItHolds(existing);
    if (inside === "empty" || (inside === "family" && (await mine(existing)))) return existing;
  }
  throw new Error(`${place.name} already holds a hundred folders called ${stem}`);
}

/** A folder of that name inside another, or `null` where there is none. */
async function childFolder(parent: DiskFolder, name: string): Promise<DiskFolder | null> {
  for await (const [entry, handle] of parent.entries()) {
    if (entry === name) return handle.kind === "directory" ? handle : null;
  }
  return null;
}

/** Whether two handles are the same folder on disk, as far as the browser can say. */
async function sameEntry(a: DiskFolder, b: DiskFolder): Promise<boolean> {
  if (a === b) return true;
  const same = (a as { isSameEntry?: (other: unknown) => Promise<boolean> }).isSameEntry;
  if (typeof same !== "function") return false;
  try {
    return await same.call(a, b);
  } catch {
    return false;
  }
}

async function whatItHolds(folder: DiskFolder): Promise<"empty" | "ufo" | "family" | "other"> {
  let empty = true;
  let family = false;
  for await (const [name, entry] of folder.entries()) {
    if (name === "metainfo.plist") return "ufo";
    if (entry.kind === "file" && name.endsWith(".designspace")) family = true;
    empty = false;
  }
  return family ? "family" : empty ? "empty" : "other";
}

/** Whether the font has moved since it was last written to its folder. */
export function unsaved(folder: FolderState, now: FontDocument): boolean {
  // The open master; the masters that are not open; and the family itself.
  return (
    folder.behind ||
    (folder.saved !== null && folder.saved !== now) ||
    folder.others.length > 0 ||
    folder.designspaceBehind
  );
}

/**
 * Whether the font recovered on the way in is what the last save left on disk.
 *
 * The working copy survives a restart and the document the last save wrote does
 * not, so there is nothing to compare by identity. What survives is the
 * fingerprint of the files that save wrote. The font on screen is written out
 * the same way — in memory, not to the folder — and fingerprinted, and the two
 * either agree or they do not.
 *
 * Costs one serialisation of the font, once, after it has loaded. That is the
 * price of the question, and it is the same work a save does before it writes.
 */
export async function confirmSaved(host: FontHost, savedHash: string | null): Promise<void> {
  if (savedHash === null) return;

  const before = host.state().folder;
  const document = host.state().session.editor.document;

  // A family: the open master against its own UFO, and the designspace against
  // the one beside it. The other masters' answers came with the font's record.
  if (before.family) {
    const images = await host.disk.allImages();
    const project = host.state().project;
    const same = openMasterSaved(project, document, images, before.written);
    const plan = designspaceSaved(project, document, before.written);

    const after = host.state().folder;
    if (after.busy || after.saved !== before.saved) return;
    const behind = after.behind || same === false;
    host.patch({
      folder: { ...after, saved: behind ? null : document, behind, designspaceBehind: !plan },
    });
    return;
  }

  const entries = ufoFiles(document, await host.disk.allImages());
  const now = hashOfWritten(
    entries.map((entry): [string, WrittenFile] => [
      entry.path,
      { crc: crc32(entryBytes(entry)), at: 0 },
    ]),
  );

  // A save that finished while this was reading knows better than it does.
  const after = host.state().folder;
  if (after.busy || after.saved !== before.saved) return;

  const same = now === savedHash;
  host.patch({
    folder: { ...after, saved: same ? document : null, behind: !same },
  });
}
