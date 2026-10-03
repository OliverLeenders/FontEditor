import type { OpeningStep, StoreHost } from "./state.js";

/**
 * Saying that a font is on its way in, and how far it has got.
 *
 * Opening a large font is seconds of work — files read, a format parsed, a few
 * thousand glyphs drawn — and some of those seconds are spent on the page's own
 * thread, where nothing can be drawn while they pass. So a step is announced
 * and then *waited for*: the page is given a frame to draw the announcement in
 * before the work it announces begins, or the reader would be told what was
 * happening only once it had happened.
 */

/** Say what is being opened and which step it is at, and wait for that to be drawn. */
export async function tell(host: StoreHost, name: string, step: OpeningStep): Promise<void> {
  host.patch({ opening: { name, step, done: 0, total: 0 } });
  await painted();
}

/** Say how far the step has got. Nothing, when nothing is being opened. */
export function count(host: StoreHost, done: number, total: number): void {
  const opening = host.state().opening;
  if (opening === null) return;
  host.patch({ opening: { ...opening, done, total } });
}

/** The font is on screen, or is not going to be: there is nothing more to say. */
export function shown(host: StoreHost): void {
  if (host.state().opening !== null) host.patch({ opening: null });
}

/**
 * Wait until what has just been put in the page has been drawn.
 *
 * A frame, and then a moment past it, since the callback for a frame runs
 * before that frame is painted. A page that is not being shown gets no frames
 * at all — a tab in the background, or no browser — so the wait gives up after
 * a tenth of a second rather than holding a font back for a frame that is not
 * coming.
 */
export function painted(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      setTimeout(resolve, 0);
      return;
    }
    const giveUp = setTimeout(resolve, 100);
    requestAnimationFrame(() => {
      setTimeout(() => {
        clearTimeout(giveUp);
        resolve();
      }, 0);
    });
  });
}
