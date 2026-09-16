// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { MenuItems } = await import("../src/components/MenuItems.js");
const { CheckIcon, TrashIcon } = await import("../src/components/icons.js");

/**
 * The rows every menu in the editor is made of.
 *
 * One rendering for the canvas menu and the bar menus, so what is asked here is
 * what both rely on: that choosing an item runs it and then closes the menu,
 * that an item which is a state says whether it is on, that a disabled one does
 * neither, and that a separator is a separator to a screen reader rather than a
 * line somebody can press.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

describe("a menu's rows", () => {
  it("runs the item and then closes the menu", () => {
    const run = vi.fn();
    const onChose = vi.fn();
    render(<MenuItems items={[{ kind: "item", label: "Delete", run }]} onChose={onChose} />);

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Delete" }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(onChose).toHaveBeenCalledTimes(1);
  });

  it("says whether an item that is a state is on", () => {
    render(
      <MenuItems
        items={[
          { kind: "item", label: "Snap", run: () => undefined, checked: true },
          { kind: "item", label: "Handles", run: () => undefined, checked: false },
        ]}
        onChose={() => undefined}
      />,
    );

    expect(
      screen.getByRole("menuitemcheckbox", { name: "Snap" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Handles" }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("does nothing at all when the item is shown but not usable", () => {
    const run = vi.fn();
    const onChose = vi.fn();
    render(
      <MenuItems
        items={[{ kind: "item", label: "Paste", run, disabled: true }]}
        onChose={onChose}
      />,
    );

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Paste" }));

    expect(run).not.toHaveBeenCalled();
    expect(onChose).not.toHaveBeenCalled();
  });

  it("reads the note after the label, with a space between", () => {
    render(
      <MenuItems
        items={[{ kind: "item", label: "Save", run: () => undefined, note: "Ctrl-S" }]}
        onChose={() => undefined}
      />,
    );

    expect(screen.getByRole("menuitemcheckbox", { name: "Save Ctrl-S" })).toBeTruthy();
  });

  it("keeps a sentence about an item out of the row and on the hover", () => {
    render(
      <MenuItems
        items={[
          {
            kind: "item",
            label: "Remove overlap",
            run: () => undefined,
            hint: "Replace the contours with their outline",
          },
        ]}
        onChose={() => undefined}
      />,
    );

    const item = screen.getByRole("menuitemcheckbox", { name: "Remove overlap" });
    expect(item.getAttribute("title")).toBe("Replace the contours with their outline");
    expect(item.textContent).toBe("Remove overlap");
  });

  it("puts a separator between groups, which nobody can press", () => {
    render(
      <MenuItems
        items={[
          { kind: "item", label: "Copy", run: () => undefined },
          { kind: "separator" },
          { kind: "item", label: "Delete", run: () => undefined },
        ]}
        onChose={() => undefined}
      />,
    );

    expect(screen.getByRole("separator")).toBeTruthy();
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(2);
  });

  it("gives the tick the column the icon would have used, for a checked item", () => {
    // Both are drawings in the same place, and an item with both would be a row
    // whose state and whose action are shown in one square.
    render(
      <MenuItems
        items={[
          { kind: "item", label: "Snap", icon: TrashIcon, run: () => undefined, checked: true },
          { kind: "item", label: "Delete", icon: TrashIcon, run: () => undefined },
        ]}
        onChose={() => undefined}
      />,
    );

    const svgOf = (name: string) =>
      screen.getByRole("menuitemcheckbox", { name }).querySelector("svg")?.innerHTML ?? "";
    const tick = render(<CheckIcon />).container.querySelector("svg")?.innerHTML ?? "";

    expect(svgOf("Snap")).toBe(tick);
    expect(svgOf("Delete")).not.toBe(tick);
  });
});
