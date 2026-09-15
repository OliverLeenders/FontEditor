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

/**
 * The size the feature source is set at, in pixels.
 *
 * Ctrl and the wheel set it, so a file can be read from across the room or a
 * long one taken in whole; the limits keep it readable at one end and the
 * gutter from outgrowing the pane at the other.
 */
export const DEFAULT_FEATURE_SIZE = 13.5;
export const MIN_FEATURE_SIZE = 9;
export const MAX_FEATURE_SIZE = 32;

/** Line spacing, as a multiple of the em. */
export const MIN_PROOF_LEADING = 0.8;
export const MAX_PROOF_LEADING = 2.4;
