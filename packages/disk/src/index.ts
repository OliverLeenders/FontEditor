/**
 * @typewright/disk
 *
 * The user's own files.
 *
 * `@typewright/storage` keeps the font in a place the browser owns: it survives
 * a reload, and it cannot be opened in a file manager, emailed, or put in a git
 * repository. This package is the other half — a UFO folder the user picked,
 * read and written where they can see it, with the format code shared rather
 * than duplicated: a folder is read into the same file list an archive would
 * have produced, and written from the same entries `exportUfo` would zip.
 *
 * Nothing here writes without being asked. The working store autosaves; a font
 * on disk is saved when someone says to save it.
 */

export type { Access, Askable, DiskFile, DiskFolder, DiskWritable } from "./handles.js";

export type { WriteOptions, WriteReport, WrittenFile } from "./folder.js";
export { MAX_DEPTH, readFolder, textAt, writeFolder } from "./folder.js";

export { accessTo, askAccess, canOpenFolders, pickFolder } from "./access.js";

export type { RememberedFolder } from "./remember.js";
export { forgetFolder, recallFolder, rememberFolder } from "./remember.js";

export type { ProjectRecord } from "./projects.js";
export {
  FIRST_PROJECT,
  dropProject,
  hashOfWritten,
  listProjects,
  newProject,
  openProjects,
  projectById,
  projectFor,
  saveProject,
  touchProject,
} from "./projects.js";
