/**
 * The ranges the interface offers, in one place.
 *
 * Apart from the store because the preferences are read before the store is
 * built and have to clamp what they find — a remembered outline weight from an
 * older version, or a hand-edited storage entry, must land inside the range the
 * slider can express, or the handle sits pinned at one end lying about the
 * value behind it.
 */

/** The stroke the renderer has always used, and the range the control offers. */
export const DEFAULT_OUTLINE_WIDTH = 2;
export const MIN_OUTLINE_WIDTH = 0.5;
export const MAX_OUTLINE_WIDTH = 6;

/**
 * The type sizes the spacing line and the proof will show.
 *
 * Shared with the wheel, which sets them too: a wheel that could go somewhere
 * the slider cannot would leave the handle pinned at one end while the text kept
 * growing.
 */
export const MIN_SPACING_SIZE = 24;
export const MAX_SPACING_SIZE = 320;
export const MIN_PROOF_SIZE = 8;
export const MAX_PROOF_SIZE = 140;

/** Line spacing, as a multiple of the em. */
export const MIN_PROOF_LEADING = 0.8;
export const MAX_PROOF_LEADING = 2.4;
