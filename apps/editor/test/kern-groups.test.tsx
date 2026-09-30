// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { KernGroups } = await import("../src/components/KernGroups.js");

/**
 * The kerning groups: making them, filling them, and taking them apart.
 *
 * The commands are tested in tools. What the panel decides is how a name is
 * refused before anything is written, that the letter in front of you is one
 * press away, that moving a letter out of another group says so, and that
 * leaving a name half-typed with Escape abandons the name rather than the panel.
 */

type Store = ReturnType<typeof freshStore>;

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** Two glyphs from the starter font, to stand either side of the gap. */
function pair(store: Store): [string, string] {
  const names = store.editor.document.glyphOrder.filter((n) => n !== ".notdef");
  const [first, second] = names;
  if (first === undefined || second === undefined) throw new Error("the starter font is too small");
  return [first, second];
}

function panel(store: Store, onOpenChange = vi.fn()) {
  const [first, second] = pair(store);
  render(<KernGroups open onOpenChange={onOpenChange} first={first} second={second} />, store);
  return { first, second, onOpenChange };
}

/** One column of the panel, by the heading it is under, opening the lists if they are shut. */
function side(title: "Right sides" | "Left sides"): HTMLElement {
  const lists = screen.getByRole("button", { name: "All groups" });
  if (lists.getAttribute("aria-expanded") !== "true") fireEvent.click(lists);
  const found = screen.getByRole("heading", { name: title }).closest("section");
  if (found === null) throw new Error(`no column for ${title}`);
  return found;
}

function newGroup(column: HTMLElement, name: string): void {
  fireEvent.click(within(column).getByRole("button", { name: "New group" }));
  const field = within(column).getByLabelText("Name for the new group");
  fireEvent.change(field, { target: { value: name } });
  // The naming form's Add, not the member field's: once a group exists the
  // column has both.
  const form = field.parentElement;
  if (form === null) throw new Error("the name field is not in a form");
  fireEvent.click(within(form).getByRole("button", { name: "Add" }));
}

describe("the panel", () => {
  it("is shut until it is asked for", () => {
    const store = freshStore();
    const [first, second] = pair(store);
    const onOpenChange = vi.fn();
    render(
      <KernGroups open={false} onOpenChange={onOpenChange} first={first} second={second} />,
      store,
    );

    expect(screen.queryByRole("group", { name: "Kerning groups" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("has a column for each side of the gap", () => {
    panel(freshStore());

    expect(side("Right sides")).toBeTruthy();
    expect(side("Left sides")).toBeTruthy();
    expect(within(side("Right sides")).getByText("No groups on this side yet")).toBeTruthy();
  });
});

describe("the pair on screen", () => {
  it("leads with the two letters, and keeps the lists a press away", () => {
    const store = freshStore();
    const { first, second } = panel(store);

    expect(screen.getByLabelText(`Group for the right side of ${first}`)).toBeTruthy();
    expect(screen.getByLabelText(`Group for the left side of ${second}`)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Right sides" })).toBeNull();
    expect(screen.getByRole("button", { name: "All groups" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("opens on the lists when there is no pair to start from", () => {
    render(<KernGroups open onOpenChange={vi.fn()} first={null} second={null} />, freshStore());
    expect(screen.getByRole("heading", { name: "Right sides" })).toBeTruthy();
  });

  it("starts a group from a letter in one press, named after it and holding it", () => {
    const store = freshStore();
    const { first } = panel(store);

    fireEvent.click(screen.getByRole("button", { name: `New group from ${first}` }));

    const groups = store.editor.document.kerning.firstGroups;
    expect(Object.values(groups)).toEqual([[first]]);
    expect(
      screen.getByLabelText<HTMLSelectElement>(`Group for the right side of ${first}`).value,
    ).toBe(Object.keys(groups)[0]);
  });

  it("moves a letter between groups, and out of all of them, from its list", () => {
    const store = freshStore();
    const { second } = panel(store);
    fireEvent.click(screen.getByRole("button", { name: `New group from ${second}` }));
    const made = Object.keys(store.editor.document.kerning.secondGroups)[0]!;

    fireEvent.change(screen.getByLabelText(`Group for the left side of ${second}`), {
      target: { value: "" },
    });

    expect(store.editor.document.kerning.secondGroups[made]).toEqual([]);
  });
});

describe("naming a group", () => {
  it("refuses a name a group cannot have, before writing anything", () => {
    const store = freshStore();
    panel(store);
    const column = side("Right sides");

    fireEvent.click(within(column).getByRole("button", { name: "New group" }));
    fireEvent.change(within(column).getByLabelText("Name for the new group"), {
      target: { value: "round letters" },
    });

    expect(within(column).getByRole("alert").textContent).toBe(
      "Letters, digits, dot, dash and underscore, starting with a letter or digit",
    );
    expect(within(column).getByRole<HTMLButtonElement>("button", { name: "Add" }).disabled).toBe(
      true,
    );
    expect(Object.keys(store.editor.document.kerning.firstGroups)).toEqual([]);
  });

  it("makes one with a good name, on that side only", () => {
    const store = freshStore();
    panel(store);

    newGroup(side("Right sides"), "O_round");

    expect(store.editor.document.kerning.firstGroups["O_round"]).toEqual([]);
    expect(store.editor.document.kerning.secondGroups["O_round"]).toBeUndefined();
  });

  it("refuses a second group of the same name on the same side", () => {
    const store = freshStore();
    panel(store);
    const column = side("Right sides");
    newGroup(column, "O_round");

    fireEvent.click(within(column).getByRole("button", { name: "New group" }));
    fireEvent.change(within(column).getByLabelText("Name for the new group"), {
      target: { value: "O_round" },
    });

    expect(within(column).getByRole("alert").textContent).toBe(
      "There is already a O_round on this side",
    );
  });

  it("gives up the name, and not the panel, on Escape", () => {
    const store = freshStore();
    const { onOpenChange } = panel(store);
    const column = side("Right sides");

    fireEvent.click(within(column).getByRole("button", { name: "New group" }));
    fireEvent.keyDown(within(column).getByLabelText("Name for the new group"), { key: "Escape" });

    expect(within(column).queryByLabelText("Name for the new group")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("filling a group", () => {
  it("offers the letter in front of you as one press", () => {
    const store = freshStore();
    const { first } = panel(store);
    const column = side("Right sides");
    newGroup(column, "O_round");

    fireEvent.click(within(column).getByRole("button", { name: `Add ${first}` }));

    expect(store.editor.document.kerning.firstGroups["O_round"]).toEqual([first]);
  });

  it("says so when a letter would move out of another group", () => {
    const store = freshStore();
    const { first } = panel(store);
    const column = side("Right sides");
    newGroup(column, "A_left");
    fireEvent.click(within(column).getByRole("button", { name: `Add ${first}` }));
    newGroup(column, "B_left");

    const offer = within(column).getByRole("button", { name: `Add ${first}` });
    expect(offer.title).toBe(`Move ${first} out of A_left and into B_left`);

    fireEvent.click(offer);
    expect(store.editor.document.kerning.firstGroups["A_left"]).toEqual([]);
    expect(store.editor.document.kerning.firstGroups["B_left"]).toEqual([first]);
  });

  it("will not add a glyph the font does not have", () => {
    const store = freshStore();
    panel(store);
    const column = side("Right sides");
    newGroup(column, "O_round");

    fireEvent.change(within(column).getByLabelText("Glyph to add to O_round"), {
      target: { value: "no-such-glyph" },
    });

    expect(within(column).getByRole("alert").textContent).toBe("No glyph by that name");
  });

  it("takes a member out again", () => {
    const store = freshStore();
    const { first } = panel(store);
    const column = side("Right sides");
    newGroup(column, "O_round");
    fireEvent.click(within(column).getByRole("button", { name: `Add ${first}` }));

    fireEvent.click(within(column).getByRole("button", { name: `Remove ${first} from O_round` }));

    expect(store.editor.document.kerning.firstGroups["O_round"]).toEqual([]);
  });
});

describe("deleting a group", () => {
  it("removes it, and is one step of undo", () => {
    const store = freshStore();
    panel(store);
    const column = side("Right sides");
    newGroup(column, "O_round");

    fireEvent.click(within(column).getByRole("button", { name: "Delete" }));
    expect(store.editor.document.kerning.firstGroups["O_round"]).toBeUndefined();

    act(() => {
      store.undo();
    });
    expect(store.editor.document.kerning.firstGroups["O_round"]).toEqual([]);
  });
});
