// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { SpacingView, missingText } = await import("../src/components/SpacingView.js");

/**
 * The spacing line saying what it has left out.
 *
 * A character or a name the font has no glyph for is passed over in the line,
 * since a box nobody drew is a width nobody can trust. That left a mistyped
 * name looking exactly like a glyph that would not show, so the line says what
 * it had nothing for, beside itself.
 */

beforeAll(() => {
  installDomStubs();
  // The surface refuses to exist without a context, and jsdom provides none.
  const canvas = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  canvas["getContext"] = (): unknown =>
    new Proxy(
      {
        measureText: () => ({ width: 0 }),
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      },
      {
        get: (target, key) =>
          key in target ? target[key as keyof typeof target] : () => undefined,
      },
    );
  const globals = globalThis as unknown as Record<string, unknown>;
  if (typeof globals["requestAnimationFrame"] !== "function") {
    globals["requestAnimationFrame"] = (run: () => void): number =>
      setTimeout(run, 16) as unknown as number;
    globals["cancelAnimationFrame"] = (id: number): void => clearTimeout(id);
  }
});

afterEach(() => {
  cleanup();
});

/** The line on some text; the starter font has h, e, l, o, c, i, n and space. */
function spacing(text: string) {
  const store = freshStore();
  store.setSpacingText(text);
  render(<SpacingView onOpenGlyph={() => undefined} />, store);
  return { store, field: screen.getByLabelText("Text to space") };
}

const said = (): string | null => screen.queryByText(/^No glyph for /)?.textContent ?? null;

describe("the spacing line, on text the font has not all of", () => {
  it("says nothing where every piece has a glyph", () => {
    spacing("hello/n /U+006F");
    expect(said()).toBeNull();
  });

  it("names a glyph asked for by a name the font has not got", () => {
    spacing("hello/uni03B1");
    expect(said()).toBe("No glyph for /uni03B1");
  });

  it("names each piece once, as it was typed, characters and names alike", () => {
    spacing("hexxo/a.001 /a.001");
    expect(said()).toBe("No glyph for x /a.001");
  });

  it("stops saying it once the text is mended", () => {
    const { field } = spacing("hel/nothing");
    expect(said()).toBe("No glyph for /nothing");

    fireEvent.change(field, { target: { value: "hel/o" } });
    expect(said()).toBeNull();
  });
});

describe("what is said of the pieces left out", () => {
  it("names a few and counts the rest", () => {
    expect(missingText(["a", "b"])).toBe("No glyph for a b");
    expect(missingText(["a", "b", "c", "d", "e", "f"])).toBe("No glyph for a b c d and 2 more");
  });
});
