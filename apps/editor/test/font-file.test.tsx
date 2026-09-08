// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FakeFolder } from "../../../packages/disk/test/fake-folder.js";
import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { FontFile } = await import("../src/components/FontFile.js");
const { ufoFiles } = await import("@fonteditor/font-io");
const { writeFolder } = await import("@fonteditor/disk");
const { updateGlyph } = await import("@fonteditor/font-model");

/**
 * The font's own folder on disk, as the bar shows it.
 *
 * The state being tested is the one a person actually reads off this row: is
 * there a folder, has anything changed since it was saved, and is Save the
 * thing to press. That last one is worth a test of its own because it is
 * derived rather than stored — the document as it was written, compared with
 * the document as it is — and a comparison that stops working shows up as a
 * Save button that never lights up.
 */

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

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
    render(<FontFile />);

    expect(screen.getByRole("button", { name: "Open folder…" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("names the folder once one is open", async () => {
    const store = freshStore();
    offer(await ufoOf(store));
    render(<FontFile />, store);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open folder…" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTitle("The font is kept in Test.ufo")).toBeTruthy();
    });
  });

  it("has nothing to save until something changes", async () => {
    const store = freshStore();
    offer(await ufoOf(store));
    render(<FontFile />, store);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open folder…" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
    });
    expect(screen.getByText(/as opened/)).toBeTruthy();
  });

  it("lights up, and says so, once the font has moved", async () => {
    const store = freshStore();
    offer(await ufoOf(store));
    render(<FontFile />, store);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open folder…" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    });

    edit(store);

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(false);
    expect(screen.getByText(/unsaved changes/)).toBeTruthy();
  });

  it("writes the font back, and stops saying it is unsaved", async () => {
    const store = freshStore();
    const folder = await ufoOf(store);
    offer(folder);
    render(<FontFile />, store);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open folder…" }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    });
    edit(store);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
    render(<FontFile />, store);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open folder…" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/UFO/);
    });
  });

  it("leaves everything as it was when the picker is closed", async () => {
    const store = freshStore();
    render(<FontFile />, store);
    const before = store.editor.document;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open folder…" }));
      await Promise.resolve();
    });

    expect(store.editor.document).toBe(before);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("shows nothing at all in a browser that cannot open folders", () => {
    delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    const { container } = render(<FontFile />);

    // Firefox and Safari have the file pickers but not the directory one, and
    // a row of buttons that cannot work is worse than no row.
    expect(container.textContent).toBe("");
  });
});
