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

/**
 * A source with more than one layer, opened and saved back.
 *
 * A designer's UFO holds more than the drawing — a sketch traced over, a
 * previous version — and this editor edits exactly one of those. It used to
 * write a `layercontents.plist` naming only that one, so the other directories
 * stayed on disk with nothing pointing at them, which is what every tool that
 * opens the font afterwards reads as their having been deleted.
 */
describe("a folder with a second layer in it", () => {
  let store: Store;
  beforeEach(() => {
    store = freshStore();
    offer(null);
  });

  /** The starter font, plus a sketch layer nothing in the editor can reach. */
  async function withSketch(): Promise<FakeFolder> {
    const folder = await ufoOf(store);
    folder.put(
      "layercontents.plist",
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<plist version="1.0">',
        "<array>",
        "	<array><string>public.default</string><string>glyphs</string></array>",
        "	<array><string>sketch</string><string>glyphs.sketch</string></array>",
        "</array>",
        "</plist>",
      ].join("\n"),
    );
    folder.put(
      "glyphs.sketch/contents.plist",
      '<plist version="1.0"><dict><key>a</key><string>a.glif</string></dict></plist>',
    );
    folder.put("glyphs.sketch/a.glif", '<glyph name="a" format="2"><advance width="999"/></glyph>');
    return folder;
  }

  it("keeps the layer listed and keeps its files, after a save", async () => {
    const folder = await withSketch();
    offer(folder);
    await store.openFolder();

    edit(store);
    await store.saveFolder();

    const files = folder.all();
    expect(files.get("layercontents.plist")).toContain("glyphs.sketch");
    expect(files.get("glyphs.sketch/a.glif")).toContain('width="999"');
    expect(files.has("glyphs.sketch/contents.plist")).toBe(true);
  });

  it("carries it into a folder saved somewhere else", async () => {
    // Save as writes into an empty folder, so nothing is there to survive on
    // its own: the layer only arrives if the editor kept it.
    offer(await withSketch());
    await store.openFolder();

    const elsewhere = new FakeFolder("Elsewhere.ufo");
    offer(elsewhere);
    await store.saveFolderAs();

    expect(elsewhere.all().get("glyphs.sketch/a.glif")).toContain('width="999"');
  });

  it("does not carry it into the next font opened", async () => {
    offer(await withSketch());
    await store.openFolder();
    await store.newFont();

    const plain = new FakeFolder("Plain.ufo");
    offer(plain);
    await store.saveFolderAs();

    const files = plain.all();
    expect(files.has("glyphs.sketch/a.glif")).toBe(false);
    expect(files.get("layercontents.plist")).not.toContain("glyphs.sketch");
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

/**
 * Saving the same folder twice.
 *
 * A UFO is one file per glyph, so a save that rewrote all of them took long
 * enough to look like the editor had stopped. The store keeps what the last
 * save left, and hands it to the writer as the thing to compare against.
 */
describe("saving again", () => {
  let store: Store;
  beforeEach(() => {
    store = freshStore();
    offer(null);
  });

  it("writes nothing the second time when nothing has changed", async () => {
    offer(await ufoOf(store));
    await store.openFolder();

    edit(store);
    const first = await store.saveFolder();
    expect(first.written).toBeGreaterThan(1);

    const again = await store.saveFolder();
    expect(again.written).toBe(0);
  });

  it("writes the glyph that moved, and not the rest of the font", async () => {
    offer(await ufoOf(store));
    await store.openFolder();
    await store.saveFolder();

    edit(store);
    const again = await store.saveFolder();

    // The glyph's own file, and the two indexes that name what is in the font.
    expect(again.written).toBeLessThan(4);
    expect(again.written).toBeGreaterThan(0);
  });

  it("keeps a record of what it left, for the session after this one", async () => {
    offer(await ufoOf(store));
    await store.openFolder();
    await store.saveFolder();

    const state = store.getState().folder;
    expect(state.written.size).toBeGreaterThan(3);
    expect(state.checked).toBe(true);
    // Every entry says what the file held and when it was written.
    for (const [, file] of state.written) {
      expect(typeof file.crc).toBe("number");
      expect(typeof file.at).toBe("number");
    }
  });

  it("writes everything into a folder it has no record of", async () => {
    offer(await ufoOf(store));
    await store.openFolder();
    await store.saveFolder();

    // Save as, somewhere else: what the record says about the old folder says
    // nothing at all about this one.
    const elsewhere = new FakeFolder("Elsewhere.ufo");
    offer(elsewhere);
    const report = await store.saveFolderAs();

    expect(report?.written).toBe(store.getState().folder.written.size);
  });
});
