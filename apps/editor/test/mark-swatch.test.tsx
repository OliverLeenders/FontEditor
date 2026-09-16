// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { markSwatch } = await import("../src/components/MarkSwatch.js");

/**
 * A mark colour as a menu icon.
 *
 * Small enough that the only things worth asking are the two it exists for: the
 * square is filled with the colour the glyph is marked with, and the same colour
 * gives back the same component — a new one per render would be a new element
 * type per render, and the menu would remount its icons as it drew.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

const fillOf = (value: string): string | null => {
  const Swatch = markSwatch(value);
  const { container } = render(<Swatch />);
  return container.querySelector("rect")?.getAttribute("fill") ?? null;
};

describe("a mark colour drawn as an icon", () => {
  it("fills the square with the colour, as a font writes it", () => {
    expect(fillOf("1,0,0,1")).toBe("rgba(255, 0, 0, 1)");
    expect(fillOf("0,0.5,1,0.5")).toBe("rgba(0, 128, 255, 0.5)");
  });

  it("fills nothing for a value that is not a colour", () => {
    // A source may carry anything in that key, and a swatch is not the place to
    // report it: "no colour" is the honest drawing of an unreadable one.
    expect(fillOf("bright red")).toBe("none");
  });

  it("gives the same colour the same component, so a menu does not remount it", () => {
    expect(markSwatch("1,0,0,1")).toBe(markSwatch("1,0,0,1"));
    expect(markSwatch("1,0,0,1")).not.toBe(markSwatch("0,1,0,1"));
  });
});
