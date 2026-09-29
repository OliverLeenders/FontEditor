import { type TextSettings, sameTextSettings } from "@typewright/view";

import { MAX_PROOF_SIZE, MIN_PROOF_SIZE } from "./limits.js";

/**
 * One block of the proof: the same text, at its own size, set with its own
 * features.
 *
 * A waterfall is what this is for — the text down a ladder of sizes, to find
 * where it stops reading — but a ladder is only the commonest arrangement of
 * blocks rather than a thing of its own, so what is stored is the blocks. That
 * is also what answers the other half of the question a proof is for: two blocks
 * at one size with different features set are the comparison, on one page,
 * without exporting anything.
 *
 * The size is per block and the leading is not: leading is a multiple of the em,
 * so one number already means "these proportions" at every size, and a second
 * per-block control would only offer the chance to make the ladder inconsistent.
 *
 * Direction, script and language stay in the bar for the same reason: they are
 * facts about the text being set, and text set left to right in one block and
 * right to left in the next is two proofs rather than a comparison.
 */
export type ProofBlock = {
  readonly id: string;
  /** Type size in screen pixels, as the bar's own size slider means it. */
  readonly size: number;
  readonly settings: TextSettings;
};

/**
 * The sizes a waterfall is set at, unless somebody edits it.
 *
 * The ladder printers have used for specimen sheets for a century: every size in
 * the reading range, because that is where the decisions are, and then jumps —
 * the difference between 48 and 72 is obvious at a glance and the difference
 * between 9 and 10 is the whole argument.
 */
export const PROOF_LADDER: readonly number[] = [8, 9, 10, 11, 12, 14, 18, 24, 36, 48, 72];

/**
 * The ladders the waterfall can be filled from: the classic one, and the two
 * halves of it a text face and a display face are each judged by.
 */
export const LADDERS: readonly { readonly label: string; readonly sizes: readonly number[] }[] = [
  { label: "Classic ladder", sizes: PROOF_LADDER },
  { label: "Text sizes", sizes: [8, 9, 10, 11, 12, 13, 14, 16] },
  { label: "Display sizes", sizes: [18, 24, 30, 36, 48, 60, 72, 96] },
];

/**
 * A size as a waterfall is drawn at it: the block's own, times the zoom, held
 * inside what the proof can be set at. Not rounded and never stored — the
 * ladder keeps its sizes whatever the zoom, so zooming back out gives it back.
 */
export function drawnSize(size: number, zoom: number): number {
  const scaled = size * zoom;
  if (!Number.isFinite(scaled)) return MIN_PROOF_SIZE;
  return Math.min(MAX_PROOF_SIZE, Math.max(MIN_PROOF_SIZE, scaled));
}

/** A size held inside what the proof can be set at, rounded to a whole point. */
export function heldSize(size: number): number {
  if (!Number.isFinite(size)) return MIN_PROOF_SIZE;
  return Math.min(MAX_PROOF_SIZE, Math.max(MIN_PROOF_SIZE, Math.round(size)));
}

/**
 * An identifier no block in the list is using.
 *
 * Counted from the list rather than from a counter kept in this module, because
 * the blocks are a preference and outlive the tab: a counter that started again
 * at one on every reload would hand out an id the stored list already had.
 */
export function blockId(blocks: readonly ProofBlock[]): string {
  const taken = new Set(blocks.map((b) => b.id));
  for (let n = 1; ; n += 1) {
    const id = `block-${String(n)}`;
    if (!taken.has(id)) return id;
  }
}

/** The ladder, every rung set the way the bar is set. */
export function ladderBlocks(
  settings: TextSettings,
  sizes: readonly number[] = PROOF_LADDER,
): ProofBlock[] {
  return sizes.map((size, index) => ({
    id: `block-${String(index + 1)}`,
    size: heldSize(size),
    settings,
  }));
}

/**
 * A block added after the last one.
 *
 * At the size the last block is set at rather than at a default, because adding
 * a block is nearly always the second half of a comparison: the same size, one
 * feature switched. Somebody who wants another size says so in the field, which
 * is one keystroke; somebody who wanted the same size would otherwise have to
 * find out what it was.
 */
export function withBlockAdded(
  blocks: readonly ProofBlock[],
  fallback: { readonly size: number; readonly settings: TextSettings },
): ProofBlock[] {
  const last = blocks[blocks.length - 1];
  return [
    ...blocks,
    {
      id: blockId(blocks),
      size: heldSize(last?.size ?? fallback.size),
      settings: last?.settings ?? fallback.settings,
    },
  ];
}

export function withBlockRemoved(blocks: readonly ProofBlock[], id: string): ProofBlock[] {
  return blocks.filter((b) => b.id !== id);
}

export function withBlockSize(
  blocks: readonly ProofBlock[],
  id: string,
  size: number,
): ProofBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, size: heldSize(size) } : b));
}

export function withBlockSettings(
  blocks: readonly ProofBlock[],
  id: string,
  settings: TextSettings,
): ProofBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, settings } : b));
}

/**
 * Whether a block is set the way the bar is, which is what decides if its rule
 * needs to say so.
 *
 * A waterfall whose rungs are all set the same way wants nothing on its rules but
 * the size; one with a block of its own settings wants to say which block that
 * is, or the comparison is between two things the page does not name.
 */
export function isPlainBlock(block: ProofBlock, settings: TextSettings): boolean {
  return sameTextSettings(block.settings, settings);
}

/**
 * What a block's rule says: its size, and the features switched by hand where
 * they differ from the rest of the page.
 *
 * Tags rather than names — `ss01` rather than "Alternate g" — because the tags
 * are what the switches are labelled with and what an application asking for the
 * feature will name, and because a rule is a line of a page rather than a legend.
 */
export function blockCaption(block: ProofBlock, settings: TextSettings): string {
  const size = `${String(Math.round(block.size))} pt`;
  if (isPlainBlock(block, settings)) return size;

  // `entries` hands over a fresh array, so sorting it in place is sorting a copy.
  const switched = Object.entries(block.settings.features)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, on]) => (on ? tag : `${tag} off`));
  return switched.length === 0 ? size : `${size} · ${switched.join(", ")}`;
}
