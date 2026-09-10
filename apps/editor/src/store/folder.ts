import {
  type DiskFolder,
  accessTo,
  askAccess,
  forgetFolder,
  pickFolder,
  readFolder,
  recallFolder,
  rememberFolder,
  textAt,
  writeFolder,
} from "@typewright/disk";
import { crc32, readUfo, ufoFiles } from "@typewright/font-io";
import { type FontDocument, randomIds } from "@typewright/font-model";

import { type FontHost, adoptDocument, adoptImages, adoptLayers } from "./fonts.js";
import { NO_FOLDER } from "./state.js";

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
 * Open the folder this editor was last pointed at.
 *
 * The handle outlives the tab; permission does not, so this asks for it again
 * and therefore has to be called from a click. Reading the folder rather than
 * merely relinking to it is the point: a link without a read would leave the
 * editor able to save a font over a folder holding a different one.
 */
export async function reopenFolder(host: FontHost): Promise<FolderReport | null> {
  const remembered = await recallFolder();
  if (remembered === null) return null;

  if (!(await askAccess(remembered.folder, "readwrite"))) {
    throw new Error(`${remembered.name} is remembered, but this browser will not open it again`);
  }
  return await adoptFolder(host, remembered.folder);
}

async function adoptFolder(host: FontHost, folder: DiskFolder): Promise<FolderReport> {
  const read = readUfo(await readFolder(folder), randomIds());
  // A folder that is not a UFO is reported rather than half-adopted, exactly as
  // a damaged archive is: there is no partial font to fall back on.
  if ("reason" in read) throw new Error(`${folder.name}: ${read.reason}`);

  await adoptDocument(host, read.document);
  await adoptImages(host, read.images);
  await adoptLayers(host, read.layers);
  host.setFolder(folder, folder.name);
  await rememberFolder(folder);

  host.patch({ folder: { ...host.state().folder, saved: read.document, savedAt: null } });

  const { info, glyphOrder } = read.document;
  return {
    name: folder.name,
    family: `${info.familyName} ${info.styleName}`.trim(),
    glyphs: glyphOrder.length,
    warnings: read.warnings.map((w) => (w.glyph === null ? w.message : `${w.glyph}: ${w.message}`)),
  };
}

/** Write the font back to the folder it came from. */
export async function saveFolder(host: FontHost): Promise<SaveReport> {
  const folder = host.folder();
  if (folder === null) throw new Error("no folder is open; use Save as");
  return await writeTo(host, folder);
}

/**
 * Write the font to a folder the user picks, and work there from now on.
 *
 * A folder that already holds something which is not a UFO is refused. Save as
 * is meant to be pointed at a new folder or at an older version of this font,
 * and neither of those is "somebody's documents folder, now with a
 * metainfo.plist in it".
 */
export async function saveFolderAs(host: FontHost): Promise<SaveReport | null> {
  const folder = await pickFolder("readwrite");
  if (folder === null) return null;

  const holds = await whatItHolds(folder);
  if (holds === "other") {
    throw new Error(`${folder.name} has files in it and is not a UFO; pick an empty folder`);
  }

  const report = await writeTo(host, folder);
  host.setFolder(folder, folder.name);
  await rememberFolder(folder);
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
    // The pictures and the other layers go with it. A folder holding a font
    // that names images it does not contain opens blank in every other tool,
    // and one whose `layercontents.plist` lists only the layer we edit has
    // thrown away the designer's sketch as far as anything reading it can tell.
    const written = await writeFolder(
      folder,
      ufoFiles(document, await host.disk.allImages(), host.state().layers),
      {
        // Only the files that differ from what the last save left. A UFO is one
        // file per glyph, so moving one point changes one of several hundred,
        // and rewriting the rest is the whole of the wait.
        known: sameFolder(before, folder) ? before.written : undefined,
        // A record made in an earlier session describes a folder nothing has
        // watched since, so each file is asked whether anything else has
        // touched it. Within a session nothing has, and asking would be a read
        // per file for an answer that is always the same.
        verify: !before.checked,
        onProgress: (done, total) => {
          host.patch({
            folder: { ...host.state().folder, progress: { done, total } },
          });
        },
      },
    );

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
        problem: null,
      },
    });
    // Kept with the handle, so the next session's first save is as small as
    // this one was rather than a rewrite of the whole font.
    await rememberFolder(folder, written.wrote);

    return {
      name: folder.name,
      written: written.written,
      removed: written.removed.length,
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
 * Pick up, on the way in, the folder this editor was last working in.
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
export async function noteRememberedFolder(host: FontHost): Promise<void> {
  const remembered = await recallFolder();
  if (remembered === null) return;
  if (host.state().folder.name !== null) return;

  host.setFolder(remembered.folder, remembered.name);
  host.patch({
    folder: {
      ...host.state().folder,
      name: remembered.name,
      remembered: null,
      savedAt: remembered.at,
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
async function whatItHolds(folder: DiskFolder): Promise<"empty" | "ufo" | "other"> {
  let empty = true;
  for await (const [name] of folder.entries()) {
    if (name === "metainfo.plist") return "ufo";
    empty = false;
  }
  return empty ? "empty" : "other";
}

/** Whether the font has moved since it was last written to its folder. */
export function unsaved(saved: FontDocument | null, now: FontDocument): boolean {
  return saved !== null && saved !== now;
}
