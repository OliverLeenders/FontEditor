// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";
import { freshStore, installDomStubs, render } from "./render.js";

installBrowserGlobals();

const { UpdateNotice } = await import("../src/components/UpdateNotice.js");
const { updateGlyph } = await import("@typewright/font-model");

/**
 * The desktop application's offer of a newer version.
 *
 * The check and the install are Rust, and reach the network; what can be tested
 * here is what the page does with their answers. The desktop is stood in for by
 * `__TAURI_INTERNALS__.invoke`, which answers the check as it is told to and
 * records every command it is sent.
 */

type Store = ReturnType<typeof freshStore>;

beforeAll(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
  delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

type Answers = {
  /** What the check finds: a version, nothing newer, or a failure. */
  readonly check: string | null | Error;
  readonly install?: Error;
};

/** Pretend to be the desktop window, and keep what it was told. */
function installDesktop(answers: Answers): string[] {
  const sent: string[] = [];
  (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
    invoke: (command: string) => {
      sent.push(command);
      const answer = command === "check_for_update" ? answers.check : (answers.install ?? null);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  return sent;
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

const notice = () => screen.queryByRole("status");
const button = (name: string) => screen.getByRole("button", { name });

async function offered(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByText("Typewright 0.2.0 is available.")).toBeTruthy();
  });
}

describe("offering a newer version", () => {
  it("does not ask in a browser, which has nothing to update", async () => {
    render(<UpdateNotice />, freshStore());

    await Promise.resolve();
    expect(notice()).toBeNull();
  });

  it("says nothing when there is nothing newer", async () => {
    const sent = installDesktop({ check: null });
    render(<UpdateNotice />, freshStore());

    await waitFor(() => {
      expect(sent).toEqual(["check_for_update"]);
    });
    expect(notice()).toBeNull();
  });

  it("says nothing when the check fails, as it does offline", async () => {
    const sent = installDesktop({ check: new Error("error sending request") });
    render(<UpdateNotice />, freshStore());

    await waitFor(() => {
      expect(sent).toEqual(["check_for_update"]);
    });
    await Promise.resolve();
    expect(notice()).toBeNull();
  });

  it("names the version, and installs nothing until asked", async () => {
    const sent = installDesktop({ check: "0.2.0" });
    render(<UpdateNotice />, freshStore());

    await offered();
    expect(sent).toEqual(["check_for_update"]);
  });

  it("goes away on Later, having installed nothing", async () => {
    const sent = installDesktop({ check: "0.2.0" });
    render(<UpdateNotice />, freshStore());
    await offered();

    fireEvent.click(button("Later"));

    expect(notice()).toBeNull();
    expect(sent).toEqual(["check_for_update"]);
  });

  it("installs straight away when the folder has everything", async () => {
    const sent = installDesktop({ check: "0.2.0" });
    render(<UpdateNotice />, freshStore());
    await offered();

    fireEvent.click(button("Install and restart"));

    await waitFor(() => {
      expect(sent).toEqual(["check_for_update", "install_update"]);
    });
  });

  it("asks about the folder first when it is behind", async () => {
    const sent = installDesktop({ check: "0.2.0" });
    render(<UpdateNotice />, behind());
    await offered();

    fireEvent.click(button("Install and restart"));

    await waitFor(() => {
      expect(screen.getByText(/^Keep\.ufo has changes that are not in it yet/)).toBeTruthy();
    });
    expect(sent).toEqual(["check_for_update"]);
  });

  it("installs without saving when asked to", async () => {
    const sent = installDesktop({ check: "0.2.0" });
    render(<UpdateNotice />, behind());
    await offered();
    fireEvent.click(button("Install and restart"));
    await waitFor(() => {
      expect(button("Install without saving")).toBeTruthy();
    });

    fireEvent.click(button("Install without saving"));

    await waitFor(() => {
      expect(sent).toEqual(["check_for_update", "install_update"]);
    });
  });

  it("does not install over a save that did not happen", async () => {
    // A folder named in the state with no handle held, so the save fails.
    const sent = installDesktop({ check: "0.2.0" });
    render(<UpdateNotice />, behind());
    await offered();
    fireEvent.click(button("Install and restart"));
    await waitFor(() => {
      expect(button("Save to Keep.ufo and install")).toBeTruthy();
    });

    fireEvent.click(button("Save to Keep.ufo and install"));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/no folder is open/);
    });
    expect(sent).toEqual(["check_for_update"]);
  });

  it("says why an install failed, and offers it again", async () => {
    installDesktop({ check: "0.2.0", install: new Error("the download was interrupted") });
    render(<UpdateNotice />, freshStore());
    await offered();

    fireEvent.click(button("Install and restart"));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("the download was interrupted");
    });
    expect(button("Install and restart")).toBeTruthy();
  });
});
