// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { StatusBar } = await import("../src/components/StatusBar.js");

/**
 * The line along the bottom, which is the only place the editor tells anybody
 * what the keys do.
 *
 * A hint is either true of the workspace on screen or it is a lie, and this
 * used to be a lie in three of the five: everything that was not the glyph
 * canvas was told it was the glyph browser, and offered to open a letter by
 * double-clicking something that was not on screen.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

describe("what the status bar says the keys do", () => {
  it("names the canvas keys while drawing", () => {
    render(<StatusBar workspace="glyph" />);
    expect(screen.getByText(/hold M to measure/)).toBeTruthy();
  });

  it("names the browser keys in the font view", () => {
    render(<StatusBar workspace="font" />);
    expect(screen.getByText(/double-click a glyph/)).toBeTruthy();
  });

  it("says nothing where the workspace speaks for itself", () => {
    // Spacing has its own line of instructions under the strip; a second set
    // down here would be a repetition at best and a disagreement at worst.
    for (const workspace of ["spacing", "features", "proof"] as const) {
      render(<StatusBar workspace={workspace} />);
      expect(screen.queryByText(/double-click a glyph/)).toBeNull();
      expect(screen.queryByText(/hold M to measure/)).toBeNull();
      cleanup();
    }
  });
});

describe("what the status bar counts", () => {
  it("counts the selection only where there is a canvas to select on", () => {
    render(<StatusBar workspace="glyph" />);
    expect(screen.getByText("selected")).toBeTruthy();

    cleanup();
    render(<StatusBar workspace="font" />);
    expect(screen.queryByText("selected")).toBeNull();
  });
});
