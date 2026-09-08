// @vitest-environment jsdom
import { render as renderReact } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { createElement } from "react";

import { StoreProvider } from "../src/useStore.js";
import { EditorStore } from "../src/store/index.js";

/**
 * Rendering a panel with a real store behind it.
 *
 * The store is the real one, not a double. Every one of these components is a
 * thin thing over it — read a slice, call a method — and a fake store would
 * turn each test into a check that the component calls the method the test told
 * it to expect, which proves nothing about whether pressing the button changes
 * the font.
 *
 * What is faked is only what lives outside the app: there is no storage worker,
 * so nothing is written to disk, and the pieces of the DOM jsdom does not
 * implement are stubbed here rather than in every test.
 */

/** A store on the starter font, with no storage worker attached. */
export function freshStore(): EditorStore {
  globalThis.localStorage.clear();
  return new EditorStore();
}

export type Rendered = RenderResult & { readonly store: EditorStore };

/**
 * Put a component on screen with a store behind it.
 *
 * The store is returned as well as the result, because the interesting
 * assertion is usually about the document rather than about the markup: the
 * question a panel test answers is "did pressing this change the font", and the
 * font is in the store.
 */
export function render(element: React.ReactElement, store: EditorStore = freshStore()): Rendered {
  const result = renderReact(createElement(StoreProvider, { value: store }, element));
  return Object.assign(result, { store });
}

/**
 * The browser pieces jsdom leaves out.
 *
 * `ResizeObserver` is not implemented at all, and the panels that measure
 * themselves construct one on mount. `PointerEvent` is missing its methods, so
 * a component that captures the pointer during a drag throws on the first
 * press. Neither is worth working around in the components: both are real APIs
 * that every browser has.
 */
export function installDomStubs(): void {
  const globals = globalThis as unknown as Record<string, unknown>;

  globals["ResizeObserver"] = class {
    observe(): void {
      // Nothing to report: nothing here resizes.
    }
    unobserve(): void {}
    disconnect(): void {}
  };

  if (typeof Element !== "undefined") {
    const element = Element.prototype as unknown as Record<string, unknown>;
    element["setPointerCapture"] = function (): void {};
    element["releasePointerCapture"] = function (): void {};
    element["hasPointerCapture"] = function (): boolean {
      return false;
    };
  }

  // A canvas in jsdom has no context, and asking for one prints a page of
  // "not implemented" for every test that renders a glyph cell.
  if (typeof HTMLCanvasElement !== "undefined") {
    const canvas = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
    canvas["getContext"] = function (): null {
      return null;
    };
  }
}
