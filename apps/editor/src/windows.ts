import { desktop } from "./desktop.js";

/**
 * Windows: opening another, and knowing what this one was opened for.
 *
 * Two fonts side by side are two windows, each the whole editor on one font —
 * its own working copy, lock, undo and panes — which is what a second browser
 * tab on the same origin always was. What was missing was a way to ask for
 * one, and a way for the new window to know what it was asked to show without
 * going through the list of fonts first.
 *
 * The request travels in the address: `?font=<id>` for a font, `?fonts` for
 * the list. A browser opens that address in a new tab; the desktop application
 * opens it in a window of its own. The page reads it once on the way in and
 * takes it out of the address, so reloading the window later starts the way
 * any start does rather than going back to what it was first opened on.
 */

/** What a window is opened on: one font, or the list of them. */
export type WindowRequest = { readonly font: string } | "fonts";

/** Open another window. */
export function openWindow(request: WindowRequest): void {
  const host = desktop();
  if (host === null) {
    window.open(`${location.pathname}${searchFor(request)}`, "_blank");
    return;
  }
  void host.invoke("open_window", request === "fonts" ? {} : { font: request.font }).catch(() => {
    // A window that could not be made has nothing to show; the one that asked
    // stays as it was.
  });
}

/** The address a request is made in. */
export function searchFor(request: WindowRequest): string {
  return request === "fonts" ? "?fonts" : `?font=${encodeURIComponent(request.font)}`;
}

/** What an address asks a window to show, if anything. */
export function requestIn(search: string): WindowRequest | null {
  const params = new URLSearchParams(search);
  const font = params.get("font");
  if (font !== null && font !== "") return { font };
  return params.has("fonts") ? "fonts" : null;
}

/**
 * What this window was opened to show, read once and taken out of the address.
 *
 * `null` for a window opened the ordinary way, and outside a page altogether.
 */
export function takeWindowRequest(): WindowRequest | null {
  if (typeof location === "undefined") return null;
  const request = requestIn(location.search);
  if (request !== null) history.replaceState(null, "", `${location.pathname}${location.hash}`);
  return request;
}
