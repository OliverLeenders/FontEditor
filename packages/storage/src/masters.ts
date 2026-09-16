import type {
  Axis,
  FontDocument,
  Instance,
  KeptXml,
  Master,
  MasterId,
  Rule,
  RulesProcessing,
} from "@typewright/font-model";

import type { FileStore } from "./file-store.js";
import { type StoredSnapshot, documentOf, snapshotOf } from "./snapshots.js";

/**
 * The masters that are not the one being drawn.
 *
 * One of them is always open, and it lives in the ordinary layout — a file per
 * glyph, written as it changes, which is what makes autosave cheap. The rest
 * are parked: one file each, holding a whole font, written when you leave a
 * master and read when you go back to it.
 *
 * Two shapes for the same thing, and the reason is what each is for. The open
 * master is written a hundred times a minute and has to cost a couple of
 * kilobytes a time. A parked one is written once when you switch away, and what
 * matters there is that it is whole — a master half on disk is worse than no
 * master at all.
 *
 * The whole-font shape already existed for the snapshots, and this is the same
 * one: a document in a file, glyphs and all.
 */

export const MASTERS_PREFIX = "masters/";
export const DESIGNSPACE_PATH = "designspace.json";

const pathOf = (id: MasterId): string => `${MASTERS_PREFIX}${id}.json`;

/** The axes and the masters, as they are kept beside the fonts. */
export type StoredDesignspace = {
  readonly schema: number;
  readonly axes: readonly Axis[];
  readonly masters: readonly Master[];
  /** Which one was being drawn, so opening the project puts you back there. */
  readonly current: MasterId;
  /**
   * The styles named between the masters.
   *
   * Absent in every project written before instances existed, which is why the
   * reader takes a missing list as an empty one rather than as a damaged file.
   */
  readonly instances: readonly Instance[];
  /** The glyphs swapped in parts of the designspace. Absent before rules existed. */
  readonly rules: readonly Rule[];
  readonly rulesProcessing: RulesProcessing;
  /** What the designspace file said that the model does not read, or `null`. */
  readonly kept: KeptXml | null;
};

export const DESIGNSPACE_SCHEMA = 1;

export async function writeDesignspace(
  store: FileStore,
  designspace: Omit<StoredDesignspace, "schema">,
): Promise<void> {
  await store.write(
    DESIGNSPACE_PATH,
    JSON.stringify({ schema: DESIGNSPACE_SCHEMA, ...designspace }),
  );
}

/**
 * The axes and masters, or `null` for a project that has none.
 *
 * `null` is the ordinary answer, not a failure: every project written before
 * masters existed has no such file, and a font with one master never needs one.
 * The caller makes a single-master project out of the font it loaded.
 */
export async function readDesignspace(store: FileStore): Promise<StoredDesignspace | null> {
  const raw = await store.read(DESIGNSPACE_PATH);
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;

    const axes = Array.isArray(parsed["axes"]) ? (parsed["axes"] as Axis[]) : [];
    const masters = Array.isArray(parsed["masters"]) ? (parsed["masters"] as Master[]) : [];
    const current = typeof parsed["current"] === "string" ? parsed["current"] : "";
    const instances = Array.isArray(parsed["instances"]) ? (parsed["instances"] as Instance[]) : [];
    // Absent in every project written before rules were kept, which is read as
    // a family with none rather than as a damaged file.
    const rules = Array.isArray(parsed["rules"]) ? (parsed["rules"] as Rule[]) : [];
    const rulesProcessing = parsed["rulesProcessing"] === "last" ? "last" : "first";
    const kept = isRecord(parsed["kept"]) ? (parsed["kept"] as KeptXml) : null;
    if (masters.length === 0) return null;

    return {
      schema: DESIGNSPACE_SCHEMA,
      axes,
      masters,
      current,
      instances,
      rules,
      rulesProcessing,
      kept,
    };
  } catch {
    // A file that will not parse is a project whose designspace has been lost,
    // and the font itself is still there: better one master than no font.
    return null;
  }
}

/** Park a master: its whole font in one file. */
export async function writeMaster(
  store: FileStore,
  id: MasterId,
  document: FontDocument,
): Promise<void> {
  await store.write(pathOf(id), JSON.stringify(snapshotOf(document, Date.now())));
}

/**
 * Read a parked master back.
 *
 * Glyphs that will not decode are named rather than thrown, as everywhere else
 * a font is read: most of a master back is the whole point.
 */
export async function readMaster(
  store: FileStore,
  id: MasterId,
): Promise<{ document: FontDocument; problems: readonly string[] } | null> {
  const raw = await store.read(pathOf(id));
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed["glyphs"])) return null;
    return documentOf(parsed as unknown as StoredSnapshot);
  } catch {
    return null;
  }
}

export async function removeMaster(store: FileStore, id: MasterId): Promise<void> {
  await store.remove(pathOf(id));
}

/** The ids of the masters parked on disk, which is every one but the open one. */
export async function listMasters(store: FileStore): Promise<MasterId[]> {
  const paths = await store.list(MASTERS_PREFIX);
  return paths
    .filter((path) => path.endsWith(".json"))
    .map((path) => path.slice(MASTERS_PREFIX.length, -".json".length))
    .filter((id) => id !== "")
    .sort();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
