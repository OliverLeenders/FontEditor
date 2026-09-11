// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { installFakeIdb } from "../../../packages/disk/test/fake-idb.js";
import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { Projects } = await import("../src/components/Projects.js");
const { newProject, projectById, saveProject } = await import("@typewright/disk");

/**
 * The list of fonts the program opens on.
 *
 * Which font to open is decided in the store and tested there. What this asks
 * is what the list says to somebody choosing: the last font first and ready for
 * Enter, where each of the others is kept, and — before anything is forgotten —
 * whether that font's copy here is the only one there is. Nothing in these
 * tests opens a font, because opening one reloads the page.
 */

type Store = ReturnType<typeof freshStore>;
type Summary = Parameters<Store["offerProjects"]>[0][number];

let restore: () => void;

beforeAll(() => {
  installDomStubs();
});

beforeEach(() => {
  ({ restore } = installFakeIdb());
});

afterEach(() => {
  cleanup();
  restore();
});

const kept: Summary = { id: "a", name: "Kept", folder: "Kept.ufo", openedAt: 2, savedAt: 1 };
const loose: Summary = { id: "b", name: "Loose", folder: null, openedAt: 1, savedAt: null };
const latest: Summary = { id: "c", name: "Latest", folder: "Latest.ufo", openedAt: 3, savedAt: 3 };

/** The list on screen with nothing open, as it is at startup. */
async function offering(all: readonly Summary[]): Promise<Store> {
  for (const it of all) {
    await saveProject({ ...newProject(it.name), id: it.id, openedAt: it.openedAt });
  }
  const store = freshStore();
  act(() => {
    store.offerProjects(all);
  });
  return store;
}

function row(name: string): HTMLElement {
  const found = screen
    .getAllByRole("listitem")
    // The name and where the font is kept are adjacent spans, so the accessible
    // name runs them together — "KeptKept.ufo" — and there is no word break after
    // the name to match. From the start, then.
    .find((li) => within(li).queryByRole("button", { name: new RegExp(`^${name}`) }) !== null);
  if (found === undefined) throw new Error(`no row for ${name}`);
  return found;
}

describe("at startup", () => {
  it("offers to continue with the most recent font, ready for Enter", async () => {
    const store = await offering([latest, kept, loose]);
    render(<Projects />, store);

    const resume = screen.getByRole("button", { name: /^Continue with Latest/ });
    expect(document.activeElement).toBe(resume);
  });

  it("lists the others with where each is kept", async () => {
    render(<Projects />, await offering([latest, kept, loose]));

    expect(row("Kept").textContent).toContain("Kept.ufo");
    expect(row("Loose").textContent).toContain("not saved to a folder");
  });

  it("has nothing to cancel back to", async () => {
    render(<Projects />, await offering([latest, kept]));

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});

describe("forgetting", () => {
  it("asks first, and says the folder on disk stays", async () => {
    render(<Projects />, await offering([latest, kept]));

    fireEvent.click(within(row("Kept")).getByRole("button", { name: "Forget" }));

    const asking = screen.getByRole("group", { name: "Forget Kept?" });
    expect(asking.textContent).toContain("Kept.ufo stays on disk");
    expect(within(asking).getByRole("button", { name: "Remove" })).toBeTruthy();
  });

  it("says a font never saved to a folder has only this copy", async () => {
    render(<Projects />, await offering([latest, loose]));

    fireEvent.click(within(row("Loose")).getByRole("button", { name: "Forget" }));

    const asking = screen.getByRole("group", { name: "Forget Loose?" });
    expect(asking.textContent).toContain("this is its only copy");
    expect(within(asking).getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("keeps the font when told to keep it", async () => {
    render(<Projects />, await offering([latest, kept]));

    fireEvent.click(within(row("Kept")).getByRole("button", { name: "Forget" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));

    expect(screen.queryByRole("group", { name: "Forget Kept?" })).toBeNull();
    expect(await projectById("a")).not.toBeNull();
  });

  it("takes it off the list when the answer is yes", async () => {
    render(<Projects />, await offering([latest, loose]));

    fireEvent.click(within(row("Loose")).getByRole("button", { name: "Forget" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^Loose/ })).toBeNull();
    });
    expect(await projectById("b")).toBeNull();
  });
});

describe("starting a font", () => {
  it("wants a name before it will start one", async () => {
    render(<Projects />, await offering([latest]));

    fireEvent.click(screen.getByRole("button", { name: "New font…" }));
    const start = screen.getByRole<HTMLButtonElement>("button", { name: "Start" });
    expect(start.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Family name"), { target: { value: "  " } });
    expect(start.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Family name"), { target: { value: "Grotesk" } });
    expect(start.disabled).toBe(false);
  });
});

describe("opened from the File menu", () => {
  it("offers to go back to the open font, and to cancel", async () => {
    const store = await offering([kept, latest]);
    act(() => {
      store.patch({ projects: { ...store.getState().projects, current: "a", showing: true } });
    });
    render(<Projects />, store);

    expect(screen.getByRole("button", { name: /^Back to Kept/ })).toBeTruthy();
    // The open font is not offered again beneath itself.
    expect(screen.queryByRole("button", { name: /^Kept/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(store.getState().projects.showing).toBe(false);
  });
});

describe("skipping the list", () => {
  it("is remembered as a setting", async () => {
    const store = await offering([latest]);
    render(<Projects />, store);

    fireEvent.click(screen.getByRole("checkbox", { name: /Open the last font straight away/ }));

    expect(store.getState().skipChooser).toBe(true);
  });
});
