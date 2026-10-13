// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ViewBoundary } from "../src/components/ViewBoundary.js";

/**
 * A workspace that throws while it is drawn.
 *
 * Nothing caught it, and React takes down everything above what nothing
 * catches: the window went blank. What is asked here is that it takes its own
 * pane and no more, says what happened and that the font is as it was, and can
 * be drawn again.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A view that throws for as long as it is told to. */
function Fragile({ broken }: { broken: { now: boolean } }): React.JSX.Element {
  if (broken.now) throw new TypeError("cannot read 'pt' of undefined");
  return <p>the drawing</p>;
}

describe("a view that throws while it is drawn", () => {
  it("is replaced by what happened, and what is beside it stays", () => {
    // React says what it caught on the console as well; not what is asked about.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const told = vi.fn();

    render(
      <>
        <p>the status line</p>
        <ViewBoundary onError={told}>
          <Fragile broken={{ now: true }} />
        </ViewBoundary>
      </>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("This view stopped working.");
    expect(alert.textContent).toContain("Your font is not affected: it is saved as it was.");
    expect(alert.textContent).toContain("TypeError: cannot read 'pt' of undefined");
    expect(screen.getByText("the status line")).toBeTruthy();
    expect(told).toHaveBeenCalledTimes(1);
    expect(told.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
  });

  it("is drawn again when asked, and stays if it throws again", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { now: true };
    render(
      <ViewBoundary>
        <Fragile broken={broken} />
      </ViewBoundary>,
    );

    // Still broken: asked again, it says so again.
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("alert")).toBeTruthy();

    broken.now = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("the drawing")).toBeTruthy();
  });

  it("draws what it holds, and nothing of its own, while nothing is wrong", () => {
    const { container } = render(
      <ViewBoundary>
        <p>the drawing</p>
      </ViewBoundary>,
    );
    expect(container.innerHTML).toBe("<p>the drawing</p>");
  });
});
