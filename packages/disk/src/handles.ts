/**
 * The part of the File System Access API this package actually uses.
 *
 * Written out as our own interfaces rather than leaning on `lib.dom` for two
 * reasons. The first is that the real types describe a large API and we use
 * five methods of it; naming those five says what a folder has to be able to do
 * to hold a font, which is the useful fact. The second is that a test needs a
 * folder it can inspect afterwards, and a structural interface can be
 * implemented by fifty lines of `Map` in Node — where the browser API does not
 * exist at all.
 *
 * A real `FileSystemDirectoryHandle` satisfies `DiskFolder` structurally, so
 * nothing has to adapt at the boundary.
 */

/** Somewhere to put bytes. */
export interface DiskWritable {
  write: (data: string | Uint8Array | ArrayBuffer) => Promise<void>;
  close: () => Promise<void>;
}

export interface DiskFile {
  readonly kind: "file";
  readonly name: string;
  getFile: () => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;
  createWritable: () => Promise<DiskWritable>;
}

export interface DiskFolder {
  readonly kind: "directory";
  readonly name: string;
  entries: () => AsyncIterable<[string, DiskFile | DiskFolder]>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<DiskFile>;
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<DiskFolder>;
  removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void>;
}

/**
 * Whether we may still touch a folder the user chose earlier.
 *
 * Permission is per-handle and does not survive a reload on its own: a folder
 * remembered from yesterday comes back as a handle whose answer is "prompt",
 * and asking again requires a click. The three states are the whole reason the
 * editor cannot silently pick up where it left off — see `permission.ts`.
 */
export type Access = "granted" | "denied" | "prompt";

/**
 * The permission methods, which are Chromium's rather than any standard's.
 *
 * Optional because a browser that has the pickers may still not have these, and
 * a missing method should read as "nothing to ask" rather than throw.
 */
export interface Askable {
  queryPermission?: (options: { mode: "read" | "readwrite" }) => Promise<Access>;
  requestPermission?: (options: { mode: "read" | "readwrite" }) => Promise<Access>;
}
