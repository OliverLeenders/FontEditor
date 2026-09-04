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

import type { ThemeChoice } from "./preferences.js";

const DARK = "(prefers-color-scheme: dark)";

/** The query, or `null` where the environment has no such notion. */
function darkQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(DARK) : null;
}

/** Whether the machine is set to dark. `false` where nothing can say. */
export function prefersDark(): boolean {
  return darkQuery()?.matches ?? false;
}

/**
 * Whether the editor is dark right now.
 *
 * The one answer both the stylesheet and the canvas palette use, so they cannot
 * disagree — a light interface around a dark canvas is the bug this exists to
 * make impossible. "system" is not a third look but the absence of a choice, and
 * defers to the machine as the editor always has.
 */
export function isDark(theme: ThemeChoice): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return prefersDark();
}

/**
 * The choice in force, held here rather than passed around.
 *
 * Ambient on purpose, and for the same reason `prefers-color-scheme` is: the
 * four canvases ask "am I dark" while painting a frame, from inside callbacks
 * that have no props. Threading a theme through each of them would put the same
 * value in four places and let three of them go stale. There is exactly one
 * writer, `applyTheme`, called from the app when the preference changes.
 */
let chosen: ThemeChoice = "system";

/**
 * Adopt a theme: stamp the document, and answer `isDarkNow` with it.
 *
 * The stamp is what `tokens.css` reads. "system" removes it, leaving the media
 * query to answer — which is the difference between choosing the light theme
 * and not having chosen.
 */
export function applyTheme(theme: ThemeChoice): void {
  chosen = theme;
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/** Whether what is on screen right now is dark. */
export function isDarkNow(): boolean {
  return isDark(chosen);
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
