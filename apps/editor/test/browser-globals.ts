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
  globals["localStorage"] = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };

  globals["window"] = {
    innerWidth: options.width ?? 1200,
    innerHeight: options.height ?? 800,
    matchMedia: (query: string) => ({
      matches: (options.dark ?? false) && query.includes("dark"),
      media: query,
    }),
  };
}

/** Forget anything a previous test wrote, without tearing the stubs down. */
export function clearStoredSettings(): void {
  const globals = globalThis as unknown as {
    localStorage?: { clear: () => void };
  };
  globals.localStorage?.clear();
}
