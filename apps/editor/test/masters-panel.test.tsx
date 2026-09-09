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

describe("previewing a weight nobody drew", () => {
  it("is not offered to a font with one master", () => {
    openPanel();
    expect(screen.queryByLabelText("Show an instance between the masters")).toBeNull();
  });

  it("is offered once there are masters and an axis to move along", () => {
    withThreeRendered();
    expect(screen.getByLabelText("Show an instance between the masters")).toBeTruthy();
  });

  it("shows no sliders until it is asked for", () => {
    withThreeRendered();
    expect(screen.queryByLabelText("Weight of the instance")).toBeNull();
  });

  it("starts where you are standing, which is the master you are drawing", async () => {
    const store = withThreeRendered();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Show an instance between the masters"));
      await Promise.resolve();
    });

    // Regular is the one being drawn, so the instance opens on top of it and
    // moving the slider is what makes it a weight nobody drew.
    expect(store.getState().preview).toEqual({ wght: 400 });
    expect(screen.getByLabelText("Weight of the instance")).toBeTruthy();
  });

  it("moves along the axis", async () => {
    const store = withThreeRendered();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Show an instance between the masters"));
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Weight of the instance"), {
        target: { value: "650" },
      });
      await Promise.resolve();
    });

    expect(store.getState().preview).toEqual({ wght: 650 });
    expect(screen.getByText("650")).toBeTruthy();
  });

  it("stops showing one when it is turned off", async () => {
    const store = withThreeRendered();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Show an instance between the masters"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Show an instance between the masters"));
      await Promise.resolve();
    });

    expect(store.getState().preview).toBeNull();
    expect(screen.queryByLabelText("Weight of the instance")).toBeNull();
  });
});

/**
 * The styles named between the masters.
 *
 * A second section in the same panel, because it is the same designspace — and
 * because the control that shows a place between the drawings is exactly how
 * somebody decides a place is worth naming.
 */
describe("naming the styles between the masters", () => {
  it("says what a family with none is missing out on", () => {
    const store = withThree();
    openPanel(store);

    expect(screen.getByText(/None yet/)).toBeTruthy();
  });

  it("names one, at the default place, when nothing is being shown", async () => {
    const store = withThree();
    openPanel(store);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Name…/ }));
      await Promise.resolve();
    });

    const [only] = store.getState().project.instances;
    expect(only?.name).toBe("New style");
    expect(only?.location).toEqual({ wght: 400 });
  });

  it("names the place being shown, once one is", async () => {
    const store = withThree();
    openPanel(store);

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Show an instance between the masters"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Weight of the instance"), {
        target: { value: "600" },
      });
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Name this…/ }));
      await Promise.resolve();
    });

    expect(store.getState().project.instances[0]?.location).toEqual({ wght: 600 });
  });

  it("renames one, moves it, and takes it away", async () => {
    const store = withThree();
    openPanel(store);

    await act(async () => {
      await store.addInstance("i1", "Semibold", { wght: 600 });
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Name of the instance Semibold"), {
        target: { value: "Demibold" },
      });
      await Promise.resolve();
    });
    expect(store.getState().project.instances[0]?.name).toBe("Demibold");

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Weight of the instance Demibold"), {
        target: { value: "550" },
      });
      await Promise.resolve();
    });
    expect(store.getState().project.instances[0]?.location).toEqual({ wght: 550 });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Remove the instance Demibold"));
      await Promise.resolve();
    });
    expect(store.getState().project.instances).toEqual([]);
  });
});
