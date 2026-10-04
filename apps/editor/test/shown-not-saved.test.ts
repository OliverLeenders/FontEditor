import { describe, expect, it } from "vitest";

import { type Files, opened } from "./walk-harness.js";

const { MemoryFileStore } = await import("@typewright/storage");

/**
 * A font opened is shown first and written afterwards, so that nobody waits
 * behind a pane for the seconds a large one takes to write. For those seconds
 * the working copy still holds the font that was there before.
 *
 * The status line read `saved` through all of them: autosave had no edit to
 * save, and knew nothing of the font on its way. A tab reloaded on that word
 * opened the font before under the new one's name.
 */
describe("a font shown and not yet written", () => {
  it("is not called saved until it is on disk", async () => {
    const files: Files = new MemoryFileStore();
    const store = await opened(files);
    await store.flushNow();
    const before = store.editor.document;
    expect(store.getState().saveStatus).toBe("idle");

    // What the status was at every moment the new font was the one on screen.
    const said: string[] = [];
    const unwatch = store.subscribe(() => {
      if (store.editor.document !== before) said.push(store.getState().saveStatus);
    });
    await store.newFont();
    unwatch();

    expect(said.length).toBeGreaterThan(0);
    expect(said.slice(0, -1), "while it was being written").not.toContain("idle");
    expect(store.getState().saveStatus, "once it had been").toBe("idle");

    // And what is on disk by then is the font that was shown.
    const again = await opened(files);
    expect(again.editor.document.glyphOrder).toEqual([".notdef"]);
  });
});
