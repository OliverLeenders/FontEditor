// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FakeFolder } from "../../../packages/disk/test/fake-folder.js";
import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { FileMenu } = await import("../src/components/FileMenu.js");
const { ufoFiles } = await import("@typewright/font-io");
const { writeFolder } = await import("@typewright/disk");
const { updateGlyph } = await import("@typewright/font-model");

/**
 * The File menu, and the font's own folder behind it.
 *
 * The state being tested is the one a person actually reads off this menu: is
 * there a folder, has anything changed since it was saved, and is Save the
 * thing to press. That last one is worth a test of its own because it is
 * derived rather than stored — the document as it was written, compared with
 * the document as it is — and a comparison that stops working shows up as a
 * Save item that never lights up.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

/** Open the menu, which is where every one of these items lives now. */
function openMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: /^File/ }));
}

/** The Save item, which carries its shortcut in its own label. */
const saveItem = () =>
  screen.getByRole<HTMLButtonElement>("menuitemcheckbox", { name: /^Save Ctrl/ });

/** Put a folder behind the picker, or nothing to have the user close it. */
function offer(folder: FakeFolder | null): void {
  (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => {
    if (folder === null) throw new DOMException("cancelled", "AbortError");
    return Promise.resolve(folder);
  };
}

beforeEach(() => {
  offer(null);
});

/** A folder holding a font, as this editor would have written it. */
async function ufoOf(store: ReturnType<typeof freshStore>, name = "Test.ufo") {
  const folder = new FakeFolder(name);
  await writeFolder(folder, ufoFiles(store.editor.document));
  return folder;
}

/** Change the font, so it is no longer the one that was saved. */
function edit(store: ReturnType<typeof freshStore>): void {
  act(() => {
    const name = store.editor.currentGlyph;
    const document = updateGlyph(store.editor.document, name, (g) => ({
      ...g,
      advance: g.advance + 1,
    }));
    if (document === null) throw new Error(`no glyph ${name}`);
    store.setEditor({ ...store.editor, document });
  });
}

describe("the font's folder in the bar", () => {
  it("offers to open one, and nothing else until there is one", () => {
    render(<FileMenu />);

    openMenu();

    expect(screen.getByRole("menuitemcheckbox", { name: "Open folder…" })).toBeTruthy();
    // There is nowhere to save to yet, so the item says what pressing it does.
    expect(screen.getByRole("menuitemcheckbox", { name: /^Save to a folder/ })).toBeTruthy();
  });

  it("names the folder once one is open", async () => {
    const store = freshStore();
    offer(await ufoOf(store));
    render(<FileMenu />, store);

    openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Open folder…" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(store.getState().folder.name).toBe("Test.ufo");
    });
    openMenu();
    expect(screen.getByText("Test.ufo")).toBeTruthy();
  });

  it("has nothing to save until something changes", async () => {
    const store = freshStore();
    offer(await ufoOf(store));
    render(<FileMenu />, store);

    openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Open folder…" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(store.getState().folder.name).toBe("Test.ufo");
    });
    openMenu();

    expect(saveItem().disabled).toBe(true);
    expect(screen.getByText(/as opened/)).toBeTruthy();
  });

  it("lights up, and says so, once the font has moved", async () => {
    const store = freshStore();
    offer(await ufoOf(store));
    render(<FileMenu />, store);

    openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Open folder…" }));
      await Promise.resolve();
    });
    edit(store);
    openMenu();

    expect(saveItem().disabled).toBe(false);
    expect(screen.getByText(/unsaved changes/)).toBeTruthy();
  });

  it("writes the font back, and stops saying it is unsaved", async () => {
    const store = freshStore();
    const folder = await ufoOf(store);
    offer(folder);
    render(<FileMenu />, store);

    openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Open folder…" }));
      await Promise.resolve();
    });
    edit(store);

    openMenu();
    await act(async () => {
      fireEvent.click(saveItem());
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByText(/unsaved changes/)).toBeNull();
    });
    expect(screen.getByText(/Saved \d+ files to Test\.ufo/)).toBeTruthy();
  });

  it("says what went wrong rather than appearing to have worked", async () => {
    const store = freshStore();
    offer(new FakeFolder("Photos").put("holiday.jpg", "not a font"));
    render(<FileMenu />, store);

    openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Open folder…" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/UFO/);
    });
  });

  it("leaves everything as it was when the picker is closed", async () => {
    const store = freshStore();
    render(<FileMenu />, store);
    const before = store.editor.document;

    openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Open folder…" }));
      await Promise.resolve();
    });

    expect(store.editor.document).toBe(before);
    // Still nowhere to save to, so the item still asks for a folder.
    openMenu();
    expect(screen.getByRole("menuitemcheckbox", { name: /^Save to a folder/ })).toBeTruthy();
  });

  it("offers nothing about folders in a browser that has none", () => {
    delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    render(<FileMenu />);
    openMenu();

    // Firefox and Safari have the file pickers but not the directory one. What
    // they can do is still offered; what they cannot is not there to press.
    expect(screen.getByRole("menuitemcheckbox", { name: "Open font…" })).toBeTruthy();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Open folder…" })).toBeNull();
    expect(screen.queryByRole("menuitemcheckbox", { name: /^Save/ })).toBeNull();
  });
});
