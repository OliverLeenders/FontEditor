import { beforeEach, describe, expect, it } from "vitest";

import { FakeFolder } from "../../../packages/disk/test/fake-folder.js";
import { clearStoredSettings, installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { EditorStore } = await import("../src/store/index.js");
const { ufoFiles } = await import("@fonteditor/font-io");
const { writeFolder } = await import("@fonteditor/disk");
const { updateGlyph } = await import("@fonteditor/font-model");

type Store = InstanceType<typeof EditorStore>;

function freshStore(): Store {
  clearStoredSettings();
  return new EditorStore();
}

/**
 * Put a folder behind the picker.
 *
 * The picker is a global function the browser provides, so a test can simply be
 * the browser: this is the whole seam between the editor and the user's disk.
 */
function offer(folder: FakeFolder | null): void {
  (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => {
    if (folder === null) throw new DOMException("cancelled", "AbortError");
    return Promise.resolve(folder);
  };
}

/** A folder holding the starter font, as a UFO written by this editor. */
async function ufoOf(store: Store, name = "Test.ufo"): Promise<FakeFolder> {
  const folder = new FakeFolder(name);
  await writeFolder(folder, ufoFiles(store.editor.document));
  return folder;
}

/** Move a point, so the document is no longer the one that was saved. */
function edit(store: Store): void {
  const name = store.editor.currentGlyph;
  const document = updateGlyph(store.editor.document, name, (g) => ({
    ...g,
    advance: g.advance + 1,
  }));
  if (document === null) throw new Error(`no glyph ${name}`);
  store.setEditor({ ...store.editor, document });
}

describe("the font's folder on disk", () => {
  let store: Store;
  beforeEach(() => {
    store = freshStore();
    offer(null);
  });

  it("opens a folder and works in it", async () => {
    offer(await ufoOf(store));

    const report = await store.openFolder();

    expect(report?.name).toBe("Test.ufo");
    expect(report?.glyphs).toBe(store.editor.document.glyphOrder.length);
    expect(store.getState().folder.name).toBe("Test.ufo");
  });

  it("leaves everything alone when the picker is closed", async () => {
    const before = store.editor.document;

    expect(await store.openFolder()).toBeNull();

    expect(store.editor.document).toBe(before);
    expect(store.getState().folder.name).toBeNull();
  });

  it("refuses a folder that is not a UFO", async () => {
    offer(new FakeFolder("Photos").put("holiday.jpg", "not a font"));

    await expect(store.openFolder()).rejects.toThrow(/UFO/);
  });

  it("counts as saved when opened, and unsaved once something changes", async () => {
    offer(await ufoOf(store));
    await store.openFolder();

    const opened = store.getState();
    expect(unsavedNow(opened)).toBe(false);

    edit(store);
    expect(unsavedNow(store.getState())).toBe(true);
  });

  it("writes the font back to the folder it came from", async () => {
    const folder = await ufoOf(store);
    offer(folder);
    await store.openFolder();
    edit(store);

    const report = await store.saveFolder();

    expect(report.written).toBeGreaterThan(0);
    expect(unsavedNow(store.getState())).toBe(false);
    expect(store.getState().folder.savedAt).not.toBeNull();
    // What was written is what is open, not what was opened.
    const advance = store.editor.document.glyphs[store.editor.currentGlyph]?.advance;
    expect(folder.all().get(`glyphs/${glifName(store)}`)).toContain(
      `width="${String(advance ?? 0)}"`,
    );
  });

  it("has nothing to save to until a folder is chosen", async () => {
    await expect(store.saveFolder()).rejects.toThrow(/Save as/);
  });

  it("saves to a new folder, and works there afterwards", async () => {
    const fresh = new FakeFolder("Elsewhere.ufo");
    offer(fresh);

    const report = await store.saveFolderAs();

    expect(report?.name).toBe("Elsewhere.ufo");
    expect(store.getState().folder.name).toBe("Elsewhere.ufo");
    expect([...fresh.all().keys()]).toContain("metainfo.plist");
  });

  it("will not save over a folder that holds something else", async () => {
    offer(new FakeFolder("Documents").put("taxes.pdf", "not a font"));

    await expect(store.saveFolderAs()).rejects.toThrow(/empty folder/);
    expect(store.getState().folder.name).toBeNull();
  });

  it("forgets the folder when a different font is opened", async () => {
    offer(await ufoOf(store));
    await store.openFolder();
    expect(store.getState().folder.name).toBe("Test.ufo");

    // Otherwise Save would write this new font over the folder holding the old
    // one, which is the worst thing this feature could do.
    await store.newFont();

    expect(store.getState().folder.name).toBeNull();
    await expect(store.saveFolder()).rejects.toThrow(/Save as/);
  });
});

function unsavedNow(state: ReturnType<Store["getState"]>): boolean {
  return state.folder.saved !== null && state.folder.saved !== state.session.editor.document;
}

/** The file the current glyph is written to, by UFO's own naming rule. */
function glifName(store: Store): string {
  const contents = store.getState().session.editor.currentGlyph;
  return `${contents}.glif`;
}
