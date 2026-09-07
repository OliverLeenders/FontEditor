import type { Access, Askable, DiskFolder } from "./handles.js";

/**
 * Getting hold of a folder, and being allowed to keep using it.
 *
 * Two things stand between the editor and a font on disk. The first is the
 * picker, which only opens from a click — the browser will not let a page go
 * looking through a disk on its own. The second is permission, which is granted
 * per handle and does not survive a reload: the folder you chose yesterday
 * comes back needing one more click before it can be read.
 *
 * Both are stated here rather than assumed anywhere else, because "the file is
 * open" and "we may touch the file" are different facts and the editor has to
 * be able to tell the user which one is missing.
 */

type FolderPicker = (options?: {
  mode?: "read" | "readwrite";
  id?: string;
  startIn?: unknown;
}) => Promise<DiskFolder>;

/**
 * Whether this browser can open folders at all.
 *
 * Firefox and Safari have the file pickers but not the directory one, so this
 * is a real fork rather than a formality: without it the editor has to fall
 * back to the zipped UFO it has always used.
 */
export function canOpenFolders(): boolean {
  return pickerFn() !== null;
}

function pickerFn(): FolderPicker | null {
  const fn = (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  return typeof fn === "function" ? (fn as FolderPicker) : null;
}

/**
 * Ask the user for a folder.
 *
 * `null` means they closed the picker, which is not an error and should leave
 * the editor exactly as it was. Anything else that goes wrong is thrown, since
 * it is something the user needs told.
 */
export async function pickFolder(
  mode: "read" | "readwrite" = "readwrite",
): Promise<DiskFolder | null> {
  const pick = pickerFn();
  if (pick === null) throw new Error("this browser cannot open folders");

  try {
    // The id makes the browser reopen where this editor was last, rather than
    // wherever the last download went.
    return await pick({ mode, id: "fonteditor-ufo" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

/** Whether we may still touch this folder, without asking the user anything. */
export async function accessTo(
  handle: unknown,
  mode: "read" | "readwrite" = "readwrite",
): Promise<Access> {
  const query = (handle as Askable).queryPermission;
  if (typeof query !== "function") return "granted";
  return await query.call(handle, { mode });
}

/**
 * Ask for permission, which shows a prompt and therefore needs a click behind
 * it. Called from a button, never on the way back from a reload.
 */
export async function askAccess(
  handle: unknown,
  mode: "read" | "readwrite" = "readwrite",
): Promise<boolean> {
  if ((await accessTo(handle, mode)) === "granted") return true;

  const request = (handle as Askable).requestPermission;
  if (typeof request !== "function") return false;
  return (await request.call(handle, { mode })) === "granted";
}
