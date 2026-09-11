import { PROJECTS, inStore } from "./database.js";
import type { WrittenFile } from "./folder.js";
import type { DiskFolder } from "./handles.js";
import { recallFolder } from "./remember.js";

/**
 * Which fonts this editor has been working on.
 *
 * Until now there was one, remembered as a single handle, and everything about
 * a session was implied by it: the working copy in the browser's own storage,
 * the lock that decides which tab may write, the record of what the last save
 * left on disk. One font, one of each, no names needed.
 *
 * A record here is that same set of things, made plural and given an id. The id
 * is the name of the working copy's directory and the suffix of the write lock,
 * so two windows on two different fonts no longer take each other's turn — and
 * a font can be picked up again by pointing at its record rather than by being
 * the only one there was.
 *
 * What a record is *not* is the font. The font is the UFO folder on disk and
 * the working copy in the browser; this is a note saying where both of those
 * are and how they stood the last time anyone looked.
 */
export type ProjectRecord = {
  /** Minted once. Names the working copy's directory and the write lock. */
  readonly id: string;
  /** What to call it in a list: the family name, or the folder's name. */
  readonly name: string;
  /**
   * The folder on disk, or `null` for a font that has never been given one.
   *
   * A font with no folder is not a broken record. It is a new font somebody has
   * started and not yet said where to keep, and it lives in the working copy
   * until they do — so it can be listed, opened and edited, and only saving
   * needs somewhere to save to.
   */
  readonly folder: DiskFolder | null;
  /** When it was last opened, which is the order a list of these wants. */
  readonly openedAt: number;
  /** When it was last written to its folder, if it ever was. */
  readonly savedAt: number | null;
  /**
   * What the folder held when this editor last wrote to it.
   *
   * Not a hash of the font — a hash of the files. It is derived from the
   * checksums the save already computed, so it costs nothing to keep, and it
   * answers the question a restart cannot otherwise answer: whether the working
   * copy recovered on the way in is the thing that was written to disk, or has
   * moved since.
   */
  readonly savedHash: string | null;
  /**
   * Every file the last save left, with its checksum and timestamp, so the
   * next save writes only what differs rather than the whole font.
   */
  readonly wrote: readonly (readonly [string, WrittenFile])[];
};

/** A folder handle may be able to say whether it is the same place as another. */
interface Comparable {
  isSameEntry?: (other: unknown) => Promise<boolean>;
}

/**
 * The name the working copy had before working copies had names.
 *
 * One font meant one directory, called `project`, and one write lock to go with
 * it. The font that was open when this editor learned about several keeps that
 * directory — so the record adopting it has to carry the old name as its id, or
 * the first thing the new arrangement would do is lose the font it was meant to
 * pick up.
 */
export const FIRST_PROJECT = "project";

/**
 * The projects, seeded on first use from what came before.
 *
 * There is exactly one moment this matters: the first run after an editor that
 * kept a single remembered folder. The list is empty, a folder is remembered,
 * and that folder is the font somebody was working on — so it becomes project
 * one, keeping the working copy's old directory name as its id.
 *
 * Idempotent by construction: it only looks when the list is empty, and what it
 * writes makes the list not empty.
 */
export async function openProjects(): Promise<ProjectRecord[]> {
  const all = await listProjects();
  if (all.length > 0) return all;

  const remembered = await recallFolder();
  if (remembered === null) return [];

  const adopted: ProjectRecord = {
    id: FIRST_PROJECT,
    name: remembered.name,
    folder: remembered.folder,
    openedAt: remembered.at,
    // A folder remembered but never written to by this editor has nothing to
    // say about when it was saved, and saying `0` would be a lie about a real
    // moment rather than an admission of not knowing.
    savedAt: remembered.wrote.length > 0 ? remembered.at : null,
    savedHash: remembered.wrote.length > 0 ? hashOfWritten(remembered.wrote) : null,
    wrote: remembered.wrote,
  };

  await saveProject(adopted);
  return [adopted];
}

/** A new record, for a font that has just been opened or started. */
export function newProject(name: string, folder: DiskFolder | null = null): ProjectRecord {
  return {
    id: mintId(),
    name,
    folder,
    openedAt: Date.now(),
    savedAt: null,
    savedHash: null,
    wrote: [],
  };
}

/**
 * An id that names a directory and a lock.
 *
 * `crypto.randomUUID` where there is one. The fallback is not trying to be
 * unguessable — these never leave the machine — only to be different from the
 * last one on a browser old enough to lack it.
 */
function mintId(): string {
  const uuid = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID;
  if (typeof uuid === "function") return uuid.call(globalThis.crypto);
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Every project, most recently opened first. */
export async function listProjects(): Promise<ProjectRecord[]> {
  const found = await inStore(PROJECTS, "readonly", (store) => store.getAll());
  if (!Array.isArray(found)) return [];

  return found
    .map(asProject)
    .filter((it): it is ProjectRecord => it !== null)
    .sort((a, b) => b.openedAt - a.openedAt);
}

/** One project by its id, or `null` if there is no such thing any more. */
export async function projectById(id: string): Promise<ProjectRecord | null> {
  const found = await inStore(PROJECTS, "readonly", (store) => store.get(id));
  return asProject(found);
}

/** Write a record, replacing whatever was under its id. */
export async function saveProject(project: ProjectRecord): Promise<void> {
  await inStore(PROJECTS, "readwrite", (store) => store.put(project, project.id));
}

/** Forget a project. The folder on disk is untouched; this is only the note. */
export async function dropProject(id: string): Promise<void> {
  await inStore(PROJECTS, "readwrite", (store) => store.delete(id));
}

/** Say a project was opened now, so it sorts to the front next time. */
export async function touchProject(id: string, at: number = Date.now()): Promise<void> {
  const project = await projectById(id);
  if (project === null) return;
  await saveProject({ ...project, openedAt: at });
}

/**
 * The project already kept for a folder, if there is one.
 *
 * Asks the handles whether they are the same place where the browser will
 * answer, because two folders can share a name and one folder can be reached by
 * two handles. Where it will not answer, the name is all there is — and being
 * wrong there means a second record for the same font, which is untidy rather
 * than harmful.
 */
export async function projectFor(folder: DiskFolder): Promise<ProjectRecord | null> {
  const all = await listProjects();

  for (const project of all) {
    if (project.folder === null) continue;
    const same = (project.folder as Comparable).isSameEntry;
    if (typeof same !== "function") continue;
    try {
      if (await same.call(project.folder, folder)) return project;
    } catch {
      // A handle that cannot answer is not a match; fall through to names.
    }
  }

  return all.find((it) => it.folder !== null && it.folder.name === folder.name) ?? null;
}

/**
 * A single value standing for everything the last save put on disk.
 *
 * The paths are sorted first, because the order files were written in says
 * nothing about what is in the folder, and two saves of the same font must
 * agree. Cheap: the checksums are already in hand from the save itself.
 */
export function hashOfWritten(wrote: readonly (readonly [string, WrittenFile])[]): string {
  const parts = [...wrote]
    .map(([path, file]) => `${path}:${file.crc}`)
    .sort()
    .join("\n");

  // FNV-1a. Not a cryptographic hash and does not need to be: it is compared
  // with itself, to answer whether a folder still holds what we left there.
  let hash = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    hash ^= parts.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}-${String(wrote.length)}`;
}

/** Believe nothing about what is in the database: it may be older than this. */
function asProject(found: unknown): ProjectRecord | null {
  if (found === null || typeof found !== "object") return null;

  const it = found as Partial<ProjectRecord>;
  if (typeof it.id !== "string" || typeof it.name !== "string") return null;

  return {
    id: it.id,
    name: it.name,
    folder: isFolder(it.folder) ? it.folder : null,
    openedAt: typeof it.openedAt === "number" ? it.openedAt : 0,
    savedAt: typeof it.savedAt === "number" ? it.savedAt : null,
    savedHash: typeof it.savedHash === "string" ? it.savedHash : null,
    wrote: Array.isArray(it.wrote) ? it.wrote.filter(isWritten) : [],
  };
}

function isFolder(value: unknown): value is DiskFolder {
  return typeof value === "object" && value !== null && "getFileHandle" in value;
}

function isWritten(entry: unknown): entry is readonly [string, WrittenFile] {
  if (!Array.isArray(entry) || entry.length !== 2) return false;
  const [path, file] = entry as [unknown, unknown];
  if (typeof path !== "string" || typeof file !== "object" || file === null) return false;

  const written = file as Partial<WrittenFile>;
  return typeof written.crc === "number" && typeof written.at === "number";
}
