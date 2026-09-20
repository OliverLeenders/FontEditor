// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { Shortcuts, keyParts, splitKeys } = await import("../src/components/Shortcuts.js");
const { SHORTCUTS } = await import("../src/shortcuts.js");

/**
 * The sheet of keys.
 *
 * The list itself cannot be checked against anything — the keys are handled in
 * half a dozen components and there is no registry to compare with — so what is
 * asked here is that the sheet shows what the list holds, one place at a time,
 * that the filter finds a key wherever it works, and that it closes the three
 * ways every panel in this editor closes.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

const rail = () => screen.getByRole("tablist", { name: "Where the keys work" });
const page = () => screen.getByRole("tabpanel");
const places = () => within(rail()).getAllByRole("tab");
const filter = () => screen.getByLabelText<HTMLInputElement>("Filter the shortcuts");

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

describe("how a shortcut is read", () => {
  it("takes the bullet as another way of asking for the same thing", () => {
    expect(splitKeys("Ctrl-Shift-Z · Ctrl-Y")).toEqual(["Ctrl-Shift-Z", "Ctrl-Y"]);
    expect(splitKeys("Ctrl-Z")).toEqual(["Ctrl-Z"]);
  });

  it("tells the keys of a gesture from the words around them", () => {
    // A cap on the sheet always means something to press.
    expect(keyParts("M held")).toEqual([
      { text: "M", key: true },
      { text: "held", key: false },
    ]);
    expect(keyParts("Alt-drag a handle")).toEqual([
      { text: "Alt-drag", key: true },
      { text: "a handle", key: false },
    ]);
    expect(keyParts("Escape then Tab")).toEqual([
      { text: "Escape", key: true },
      { text: "then", key: false },
      { text: "Tab", key: true },
    ]);
  });

  it("keeps a key of two words as one key", () => {
    expect(keyParts("Page Up")).toEqual([{ text: "Page Up", key: true }]);
  });

  it("takes a list of keys as a list of keys", () => {
    expect(keyParts("V P K R E L").every((part) => part.key)).toBe(true);
    expect(keyParts("V P K R E L")).toHaveLength(6);
  });
});

describe("the sheet", () => {
  it("offers every place, and shows the first of them", () => {
    render(<Shortcuts onClose={() => undefined} />);

    expect(places().map((tab) => tab.textContent)).toEqual(
      SHORTCUTS.map((group) => `${group.title}${String(group.items.length)}`),
    );
    expect(places()[0]!.getAttribute("aria-selected")).toBe("true");

    const first = SHORTCUTS[0]!;
    expect(within(page()).getByText(first.title)).toBeTruthy();
    for (const item of first.items) {
      expect(within(page()).getAllByText(item.what).length).toBeGreaterThan(0);
    }
  });

  it("shows one place at a time, and turns to the one chosen", () => {
    render(<Shortcuts onClose={() => undefined} />);
    const canvas = SHORTCUTS.find((group) => group.title === "The canvas")!;
    expect(within(page()).queryByText(canvas.items[0]!.what)).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /^The canvas/ }));

    expect(within(page()).getByText(canvas.items[0]!.what)).toBeTruthy();
    expect(within(page()).queryByText(SHORTCUTS[0]!.items[0]!.what)).toBeNull();
  });

  it("walks the rail with the arrow keys, as a list of tabs is walked", () => {
    render(<Shortcuts onClose={() => undefined} />);

    fireEvent.keyDown(rail(), { key: "ArrowDown" });
    expect(places()[1]!.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(rail(), { key: "End" });
    expect(places()[places().length - 1]!.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(rail(), { key: "Home" });
    expect(places()[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("filters every place at once, and says how much each one has left", () => {
    render(<Shortcuts onClose={() => undefined} />);

    fireEvent.change(filter(), { target: { value: "kern" } });

    const counts = places().map((tab) => Number(/\d+$/.exec(tab.textContent)?.[0] ?? "0"));
    expect(counts.reduce((sum, each) => sum + each, 0)).toBeGreaterThan(0);
    // The place it is in is the one showing, wherever it was in the rail.
    expect(within(page()).getByText(/kern/i)).toBeTruthy();
  });

  it("moves off a place the filter has emptied", () => {
    render(<Shortcuts onClose={() => undefined} />);
    // "Undo" is in the first place, "kern" is not: the sheet turns to where the
    // answer is rather than showing an empty page.
    fireEvent.change(filter(), { target: { value: "kern" } });

    expect(places()[0]!.getAttribute("aria-selected")).toBe("false");
    expect(places().find((tab) => tab.getAttribute("aria-selected") === "true")).toBeTruthy();
  });

  it("says so when nothing matches at all", () => {
    render(<Shortcuts onClose={() => undefined} />);

    fireEvent.change(filter(), { target: { value: "xyzzy" } });

    expect(screen.getByText(/No key matches/)).toBeTruthy();
    expect(places().every((tab) => tab.hasAttribute("data-empty"))).toBe(true);
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
