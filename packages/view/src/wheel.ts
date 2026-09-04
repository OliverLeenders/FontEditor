/**
 * What a wheel event means.
 *
 * One policy, in one place, because there are three surfaces that scroll — the
 * glyph canvas, the spacing strip and the proof — and three copies of "is ctrl
 * held" would drift apart the first time one of them was touched.
 *
 * Two rules, and both of them are the platform's rather than ours: a wheel with
 * ctrl (or cmd) held zooms, which is what every browser, map and drawing program
 * does, and a wheel without it scrolls the view. Shift turns a vertical wheel
 * horizontal, which is what a mouse with one wheel needs and a trackpad, sending
 * a real `deltaX`, never asks for.
 */

export type WheelIntent =
  | { readonly kind: "zoom"; readonly factor: number }
  | { readonly kind: "pan"; readonly dx: number; readonly dy: number };

/** How fast the wheel zooms: e^(delta · this). Roughly 1.15× per mouse notch. */
const ZOOM_RATE = 0.0015;

/**
 * A line of scroll in pixels, for the browsers that report lines.
 *
 * Firefox sends `deltaMode: 1` and a delta of about 3 — treating that as three
 * pixels is why a wheel can feel dead there while working normally in Chrome.
 */
const LINE_PIXELS = 16;

/** A page of scroll, for `deltaMode: 2`. Rare, but it is not a pixel either. */
const PAGE_PIXELS = 400;

/** The parts of a wheel event this needs; a real event satisfies it as it is. */
export type WheelLike = {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode?: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
};

export function wheelIntent(event: WheelLike): WheelIntent {
  const unit = event.deltaMode === 1 ? LINE_PIXELS : event.deltaMode === 2 ? PAGE_PIXELS : 1;
  const dx = event.deltaX * unit;
  const dy = event.deltaY * unit;

  if (event.ctrlKey || event.metaKey) {
    // A trackpad pinch arrives as a ctrl-wheel with a small delta, and a mouse
    // notch as a large one; the exponential is what makes both feel like the
    // same gesture, and what keeps zooming out symmetric with zooming in.
    return { kind: "zoom", factor: Math.exp(-dy * ZOOM_RATE) };
  }

  // Shift on a trackpad would otherwise turn a diagonal scroll into a doubled
  // horizontal one, so it only redirects a wheel that has nothing horizontal to
  // say for itself.
  if (event.shiftKey && dx === 0) return { kind: "pan", dx: away(dy), dy: 0 };

  return { kind: "pan", dx: away(dx), dy: away(dy) };
}

/**
 * The scroll turned into a view movement, which is the opposite direction.
 *
 * Zero is spelled out rather than negated: `-0` compares equal to `0` and prints
 * differently, which is a difference that only ever shows up in a test failure.
 */
const away = (delta: number): number => (delta === 0 ? 0 : -delta);
