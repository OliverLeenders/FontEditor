// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { BarMenu } = await import("../src/components/BarMenu.js");

/**
 * The disclosure every panel and menu in the bar is built on.
 *
 * Six panels used to carry their own copy of these rules, and two of them had
 * already drifted — one closed on an outside press and one did not, one closed
 * on Escape while a field was being edited and one deliberately did not. The
 * rules are worth a test now that there is only one of them: everything in the
 * bar opens and closes the same way, and a change here changes all of it.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

describe("opening and closing", () => {
  it("shows what it holds only once it is asked", () => {
    render(
      <BarMenu label="Things" panelLabel="Things">
        <p>inside</p>
      </BarMenu>,
    );
    expect(screen.queryByText("inside")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Things" }));

    expect(screen.getByText("inside")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Things" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("closes on a press somewhere else", () => {
    render(
      <BarMenu label="Things" panelLabel="Things">
        <p>inside</p>
      </BarMenu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Things" }));

    fireEvent.pointerDown(window.document.body);

    expect(screen.queryByText("inside")).toBeNull();
  });

  it("stays open through a press elsewhere when it says it should", () => {
    // The sheet: a box is drawn in it by dragging, and a drag that ends outside
    // the panel is part of the work rather than a way of leaving.
    render(
      <BarMenu label="Sheet" panelLabel="Sheet" closeOnOutside={false}>
        <p>inside</p>
      </BarMenu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sheet" }));

    fireEvent.pointerDown(window.document.body);

    expect(screen.getByText("inside")).toBeTruthy();
  });

  it("closes on Escape", () => {
    render(
      <BarMenu label="Things" panelLabel="Things">
        <p>inside</p>
      </BarMenu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Things" }));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByText("inside")).toBeNull();
  });

  it("leaves Escape to a field that has it", () => {
    // Otherwise one press both abandons the edit and closes the panel, which is
    // two things happening for one key — the bug this rule was written for.
    render(
      <BarMenu label="Things" panelLabel="Things">
        <input aria-label="A field" defaultValue="x" />
      </BarMenu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Things" }));

    fireEvent.keyDown(screen.getByLabelText("A field"), { key: "Escape" });

    expect(screen.getByLabelText("A field")).toBeTruthy();
  });

  it("reads what it needs when it opens, and not before", () => {
    let reads = 0;
    render(
      <BarMenu label="Things" panelLabel="Things" onOpen={() => (reads += 1)}>
        <p>inside</p>
      </BarMenu>,
    );
    expect(reads).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Things" }));
    expect(reads).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Things" }));
    fireEvent.click(screen.getByRole("button", { name: "Things" }));
    expect(reads).toBe(2);
  });
});

describe("a menu rather than a panel", () => {
  it("runs the item and closes", () => {
    let ran = 0;
    render(
      <BarMenu
        label="Do"
        panelLabel="Do"
        items={[
          { kind: "item", label: "Something", run: () => (ran += 1) },
          { kind: "separator" },
          { kind: "item", label: "Nothing", disabled: true, run: () => (ran += 100) },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Do" }));

    expect(
      screen.getByRole<HTMLButtonElement>("menuitemcheckbox", { name: "Nothing" }).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Something" }));

    expect(ran).toBe(1);
    expect(screen.queryByRole("menuitemcheckbox", { name: "Something" })).toBeNull();
  });
});
