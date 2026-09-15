// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TabBar } from "../src/components/TabBar.js";

/**
 * The bar of workspaces, in a window of one and in each pane of two.
 *
 * What is asked of it is what somebody using it would ask: which workspaces
 * are offered, which one is showing, and what the controls at the end of the
 * bar do — split the window, stack its panes, close one.
 */

afterEach(() => {
  cleanup();
});

describe("the workspace bar", () => {
  it("offers every workspace and says which one is showing", () => {
    render(<TabBar current="spacing" onSelect={() => {}} glyphName="a" />);

    for (const name of ["Font", "Spacing", "Features", "Proof"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: /^Glyph/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Spacing" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("chooses a workspace", () => {
    const onSelect = vi.fn();
    render(<TabBar current="font" onSelect={onSelect} glyphName="" />);

    fireEvent.click(screen.getByRole("button", { name: "Proof" }));

    expect(onSelect).toHaveBeenCalledWith("proof");
  });

  it("offers to split a window of one, and nothing else", () => {
    const onSplit = vi.fn();
    render(<TabBar current="font" onSelect={() => {}} glyphName="" onSplit={onSplit} />);

    fireEvent.click(screen.getByRole("button", { name: "Split the window" }));

    expect(onSplit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Close this pane" })).toBeNull();
  });

  it("offers nothing at the end of a bar that was given nothing to offer", () => {
    render(<TabBar current="font" onSelect={() => {}} glyphName="" />);

    expect(screen.queryByRole("button", { name: "Split the window" })).toBeNull();
  });

  it("lets the second pane stack the panes and close itself", () => {
    const onFlip = vi.fn();
    const onClose = vi.fn();
    render(
      <TabBar
        current="glyph"
        onSelect={() => {}}
        glyphName="a"
        orientation="row"
        onFlip={onFlip}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stack the panes" }));
    fireEvent.click(screen.getByRole("button", { name: "Close this pane" }));

    expect(onFlip).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers to put stacked panes back side by side", () => {
    render(
      <TabBar
        current="glyph"
        onSelect={() => {}}
        glyphName="a"
        orientation="column"
        onFlip={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Put the panes side by side" })).toBeTruthy();
  });

  it("marks the pane the keyboard is in, and only that one", () => {
    render(
      <>
        <TabBar
          current="font"
          onSelect={() => {}}
          glyphName=""
          label="Workspaces in the first pane"
        />
        <TabBar
          current="glyph"
          onSelect={() => {}}
          glyphName=""
          label="Workspaces in the second pane"
          active
        />
      </>,
    );

    const first = screen.getByRole("navigation", { name: "Workspaces in the first pane" });
    const second = screen.getByRole("navigation", { name: "Workspaces in the second pane" });
    expect(first.hasAttribute("data-active")).toBe(false);
    expect(second.hasAttribute("data-active")).toBe(true);
  });
});
