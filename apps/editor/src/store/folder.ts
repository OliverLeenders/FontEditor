import {
  type DiskFolder,
  askAccess,
  forgetFolder,
  pickFolder,
  readFolder,
  recallFolder,
  rememberFolder,
  writeFolder,
} from "@fonteditor/disk";
import { readUfo, ufoFiles } from "@fonteditor/font-io";
import { type FontDocument, randomIds } from "@fonteditor/font-model";

import { type FontHost, adoptDocument, adoptImages, adoptLayers } from "./fonts.js";

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

  host.patch({ folder: { ...host.state().folder, busy: true, problem: null } });
  try {
    const document = host.state().session.editor.document;
    // The pictures and the other layers go with it. A folder holding a font
    // that names images it does not contain opens blank in every other tool,
    // and one whose `layercontents.plist` lists only the layer we edit has
    // thrown away the designer's sketch as far as anything reading it can tell.
    const written = await writeFolder(
      folder,
      ufoFiles(document, await host.disk.allImages(), host.state().layers),
    );

    host.patch({
      folder: {
        name: folder.name,
        remembered: null,
        saved: document,
        savedAt: Date.now(),
        busy: false,
        problem: null,
      },
    });

    return {
      name: folder.name,
      written: written.written,
      removed: written.removed.length,
      notes: written.notes,
    };
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    host.patch({ folder: { ...host.state().folder, busy: false, problem } });
    throw error;
  }
}

/** Stop pointing at a folder, and stop remembering it for next time. */
export async function forgetOpenFolder(host: FontHost): Promise<void> {
  host.setFolder(null);
  host.patch({
    folder: {
      name: null,
      remembered: null,
      saved: null,
      savedAt: null,
      busy: false,
      problem: null,
    },
  });
  await forgetFolder();
}

/**
 * Show, on the way in, which folder this editor was last working in.
 *
 * Only the name. Reading the folder would replace the font that was recovered
 * from the working store, which is not something to do to somebody on the
 * strength of a handle in a database — so the name goes in the bar and the
 * click is theirs.
 */
export async function noteRememberedFolder(host: FontHost): Promise<void> {
  const remembered = await recallFolder();
  if (remembered === null) return;
  if (host.state().folder.name !== null) return;
  host.patch({ folder: { ...host.state().folder, remembered: remembered.name } });
}

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
