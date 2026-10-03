import {
  type FontDocument,
  type MasterId,
  type StructurePart,
  applyStructure,
  structuralChange,
  structureCopy,
} from "@typewright/font-model";

import { noteMasterChanged } from "./family-folder.js";
import type { StoreHost } from "./state.js";
import type { Persistence } from "../persistence.js";

/**
 * Carrying what the masters share from the one being drawn to the rest.
 *
 * A master is a whole font and only one is ever open, so a glyph added, renamed
 * or removed, a code point, the order, the features, the kerning groups and the
 * family's own information are all changed in one master — and have to be the
 * same in every other, or the family is not one font drawn several times but
 * several fonts.
 *
 * It is done on the way out of a master rather than as each thing is done:
 * when another master is gone to, when the family is saved to its folder or
 * exported, when the window closes. What is carried is the *net* change since
 * the master was arrived at — what is still so when it is left — which is why
 * undo needs nothing said about it: a glyph added and taken back is no change
 * at all. And it is cheap in the one place cost matters, a large font, where
 * every parked master is some megabytes to read and write.
 *
 * Masters that differ already are not made to agree: only what changes from
 * here on is carried. What they differ in is said by the Masters panel's
 * check, with each part to be copied one way or the other by hand.
 */

type Host = StoreHost & { readonly disk: Persistence };

/** Each store's open master as it was when it was arrived at: what a change is measured from. */
const arrivedAs = new WeakMap<object, FontDocument>();

/** Note the open master as it is now, as what the next change is measured from. */
export function noteArrived(host: StoreHost, document: FontDocument): void {
  arrivedAs.set(host, document);
}

/**
 * Make the change this master has had since it was arrived at in every other
 * master, and answer how many were changed.
 *
 * Each is read as it is parked, changed, and parked again. A master drawn as a
 * layer of another follows a glyph's name and its going and nothing else.
 */
export async function shareStructure(host: Host): Promise<number> {
  const state = host.state();
  const now = state.session.editor.document;
  const base = arrivedAs.get(host);
  arrivedAs.set(host, now);

  // A tab that is only reading writes nothing, here as anywhere.
  if (base === undefined || base === now || state.ownership === "reading") return 0;
  if (state.project.masters.length < 2) return 0;

  const change = structuralChange(base, now);
  if (change === null) return 0;

  const carried: Record<MasterId, FontDocument> = {};
  for (const master of state.project.masters) {
    if (master.id === state.project.current) continue;
    const found = await host.disk.getMaster(master.id);
    if (found === null) continue;

    const next = applyStructure(found.document, change, master.sparse !== undefined);
    if (next === found.document) continue;
    await host.disk.putMaster(master.id, next);
    carried[master.id] = next;
    noteMasterChanged(host, master.id);
  }

  const changed = Object.keys(carried).length;
  if (changed > 0) {
    // What the project holds of them is what a preview and an export read.
    const project = host.state().project;
    host.patch({ project: { ...project, sources: { ...project.sources, ...carried } } });
  }
  return changed;
}

/**
 * Make another master agree with the open one in one part of what they differ
 * in: the glyphs it lacks, the code points, the order, the features, the
 * groups, the family's information, the em.
 *
 * For masters that had come apart before changes were carried, by whoever
 * knows the open one is right. The other way round — the open master taking
 * glyphs from another — is an edit to the open master, and is the store's.
 */
export async function copyStructureTo(
  host: Host,
  id: MasterId,
  part: Exclude<StructurePart, "onlyThere">,
): Promise<void> {
  const state = host.state();
  const master = state.project.masters.find((m) => m.id === id);
  if (master === undefined || id === state.project.current) return;

  const found = await host.disk.getMaster(id);
  if (found === null) throw new Error(`${master.name} could not be read back`);

  const here = host.state().session.editor.document;
  const next = applyStructure(
    found.document,
    structureCopy(here, found.document, part),
    master.sparse !== undefined,
  );
  if (next === found.document) return;

  await host.disk.putMaster(id, next);
  noteMasterChanged(host, id);
  const project = host.state().project;
  host.patch({ project: { ...project, sources: { ...project.sources, [id]: next } } });
}
