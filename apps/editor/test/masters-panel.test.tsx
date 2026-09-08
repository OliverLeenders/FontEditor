// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { Masters } = await import("../src/components/Masters.js");
const { WEIGHT, master, project, setAxes } = await import("@fonteditor/font-model");

/**
 * The drawings of a typeface, in the bar.
 *
 * There is no storage worker here, so nothing is parked and nothing can be read
 * back — which means the tests are about what the panel *says* rather than
 * about switching, and switching is tested where it lives. What is worth asking
 * here is that a font with one master looks like a font rather than like a
 * family, and that a designspace with several is read the way a designer reads
 * it: lightest first, with where each one sits.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** A store whose project has three masters along the weight axis. */
function withThree() {
  const store = freshStore();
  act(() => {
    const one = setAxes(project(store.editor.document, { id: "m1" }), [WEIGHT]);
    store.patch({
      project: {
        ...one,
        masters: [
          master("m1", "Regular", { wght: 400 }),
          master("m3", "Black", { wght: 900 }),
          master("m2", "Thin", { wght: 100 }),
        ],
      },
    });
  });
  return store;
}

const openPanel = (store = freshStore()) => {
  const shown = render(<Masters />, store);
  fireEvent.click(screen.getByRole("button", { name: /^Masters/ }));
  return shown;
};

describe("a font with one drawing of itself", () => {
  it("does not put a name in the button, there being nothing to choose", () => {
    render(<Masters />);
    expect(screen.getByRole("button", { name: "Masters" })).toBeTruthy();
  });

  it("lists the one it has, and says it is the one being drawn", () => {
    openPanel();

    expect(screen.getByRole("button", { name: "drawing" })).toBeTruthy();
    // Nothing to go to, and nothing to compare against.
    expect(screen.queryByRole("button", { name: "Draw" })).toBeNull();
  });

  it("will not let it be removed", () => {
    openPanel();
    const drop = screen.getByLabelText("Remove the master Regular");

    expect((drop as HTMLButtonElement).disabled).toBe(true);
    expect(drop.title).toMatch(/at least one master/);
  });
});

describe("a font drawn several times", () => {
  it("says which one is in front of you, in the bar", () => {
    withThreeRendered();
    expect(screen.getByRole("button", { name: "Masters · Regular" })).toBeTruthy();
  });

  it("lists them lightest first, whatever order they were made in", () => {
    withThreeRendered();
    const names = screen.getAllByRole("textbox").map((input) => (input as HTMLInputElement).value);

    expect(names).toEqual(["Thin", "Regular", "Black"]);
  });

  it("says where each one sits on the axes", () => {
    withThreeRendered();

    expect(screen.getByText("Weight 100")).toBeTruthy();
    expect(screen.getByText("Weight 900")).toBeTruthy();
  });

  it("offers a way to each of the others, and not to the one you are in", () => {
    withThreeRendered();

    expect(screen.getAllByRole("button", { name: "Draw" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "drawing" })).toBeTruthy();
  });

  it("offers to compare with each of the others", () => {
    withThreeRendered();
    expect(screen.getAllByRole("button", { name: "Check" })).toHaveLength(3);
    // The one you are in cannot be compared with itself.
    const enabled = screen
      .getAllByRole("button", { name: "Check" })
      .filter((b) => !(b as HTMLButtonElement).disabled);
    expect(enabled).toHaveLength(2);
  });

  it("renames one in place", () => {
    const store = withThreeRendered();

    fireEvent.change(screen.getByLabelText("Name of the master Black"), {
      target: { value: "Heavy" },
    });

    expect(store.getState().project.masters.map((m) => m.name)).toContain("Heavy");
  });
});

/** Render the panel over a three-master project and hand the store back. */
function withThreeRendered() {
  const store = withThree();
  render(<Masters />, store);
  fireEvent.click(screen.getByRole("button", { name: /^Masters/ }));
  return store;
}
