/**
 * Following the reader's light or dark preference.
 *
 * One place, because four canvases wanted the same five lines and each carried
 * its own optional chaining to survive a test environment where `matchMedia` is
 * not there. The guard belongs here rather than at every call site: the DOM
 * types promise the function exists, jsdom does not provide it, and somewhere
 * has to hold that disagreement.
 *
 * Called as a method on `window` rather than pulled off it into a variable — a
 * detached `matchMedia` has no receiver, and some engines mind.
 */

const DARK = "(prefers-color-scheme: dark)";

/** The query, or `null` where the environment has no such notion. */
function darkQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(DARK) : null;
}

/** Whether the reader is in dark mode. `false` where nothing can say. */
export function prefersDark(): boolean {
  return darkQuery()?.matches ?? false;
}

/**
 * Call `onChange` whenever the preference flips, and return the way to stop.
 *
 * Returns a function even when there was nothing to listen to, so a caller's
 * cleanup never has to ask whether it subscribed.
 */
export function watchScheme(onChange: () => void): () => void {
  const query = darkQuery();
  if (query === null) return () => undefined;

  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}
