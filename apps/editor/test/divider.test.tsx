// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Divider } from "../src/components/Divider.js";
import { MAX_SPLIT_RATIO, MIN_SPLIT_RATIO } from "../src/preferences.js";

/**
 * The line between two panes, from the keyboard.
 *
 * Dragging needs a layout jsdom does not have; the keys are the same control
 * reached another way, and say what the divider reports: the first pane's share.
 */

afterEach(() => {
  cleanup();
});

const divider = () => screen.getByRole("separator", { name: "Pane size" });

describe("the divider between panes", () => {
  it("says where it is, as a percentage", () => {
    render(<Divider orientation="row" ratio={0.35} onRatio={() => {}} />);

    expect(divider().getAttribute("aria-valuenow")).toBe("35");
    expect(divider().getAttribute("aria-orientation")).toBe("vertical");
  });

  it("moves a step with the arrows across panes side by side", () => {
    const onRatio = vi.fn<(ratio: number) => void>();
    render(<Divider orientation="row" ratio={0.5} onRatio={onRatio} />);

    fireEvent.keyDown(divider(), { key: "ArrowRight" });
    fireEvent.keyDown(divider(), { key: "ArrowLeft" });
    // Up and down mean nothing to a line that runs up and down.
    fireEvent.keyDown(divider(), { key: "ArrowUp" });

    expect(onRatio.mock.calls.map(([ratio]) => ratio)).toEqual([0.55, 0.45]);
  });

  it("moves with up and down between stacked panes", () => {
    const onRatio = vi.fn<(ratio: number) => void>();
    render(<Divider orientation="column" ratio={0.5} onRatio={onRatio} />);

    fireEvent.keyDown(divider(), { key: "ArrowDown" });

    expect(divider().getAttribute("aria-orientation")).toBe("horizontal");
    expect(onRatio).toHaveBeenCalledWith(0.55);
  });

  it("goes to either limit with Home and End, and back to the middle on a double-click", () => {
    const onRatio = vi.fn<(ratio: number) => void>();
    render(<Divider orientation="row" ratio={0.5} onRatio={onRatio} />);

    fireEvent.keyDown(divider(), { key: "Home" });
    fireEvent.keyDown(divider(), { key: "End" });
    fireEvent.doubleClick(divider());

    expect(onRatio.mock.calls.map(([ratio]) => ratio)).toEqual([
      MIN_SPLIT_RATIO,
      MAX_SPLIT_RATIO,
      0.5,
    ]);
  });
});
