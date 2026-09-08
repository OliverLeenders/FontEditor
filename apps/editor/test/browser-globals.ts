/**
 * The handful of browser globals the app layer reaches for.
 *
 * Stubbed rather than brought in with a DOM implementation. The store touches
 * `localStorage` and the window size; the scene builder asks for the colour
 * scheme. That is the whole surface, and a jsdom dependency to supply three
 * properties would cost more than it explains.
 *
 * Call this before importing any module under test — `loadInspector` runs while
 * the store is being constructed.
 */
export function installBrowserGlobals(
  options: { width?: number; height?: number; dark?: boolean } = {},
): void {
  const store = new Map<string, string>();

  const globals = globalThis as unknown as Record<string, unknown>;
  // jsdom brings its own, which works and is per-test-file already.
  if (globals["localStorage"] === undefined)
    globals["localStorage"] = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    };

  const matchMedia = (query: string) => ({
    matches: (options.dark ?? false) && query.includes("dark"),
    media: query,
  });

  // In a DOM environment there is already a window, and replacing it with three
  // properties would take React's out from under it. So the missing pieces are
  // added to whatever is there, and the whole object is only invented where
  // there is none — which is the node tests, where nothing renders.
  const existing = globals["window"];
  if (existing !== undefined && existing !== null) {
    const window = existing as Record<string, unknown>;
    if (typeof window["matchMedia"] !== "function") window["matchMedia"] = matchMedia;
    return;
  }

  globals["window"] = {
    innerWidth: options.width ?? 1200,
    innerHeight: options.height ?? 800,
    matchMedia,
  };
}

/** Forget anything a previous test wrote, without tearing the stubs down. */
export function clearStoredSettings(): void {
  const globals = globalThis as unknown as {
    localStorage?: { clear: () => void };
  };
  globals.localStorage?.clear();
}
