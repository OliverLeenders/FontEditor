import { beforeEach, describe, expect, it, onTestFinished } from "vitest";

import { FakeFolder } from "../../../packages/disk/test/fake-folder.js";
import { installFakeIdb } from "../../../packages/disk/test/fake-idb.js";
import { FakeWorker } from "../../../packages/storage/test/fake-worker.js";
import { clearStoredSettings, installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { EditorStore, unsaved } = await import("../src/store/index.js");
const { MemoryFileStore } = await import("@typewright/storage");
const { setInfo } = await import("@typewright/tools");
const { newProject, projectById, saveProject } = await import("@typewright/disk");

type Store = InstanceType<typeof EditorStore>;

/**
 * A font drawn more than once, kept in a folder.
 *
 * One master is a UFO. Several are a family — a designspace and a UFO for each,
 * in a folder of their own — and until this the folder held whichever master
 * was open when it was last saved, with the rest nowhere but the browser. These
 * ask that the folder is the whole family: every master written, each only when
 * it has changed, read back whole, and known to be behind when any of them is.
 */

const WEIGHT = { tag: "wght", name: "Weight", min: 100, default: 400, max: 900 };

/** The folder a picker would hand back, set by each test. */
function offer(folder: FakeFolder): void {
  (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = () =>
    Promise.resolve(folder);
}

beforeEach(() => {
  const { restore } = installFakeIdb();
  onTestFinished(restore);
});

/** A store on a font of its own, with a working copy and a record behind it. */
async function opened(files = new MemoryFileStore(), id?: string): Promise<Store> {
  clearStoredSettings();
  const record = id === undefined ? newProject("Untitled") : await projectById(id);
  if (record === null) throw new Error("no such font");
  if (id === undefined) await saveProject(record);

  const store = new EditorStore();
  await store.connectStorage(new FakeWorker(files) as unknown as Worker, record.id);
  if (store.getState().ownership === "reading") await store.takeOver();
  await store.noteProjects(record.id);
  return store;
}

/**
 * A mark written in the open master, which is how the masters are told apart.
 * In what a master keeps to itself — the name of its own style — since what
 * the masters share is carried from one to the next.
 */
const mark = (store: Store, text: string): void => {
  store.applyTool(setInfo(store.editor, { openTypeNamePreferredSubfamilyName: `# ${text}` }));
};

/** The mark of the master that is open. */
const open = (store: Store): string =>
  store.editor.document.info.openTypeNamePreferredSubfamilyName;

/** What a master's UFO in a family's folder says of that mark. */
const marked = (folder: FakeFolder, ufo: string): string | undefined =>
  /<key>openTypeNamePreferredSubfamilyName<\/key>\s*<string>([^<]*)<\/string>/.exec(
    folder.all().get(`${ufo}/fontinfo.plist`) ?? "",
  )?.[1];

const dirty = (store: Store): boolean => unsaved(store.getState().folder, store.editor.document);

/**
 * A font saved as one UFO, then drawn a second time: the regular marked, a bold
 * added and marked, back in the regular. `place` is where its UFO is kept.
 */
async function twoMasters(): Promise<{ store: Store; place: FakeFolder; regular: string }> {
  const store = await opened();
  mark(store, "regular");

  const place = new FakeFolder("Fonts");
  offer(place);
  await store.saveFolderAs();
  const regular = store.getState().project.current;

  await store.setAxes([WEIGHT]);
  await store.addMaster("bold", "Bold", { wght: 900 });
  await store.switchMaster("bold");
  mark(store, "bold");
  await store.switchMaster(regular);
  return { store, place, regular };
}

/** The family's folder inside the place it was saved to. */
const familyIn = (place: FakeFolder): FakeFolder => {
  const found = [...place.folders.values()].find((it) => !it.name.endsWith(".ufo"));
  if (found === undefined) throw new Error("no family folder");
  return found;
};

describe("a font that gains a second master", () => {
  it("is behind its folder, which is one master's, until it is saved again", async () => {
    const store = await opened();
    offer(new FakeFolder("Fonts"));
    await store.saveFolderAs();
    expect(dirty(store)).toBe(false);

    await store.setAxes([WEIGHT]);
    await store.addMaster("bold", "Bold", { wght: 900 });
    expect(dirty(store)).toBe(true);
  });

  it("is saved as a family in a folder of its own, asked for once", async () => {
    const { store, place } = await twoMasters();
    const before = [...place.folders.keys()];
    expect(before).toEqual(["Untitled-Regular.ufo"]);

    // Ctrl-S: there is a folder already, and it is one master's.
    const report = await store.saveToFolder();

    const family = familyIn(place);
    expect(family.name).toBe("Untitled");
    expect([...family.files.keys()]).toEqual(["Untitled.designspace"]);
    expect([...family.folders.keys()].sort()).toEqual([
      "Untitled-Bold.ufo",
      "Untitled-Regular.ufo",
    ]);
    expect(marked(family, "Untitled-Regular.ufo")).toBe("# regular");
    expect(marked(family, "Untitled-Bold.ufo")).toBe("# bold");

    // The UFO it was kept in is left where it was, and said to be.
    expect([...place.folders.keys()].sort()).toEqual(["Untitled", "Untitled-Regular.ufo"]);
    expect(report?.notes.join(" ")).toMatch(/kept as a family in Untitled/);
    expect(store.getState().folder.name).toBe("Untitled");
    expect(store.getState().folder.family).toBe(true);
    expect(dirty(store)).toBe(false);
  });

  it("names each master's UFO for the master, whatever style the font was drawn as", async () => {
    const { store, place } = await twoMasters();
    await store.saveToFolder();

    const info = familyIn(place).all().get("Untitled-Bold.ufo/fontinfo.plist") ?? "";
    expect(info).toMatch(/<key>styleName<\/key>\s*<string>Bold<\/string>/);
  });

  it("does not write over a folder of the family's name that is something else", async () => {
    const { store, place } = await twoMasters();
    place.put("Untitled/notes.txt", "somebody's own");

    await store.saveToFolder();

    expect(store.getState().folder.name).toBe("Untitled-2");
    expect(place.all().get("Untitled/notes.txt")).toBe("somebody's own");
  });
});

describe("saving a family", () => {
  it("writes the master that changed, and not the others", async () => {
    const { store, place } = await twoMasters();
    await store.saveToFolder();
    const family = familyIn(place);
    const boldBefore = family.folders.get("Untitled-Bold.ufo")!.times.get("fontinfo.plist");

    mark(store, "regular, again");
    const report = await store.saveToFolder();

    expect(marked(family, "Untitled-Regular.ufo")).toBe("# regular, again");
    // A file or two of the regular's, and nothing of the bold's.
    expect(report?.written).toBeLessThan(4);
    expect(family.folders.get("Untitled-Bold.ufo")!.times.get("fontinfo.plist")).toBe(boldBefore);
  });

  it("writes a master changed and then left, from the master gone to afterwards", async () => {
    const { store, place, regular } = await twoMasters();
    await store.saveToFolder();
    const family = familyIn(place);

    await store.switchMaster("bold");
    mark(store, "bold, again");
    await store.switchMaster(regular);
    expect(dirty(store)).toBe(true);

    await store.saveToFolder();
    expect(marked(family, "Untitled-Bold.ufo")).toBe("# bold, again");
    expect(marked(family, "Untitled-Regular.ufo")).toBe("# regular");
    expect(dirty(store)).toBe(false);
  });

  it("is not behind for having gone to another master and back", async () => {
    const { store, regular } = await twoMasters();
    await store.saveToFolder();

    await store.switchMaster("bold");
    expect(dirty(store)).toBe(false);
    await store.switchMaster(regular);
    expect(dirty(store)).toBe(false);

    await store.switchMaster("bold");
    mark(store, "bold, again");
    expect(dirty(store)).toBe(true);
  });

  it("is behind when the family changes, though no drawing has", async () => {
    const { store } = await twoMasters();
    await store.saveToFolder();

    await store.renameMaster("bold", "Black");
    expect(dirty(store)).toBe(true);

    // Taken back, it is as the folder has it again.
    await store.renameMaster("bold", "Bold");
    expect(dirty(store)).toBe(false);
  });

  it("takes a master's UFO out when the master is renamed or removed", async () => {
    const { store, place } = await twoMasters();
    await store.saveToFolder();
    const family = familyIn(place);

    await store.renameMaster("bold", "Black");
    const renamed = await store.saveToFolder();
    expect([...family.folders.keys()].sort()).toEqual([
      "Untitled-Black.ufo",
      "Untitled-Regular.ufo",
    ]);
    expect(marked(family, "Untitled-Black.ufo")).toBe("# bold");
    expect(renamed?.notes.join(" ")).toMatch(/Untitled-Bold\.ufo is no longer part of the family/);

    await store.removeMaster("bold");
    await store.saveToFolder();
    expect([...family.folders.keys()]).toEqual(["Untitled-Regular.ufo"]);
    // Still a family's folder: it has been one, and stays one.
    expect([...family.files.keys()]).toEqual(["Untitled.designspace"]);
  });

  it("leaves alone a UFO in the folder that it did not write", async () => {
    const { store, place } = await twoMasters();
    await store.saveToFolder();
    const family = familyIn(place);
    family.put("Sketches.ufo/metainfo.plist", "somebody's own");

    mark(store, "regular, again");
    await store.saveToFolder();

    expect(family.all().get("Sketches.ufo/metainfo.plist")).toBe("somebody's own");
  });
});

describe("opening a family's folder", () => {
  it("reads every master the designspace names", async () => {
    const { store, place } = await twoMasters();
    await store.saveToFolder();
    const family = familyIn(place);

    // Another editor, another font: the folder opened from scratch. A copy of
    // it, since the first editor is still there and has the family open — the
    // same folder would be the same font, and this editor only reading it.
    const copy = new FakeFolder("Elsewhere");
    for (const [path, text] of family.all()) copy.put(path, text);
    const other = await opened();
    offer(copy);
    const report = await other.openFolder();

    expect(report?.warnings[0]).toBe("2 masters: Regular, Bold");
    const project = other.getState().project;
    expect(project.masters.map((m) => m.name)).toEqual(["Regular", "Bold"]);
    expect(project.axes.map((a) => a.tag)).toEqual(["wght"]);
    expect(open(other)).toBe("# regular");
    expect(other.getState().folder.family).toBe(true);
    expect(dirty(other)).toBe(false);

    const bold = project.masters.find((m) => m.name === "Bold")!.id;
    await other.switchMaster(bold);
    expect(open(other)).toBe("# bold");
  });

  it("read again, replaces every master with what the folder has, and opens the one that was open", async () => {
    const { store, place } = await twoMasters();
    await store.saveToFolder();

    // Changed in both since, and not saved.
    mark(store, "regular, spoiled");
    await store.switchMaster("bold");
    mark(store, "bold, spoiled");

    const family = familyIn(place);
    offer(family);
    await store.reopenFolder();

    const project = store.getState().project;
    expect(project.masters.map((m) => m.name)).toEqual(["Regular", "Bold"]);
    expect(project.masters.find((m) => m.id === project.current)?.name).toBe("Bold");
    expect(open(store)).toBe("# bold");

    const regular = project.masters.find((m) => m.name === "Regular")!.id;
    await store.switchMaster(regular);
    expect(open(store)).toBe("# regular");
    expect(dirty(store)).toBe(false);
  });

  it("still opens a font's own UFO as one font, a master of a family or not", async () => {
    const { store, place } = await twoMasters();
    await store.saveToFolder();
    const ufo = familyIn(place).folders.get("Untitled-Bold.ufo")!;

    const other = await opened();
    offer(ufo);
    await other.openFolder();

    expect(other.getState().project.masters).toHaveLength(1);
    expect(other.getState().folder.family).toBe(false);
    expect(open(other)).toBe("# bold");
  });
});

describe("a family's folder, the next time the font is opened", () => {
  it("is known to be behind for a master changed and left before the window closed", async () => {
    const files = new MemoryFileStore();
    const store = await opened(files);
    const id = store.getState().projects.current!;
    mark(store, "regular");
    offer(new FakeFolder("Fonts"));
    await store.saveFolderAs();
    const regular = store.getState().project.current;
    await store.setAxes([WEIGHT]);
    await store.addMaster("bold", "Bold", { wght: 900 });
    await store.saveToFolder();
    expect(dirty(store)).toBe(false);

    await store.switchMaster("bold");
    mark(store, "bold");
    await store.switchMaster(regular);
    await store.flushNow();

    const again = await opened(files, id);
    expect(again.getState().folder.family).toBe(true);
    expect(again.getState().folder.others).toEqual(["bold"]);
    expect(dirty(again)).toBe(true);
  });

  it("is not behind where everything was saved", async () => {
    const files = new MemoryFileStore();
    const store = await opened(files);
    const id = store.getState().projects.current!;
    offer(new FakeFolder("Fonts"));
    await store.saveFolderAs();
    await store.setAxes([WEIGHT]);
    await store.addMaster("bold", "Bold", { wght: 900 });
    await store.saveToFolder();
    await store.flushNow();

    const again = await opened(files, id);
    expect(dirty(again)).toBe(false);
  });
});

describe("a font drawn once", () => {
  it("is kept as the one UFO it always was", async () => {
    const store = await opened();
    const place = new FakeFolder("Fonts");
    offer(place);
    await store.saveFolderAs();

    expect([...place.folders.keys()]).toEqual(["Untitled-Regular.ufo"]);
    expect(store.getState().folder.family).toBe(false);

    // And is read back as it was written.
    const other = await opened();
    offer(place.folders.get("Untitled-Regular.ufo")!);
    await other.openFolder();
    expect(other.getState().project.masters).toHaveLength(1);
  });
});
