import { createContext, useContext, useSyncExternalStore } from "react";

import type { EditorStore, StoreState } from "./store.js";

const StoreContext = createContext<EditorStore | null>(null);

export const StoreProvider = StoreContext.Provider;

export function useEditorStore(): EditorStore {
  const store = useContext(StoreContext);
  if (store === null) throw new Error("useEditorStore used outside a StoreProvider.");
  return store;
}

/**
 * Subscribe to one slice of the store.
 *
 * The selector must return a primitive or a reference that lives in the state,
 * never a fresh object or array. React compares snapshots with `Object.is`, so a
 * newly built value looks different every time and the component re-renders on
 * every change — or, worse, loops. Where a component needs several values, take
 * them with several calls rather than bundling them into an object.
 */
export function useStoreValue<T>(select: (state: StoreState) => T): T {
  const store = useEditorStore();
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getState()),
    () => select(store.getState()),
  );
}
