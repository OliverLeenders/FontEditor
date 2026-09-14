/**
 * The desktop application's side of the page, when there is one.
 *
 * Tauri injects `__TAURI_INTERNALS__` into every page it hosts, whatever the
 * configuration says, and its `invoke` reaches the commands the application
 * defines. That is the whole of what the editor needs from the desktop — two
 * commands about closing the window, and one that hints a font — which is why
 * this is a dozen lines here rather than a dependency on `@tauri-apps/api`.
 *
 * A payload of bytes is sent as bytes rather than as a list of numbers, which
 * matters for a font: the command reads it as the raw body of the request.
 *
 * `null` in a browser, where none of it exists and nothing here should run.
 */
export type Desktop = {
  readonly invoke: (
    command: string,
    payload?: Record<string, unknown> | ArrayBuffer | Uint8Array,
  ) => Promise<unknown>;
};

export function desktop(): Desktop | null {
  return (globalThis as { __TAURI_INTERNALS__?: Desktop }).__TAURI_INTERNALS__ ?? null;
}
