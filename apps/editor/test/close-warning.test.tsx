// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { CloseWarning } = await import("../src/components/CloseWarning.js");
const { updateGlyph } = await import("@typewright/font-model");

/**
 * The desktop window's question on the way out.
 *
 * The window itself is Rust and cannot be run here; what can be is everything
 * the page decides once the window has handed it the request — whether to ask
 * at all, and what each answer tells the window to do. The desktop is stood in
 * for by the one thing the page uses of it, `__TAURI_INTERNALS__.invoke`, which
 * records the commands it is sent.
 */

type Store = ReturnType<typeof freshStore>;

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
  delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

/** Pretend to be the desktop window, and keep what it was told. */
function installDesktop(): string[] {
  const sent: string[] = [];
  (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    invoke: (command: string) => {
      sent.push(command);
      return Promise.resolve(null);
    },
  };
  return sent;
}

/** What the window does when its close button is pressed. */
function pressClose(): void {
  act(() => {
    window.dispatchEvent(new Event("typewright:close-requested"));
  });
}

/** A store with a folder open and the font moved on from what was saved there. */
function behind(): Store {
  const store = freshStore();
  store.patch({
    folder: { ...store.getState().folder, name: "Keep.ufo", saved: store.editor.document },
  });

  const name = store.editor.currentGlyph;
  const document = updateGlyph(store.editor.document, name, (g) => ({
    ...g,
    advance: g.advance + 10,
  }));
  if (document === null) throw new Error("the glyph the editor is on is not in the font");
  store.setEditor({ ...store.editor, document });
  return store;
}

const dialog = () => screen.queryByRole("alertdialog");

describe("closing the desktop window", () => {
  it("does nothing in a browser, which asks in its own way", async () => {
    render(<CloseWarning />, behind());
    pressClose();

    await Promise.resolve();
    expect(dialog()).toBeNull();
  });

  it("closes straight away when the folder has everything", async () => {
    const sent = installDesktop();
    render(<CloseWarning />, freshStore());

    pressClose();

    await waitFor(() => {
      expect(sent).toEqual(["close_window"]);
    });
    expect(dialog()).toBeNull();
  });

  it("asks, and does not close, when the folder is behind", async () => {
    const sent = installDesktop();
    render(<CloseWarning />, behind());

    pressClose();

    await waitFor(() => {
      expect(dialog()).not.toBeNull();
    });
    expect(screen.getByText("Save to Keep.ufo before closing?")).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it("says nothing about losing work, because none would be lost", async () => {
    installDesktop();
    render(<CloseWarning />, behind());
    pressClose();

    await waitFor(() => {
      expect(dialog()).not.toBeNull();
    });
    // Whole words: the button that closes is labelled "Close", which is not a
    // claim about losing anything.
    expect(dialog()?.textContent).not.toMatch(/\b(lose|lost|losing)\b/i);
  });

  it("stays open on Cancel, and tells the window so", async () => {
    const sent = installDesktop();
    render(<CloseWarning />, behind());
    pressClose();
    await waitFor(() => {
      expect(dialog()).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(dialog()).toBeNull();
    expect(sent).toEqual(["keep_window_open"]);
  });

  it("stays open on Escape too", async () => {
    const sent = installDesktop();
    render(<CloseWarning />, behind());
    pressClose();
    await waitFor(() => {
      expect(dialog()).not.toBeNull();
    });

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });

    expect(dialog()).toBeNull();
    expect(sent).toEqual(["keep_window_open"]);
  });

  it("closes without saving when asked to", async () => {
    const sent = installDesktop();
    render(<CloseWarning />, behind());
    pressClose();
    await waitFor(() => {
      expect(dialog()).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close without saving" }));

    await waitFor(() => {
      expect(sent).toEqual(["close_window"]);
    });
  });

  it("keeps the window open and says why when the save fails", async () => {
    // The folder is named in the state but no handle is held, so the save
    // cannot happen — the case that matters is that the window does not close
    // over a save that did not.
    const sent = installDesktop();
    render(<CloseWarning />, behind());
    pressClose();
    await waitFor(() => {
      expect(dialog()).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Save and close" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/no folder is open/);
    });
    expect(dialog()).not.toBeNull();
    expect(sent).toEqual([]);
  });
});
