// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { Shortcuts } = await import("../src/components/Shortcuts.js");
const { SHORTCUTS } = await import("../src/shortcuts.js");

/**
 * The sheet of keys.
 *
 * The list itself cannot be checked against anything — the keys are handled in
 * half a dozen components and there is no registry to compare with — so what is
 * asked here is that the sheet shows what the list holds and closes the three
 * ways every panel in this editor closes.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

describe("the list itself", () => {
  it("has a group for each place keys work, and none of them empty", () => {
    expect(SHORTCUTS.length).toBeGreaterThan(1);
    for (const group of SHORTCUTS) {
      expect(group.title).not.toBe("");
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(item.keys).not.toBe("");
        expect(item.what).not.toBe("");
      }
    }
  });

  it("names no key twice within a group", () => {
    // The rows are keyed by the key, so a repeat would silently vanish.
    for (const group of SHORTCUTS) {
      const keys = group.items.map((item) => item.keys);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("the sheet", () => {
  it("shows every group and every key", () => {
    render(<Shortcuts onClose={() => undefined} />);

    for (const group of SHORTCUTS) {
      expect(screen.getByText(group.title)).toBeTruthy();
      for (const item of group.items) {
        expect(screen.getAllByText(item.keys).length).toBeGreaterThan(0);
      }
    }
  });

  it("closes on Escape", () => {
    let closed = 0;
    render(<Shortcuts onClose={() => (closed += 1)} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(closed).toBe(1);
  });

  it("closes on the button", () => {
    let closed = 0;
    render(<Shortcuts onClose={() => (closed += 1)} />);

    fireEvent.click(screen.getByRole("button", { name: "Close the shortcuts" }));

    expect(closed).toBe(1);
  });

  it("closes on a press outside it, and not on one inside", () => {
    let closed = 0;
    render(<Shortcuts onClose={() => (closed += 1)} />);

    fireEvent.pointerDown(screen.getByRole("dialog"));
    expect(closed).toBe(0);

    fireEvent.pointerDown(screen.getByRole("presentation"));
    expect(closed).toBe(1);
  });
});
