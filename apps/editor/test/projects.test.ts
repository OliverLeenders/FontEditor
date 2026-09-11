import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installFakeIdb } from "../../../packages/disk/test/fake-idb.js";
import { FakeFolder } from "../../../packages/disk/test/fake-folder.js";
import { clearStoredSettings, installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { EditorStore } = await import("../src/store/index.js");
const { arrive } = await import("../src/store/projects.js");
const { newProject, projectById, rememberFolder, saveProject } = await import("@typewright/disk");
const { updateGlyph } = await import("@typewright/font-model");

type Store = InstanceType<typeof EditorStore>;

function freshStore(): Store {
  clearStoredSettings();
  return new EditorStore();
}

const folder = (name: string): Parameters<typeof rememberFolder>[0] =>
  ({
    name,
    getFileHandle: () => Promise.reject(new Error("not a real folder")),
  }) as unknown as Parameters<typeof rememberFolder>[0];

/** Change the font, so it is no longer the one that was saved. */
function move(store: Store): void {
  const name = store.editor.currentGlyph;
  const document = updateGlyph(store.editor.document, name, (g) => ({
    ...g,
    advance: g.advance + 10,
  }));
  if (document === null) throw new Error("the glyph the editor is on is not in the font");
  store.setEditor({ ...store.editor, document });
}

let restore: () => void;

beforeEach(() => {
  ({ restore } = installFakeIdb());
});

afterEach(() => {
  restore();
});

describe("what the editor does with its first moment", () => {
  it("lists the working copy there has always been, when nothing is recorded", async () => {
    // It may hold somebody's font, done before projects existed and never saved
    // to a folder. An empty list would leave "New font" the only way past it.
    const arrival = await arrive(false);

    expect(arrival.kind).toBe("choose");
    expect(arrival.kind === "choose" ? arrival.all.map((it) => it.id) : []).toEqual(["project"]);
  });

  it("asks even when there is only one font", async () => {
    await saveProject({ ...newProject("Only"), id: "only" });

    const arrival = await arrive(false);
    expect(arrival.kind).toBe("choose");
    expect(arrival.kind === "choose" ? arrival.all.map((it) => it.name) : []).toEqual(["Only"]);
  });

  it("asks when there is more than one", async () => {
    await saveProject({ ...newProject("One"), id: "a", openedAt: 100 });
    await saveProject({ ...newProject("Two"), id: "b", openedAt: 200 });

    const arrival = await arrive(false);
    expect(arrival.kind).toBe("choose");
    expect(arrival.kind === "choose" ? arrival.all.map((it) => it.name) : []).toEqual([
      "Two",
      "One",
    ]);
  });

  it("opens the most recent instead, for a reader who asked not to be asked", async () => {
    await saveProject({ ...newProject("One"), id: "a", openedAt: 100 });
    await saveProject({ ...newProject("Two"), id: "b", openedAt: 200 });

    const arrival = await arrive(true);
    expect(arrival.kind === "open" ? arrival.id : null).toBe("b");
  });

  it("goes straight into the working copy for a reader who skips, with nothing recorded", async () => {
    const arrival = await arrive(true);
    expect(arrival.kind === "open" ? arrival.id : null).toBe("project");
  });

  it("lists the font of an editor that only ever knew one", async () => {
    await rememberFolder(folder("Times.ufo"));

    const arrival = await arrive(false);
    expect(arrival.kind === "choose" ? arrival.all.map((it) => it.id) : []).toEqual(["project"]);
  });

  it("does not add a second untitled font on the next start", async () => {
    await arrive(false);
    const arrival = await arrive(false);
    expect(arrival.kind === "choose" ? arrival.all : []).toHaveLength(1);
  });
});

describe("deciding what to open", () => {
  it("gives the same answer however many times it is asked", async () => {
    // React runs a start-up effect twice in development. Reading the font a
    // reload was sent to open clears that note, so a second, independent
    // decision would find nothing and show the list again.
    await saveProject({ ...newProject("One"), id: "a" });
    await saveProject({ ...newProject("Two"), id: "b" });
    const store = freshStore();
    localStorage.setItem("typewright.project", "b");

    const first = await store.decideArrival(false);
    const second = await store.decideArrival(false);

    expect(first).toEqual({ kind: "open", id: "b" });
    expect(second).toEqual(first);
  });

  it("covers the editor until something is decided", () => {
    const store = freshStore();
    expect(store.getState().projects.arriving).toBe(true);

    store.offerProjects([]);
    expect(store.getState().projects.arriving).toBe(false);
  });
});

describe("the chooser on screen", () => {
  it("is not shown until something asks for it", () => {
    const store = freshStore();
    expect(store.getState().projects.showing).toBe(false);
  });

  it("shows the list with nothing open yet", () => {
    const store = freshStore();
    store.offerProjects([
      { id: "a", name: "One", folder: "One.ufo", openedAt: 1, savedAt: null },
      { id: "b", name: "Two", folder: null, openedAt: 2, savedAt: null },
    ]);

    expect(store.getState().projects.showing).toBe(true);
    expect(store.getState().projects.current).toBeNull();
    expect(store.getState().projects.all).toHaveLength(2);
  });

  it("can be put away again", () => {
    const store = freshStore();
    store.showProjects(true);
    store.showProjects(false);
    expect(store.getState().projects.showing).toBe(false);
  });

  it("remembers a reader who would rather not be asked", () => {
    const store = freshStore();
    expect(store.getState().skipChooser).toBe(false);

    store.setSkipChooser(true);
    expect(store.getState().skipChooser).toBe(true);
    expect(new EditorStore().getState().skipChooser).toBe(true);
  });
});

describe("what closing would leave behind", () => {
  it("is nothing, when no folder is open", () => {
    const store = freshStore();
    expect(store.unsavedOnDisk).toBe(false);
  });

  it("is nothing, when the font is as the folder has it", () => {
    const store = freshStore();
    store.patch({
      folder: { ...store.getState().folder, name: "Times.ufo", saved: store.editor.document },
    });

    expect(store.unsavedOnDisk).toBe(false);
  });

  it("is something, once the font has moved on from the folder", () => {
    const store = freshStore();
    store.patch({
      folder: { ...store.getState().folder, name: "Times.ufo", saved: store.editor.document },
    });

    move(store);
    expect(store.unsavedOnDisk).toBe(true);
  });

  it("stays nothing while the work is only in the working copy", () => {
    // No folder, so there is nowhere for the font to be behind. The working
    // copy has it, which is what the warning is deliberately not about.
    const store = freshStore();
    move(store);
    expect(store.unsavedOnDisk).toBe(false);
  });
});

/** Put a folder behind the picker, as the browser would. */
function offer(folder: FakeFolder): void {
  (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = () =>
    Promise.resolve(folder);
}

/** A store working on project `p`, saved once to a folder of its own. */
async function savedOnce(): Promise<Store> {
  const store = freshStore();
  await saveProject({ ...newProject("Keep"), id: "p" });
  store.patch({ projects: { ...store.getState().projects, current: "p" } });
  offer(new FakeFolder("Keep.ufo"));
  await store.saveFolderAs();
  return store;
}

/** The same font, opened again by a store that never saw it saved. */
function restarted(from: Store): Store {
  const store = new EditorStore();
  store.setEditor({ ...store.editor, document: from.editor.document });
  return store;
}

describe("a save, as the next session finds it", () => {
  it("is recorded on the font's project, where startup looks", async () => {
    await savedOnce();

    const project = await projectById("p");
    expect(project?.folder?.name).toBe("Keep.ufo");
    expect(project?.wrote.length).toBeGreaterThan(0);
    expect(project?.savedHash).not.toBeNull();
    expect(project?.savedAt).not.toBeNull();
  });

  it("carries what it wrote, so the first save after a restart is not a rewrite", async () => {
    const first = await savedOnce();
    const second = restarted(first);

    await second.noteProjects("p");
    expect(second.getState().folder.written.size).toBe(first.getState().folder.written.size);
  });

  it("recognises the font on screen as the one on disk", async () => {
    const second = restarted(await savedOnce());

    await second.noteProjects("p");
    expect(second.unsavedOnDisk).toBe(false);
  });

  it("knows a font that moved on before the restart is behind its folder", async () => {
    const second = restarted(await savedOnce());
    move(second);

    await second.noteProjects("p");
    expect(second.unsavedOnDisk).toBe(true);
  });

  it("stops being behind once it is saved again", async () => {
    const second = restarted(await savedOnce());
    move(second);
    await second.noteProjects("p");

    await second.saveFolder();
    expect(second.unsavedOnDisk).toBe(false);
  });
});
