import { describe, expect, it, onTestFinished, vi } from "vitest";

import { FakeFolder } from "../../../packages/disk/test/fake-folder.js";
import { installFakeIdb } from "../../../packages/disk/test/fake-idb.js";
import { FakeWorker } from "../../../packages/storage/test/fake-worker.js";
import { clearStoredSettings, installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { EditorStore } = await import("../src/store/index.js");
const { MemoryFileStore } = await import("@typewright/storage");
const { setInfo } = await import("@typewright/tools");
const { ufoFiles } = await import("@typewright/font-io");
const { writeFolder } = await import("@typewright/disk");

const { copyOfOpenMaster } = await import("../src/store/snapshots.js");

type Store = InstanceType<typeof EditorStore>;

/**
 * Going from one master to another, with a store behind it.
 *
 * Which master is open and which drawing is on screen have to change together.
 * They came apart after a reload: the project holds only the open master's
 * document then, would not go to one it was not holding, and so showed the
 * other master's drawing under the name of the one left — and the next switch
 * parked that drawing there, over the master's own. These ask for the pair to
 * stay a pair, and for each master to keep its own drawing through it.
 */

/**
 * A store opened on a working copy, as the editor is after a load.
 *
 * Each working copy is its own font, with its own lock. An editor opened on one
 * that an earlier editor still holds — which is what a reload looks like here,
 * where nothing ends the first — takes it over, as "Edit here instead" does.
 */
async function opened(files: InstanceType<typeof MemoryFileStore>): Promise<Store> {
  clearStoredSettings();
  let font = fonts.get(files);
  if (font === undefined) {
    font = `font-${String(fonts.size)}`;
    fonts.set(files, font);
  }
  const store = new EditorStore();
  await store.connectStorage(new FakeWorker(files) as unknown as Worker, font);
  if (store.getState().ownership === "reading") await store.takeOver();
  return store;
}

const fonts = new Map<object, string>();

/**
 * Which master's drawing is open, by a mark written in it: an edit, committed
 * and saved as any edit in the editor is. Written in what a master keeps to
 * itself — the name of its own style — since what the masters share is carried
 * from one to the next and would say the same in all of them.
 */
const drawing = (store: Store): string =>
  store.editor.document.info.openTypeNamePreferredSubfamilyName;

/** Write that mark in the open master. */
const draw = (store: Store, text: string): void => {
  store.applyTool(setInfo(store.editor, { openTypeNamePreferredSubfamilyName: text }));
};

const WEIGHT = { tag: "wght", name: "Weight", min: 100, default: 400, max: 900 };

/** Two masters, each marked as itself, left open on the second: the font in the working copy. */
async function twoMasters(files: InstanceType<typeof MemoryFileStore>): Promise<{
  store: Store;
  regular: string;
}> {
  const store = await opened(files);
  const regular = store.getState().project.current;
  draw(store, "# the regular");

  await store.setAxes([WEIGHT]);
  await store.addMaster("bold", "Bold", { wght: 900 });
  await store.switchMaster("bold");
  draw(store, "# the bold");
  await store.flushNow();
  return { store, regular };
}

describe("going to another master", () => {
  it("shows its drawing and says it is the one open, in the session that made it", async () => {
    const { store, regular } = await twoMasters(new MemoryFileStore());

    await store.switchMaster(regular);
    expect(store.getState().project.current).toBe(regular);
    expect(drawing(store)).toBe("# the regular");

    await store.switchMaster("bold");
    expect(store.getState().project.current).toBe("bold");
    expect(drawing(store)).toBe("# the bold");
  });

  it("does the same after a reload, when only the open master is in memory", async () => {
    const files = new MemoryFileStore();
    const { regular } = await twoMasters(files);

    // The reload: a new editor over the same working copy.
    const store = await opened(files);
    expect(store.getState().project.current).toBe("bold");
    expect(drawing(store)).toBe("# the bold");

    await store.switchMaster(regular);
    // The name and the drawing, together.
    expect(store.getState().project.current).toBe(regular);
    expect(drawing(store)).toBe("# the regular");
  });

  it("leaves each master its own drawing, however often they are gone between", async () => {
    const files = new MemoryFileStore();
    const { regular } = await twoMasters(files);
    const store = await opened(files);

    await store.switchMaster(regular);
    await store.switchMaster("bold");
    await store.switchMaster(regular);
    await store.switchMaster("bold");
    expect(drawing(store)).toBe("# the bold");

    await store.switchMaster(regular);
    expect(drawing(store)).toBe("# the regular");

    // And what was written down agrees, for the reload after this one. The
    // master gone to is written into the working copy after the switch has
    // answered, and a window waits for that before it closes.
    await store.flushNow();
    const again = await opened(files);
    expect(again.getState().project.current).toBe(regular);
    expect(drawing(again)).toBe("# the regular");
    await again.switchMaster("bold");
    expect(drawing(again)).toBe("# the bold");
  });

  it("does not put back the project as it was when masters were read in for a preview", async () => {
    const files = new MemoryFileStore();
    const { regular } = await twoMasters(files);
    const store = await opened(files);

    // Asked for together: the preview reads the parked master in while the
    // switch is on its way.
    const preview = store.setPreview({ wght: 650 });
    const going = store.switchMaster(regular);
    await Promise.all([preview, going]);

    expect(store.getState().project.current).toBe(regular);
    expect(drawing(store)).toBe("# the regular");
  });
});

describe("a switch on a font that takes a while to write", () => {
  it("has answered once the drawing is shown, with the writing still to come", async () => {
    const files = new MemoryFileStore();
    const { store, regular } = await twoMasters(files);

    await store.switchMaster(regular);
    // On screen, and the one open — and the working copy not yet made its own.
    expect(drawing(store)).toBe("# the regular");
    expect(store.getState().saveStatus).toBe("saving");

    await store.flushNow();
    expect(store.getState().saveStatus).toBe("idle");
    const again = await opened(files);
    expect(again.getState().project.current).toBe(regular);
    expect(drawing(again)).toBe("# the regular");
  });

  it("keeps what is typed while the master is being written", async () => {
    const files = new MemoryFileStore();
    const { store, regular } = await twoMasters(files);

    await store.switchMaster(regular);
    // Not a glyph, so in no journal: only the save that follows can keep it.
    draw(store, "# typed while it was written");
    await store.flushNow();

    const again = await opened(files);
    expect(drawing(again)).toBe("# typed while it was written");
  });

  it("waits for the one before, when masters are gone between quickly", async () => {
    const files = new MemoryFileStore();
    const { store, regular } = await twoMasters(files);

    // Neither waited for before the next is asked.
    const one = store.switchMaster(regular);
    const two = one.then(() => store.switchMaster("bold"));
    await two;
    await store.flushNow();

    expect(store.getState().project.current).toBe("bold");
    const again = await opened(files);
    expect(again.getState().project.current).toBe("bold");
    expect(drawing(again)).toBe("# the bold");
    await again.switchMaster(regular);
    expect(drawing(again)).toBe("# the regular");
  });
});

describe("adding a master", () => {
  it("copies the drawing as it stands, for an export that never visits it", async () => {
    const store = await opened(new MemoryFileStore());
    draw(store, "# edited before adding");
    await store.setAxes([WEIGHT]);
    await store.addMaster("bold", "Bold", { wght: 900 });

    const all = await store.allMasters();
    expect(all.find((m) => m.id === "bold")?.document.info.openTypeNamePreferredSubfamilyName).toBe(
      "# edited before adding",
    );
  });
});

describe("removing the master being drawn", () => {
  it("changes the name and the drawing together", async () => {
    const { store, regular } = await twoMasters(new MemoryFileStore());
    // Every state the store passes through: which master, over which drawing.
    const seen = new Set<string>();
    store.subscribe(() => {
      const current = store.getState().project.current === regular ? "regular" : "bold";
      seen.add(`${current} over ${drawing(store)}`);
    });

    await store.removeMaster("bold");

    expect(store.getState().project.masters.map((m) => m.id)).toEqual([regular]);
    expect(drawing(store)).toBe("# the regular");
    // Never the one's name over the other's drawing, at any step on the way.
    expect([...seen]).not.toContain("regular over # the bold");
    expect([...seen]).not.toContain("bold over # the regular");
    expect([...seen]).toContain("regular over # the regular");
  });

  it("removes nothing when the other master cannot be read", async () => {
    const files = new MemoryFileStore();
    const { store, regular } = await twoMasters(files);
    await files.remove(`masters/${regular}.json`);

    await expect(store.removeMaster("bold")).rejects.toThrow(/could not be read back/);
    expect(store.getState().project.masters).toHaveLength(2);
    expect(store.getState().project.current).toBe("bold");
    expect(drawing(store)).toBe("# the bold");
  });
});
describe("a working copy and a designspace that disagree", () => {
  it("opens as the master the working copy says it holds", async () => {
    const files = new MemoryFileStore();
    const { store, regular } = await twoMasters(files);
    await store.switchMaster(regular);
    await store.flushNow();

    // Stopped between the two writes of a switch: the glyphs are the regular's,
    // and the designspace still calls the bold the one open.
    const designspace = JSON.parse((await files.read("designspace.json"))!) as { current: string };
    expect(designspace.current).toBe(regular);
    await files.write("designspace.json", JSON.stringify({ ...designspace, current: "bold" }));

    const again = await opened(files);
    expect(again.getState().project.current).toBe(regular);
    expect(drawing(again)).toBe("# the regular");

    // And so the bold is still the bold, when it is gone to.
    await again.switchMaster("bold");
    expect(drawing(again)).toBe("# the bold");
  });

  it("goes by the designspace where the working copy does not say", async () => {
    const files = new MemoryFileStore();
    await twoMasters(files);
    // A working copy from before it said.
    for (const name of await files.list("")) {
      if (name.endsWith("master.txt")) await files.remove(name);
    }

    const again = await opened(files);
    expect(again.getState().project.current).toBe("bold");
    expect(drawing(again)).toBe("# the bold");
  });
});

describe("copies of the font, in a font drawn more than once", () => {
  /** The copies the History menu would list, as which master each is of. */
  const listed = (store: Store): (string | null)[] =>
    store
      .getState()
      .snapshots.filter((entry) => copyOfOpenMaster(entry, store.getState().project))
      .map((entry) => entry.master);

  it("are each master's own: kept in one, not offered in the other", async () => {
    const { store, regular } = await twoMasters(new MemoryFileStore());

    // Beside whatever was kept while the font had one master, which does not
    // say and is offered to both.
    await store.snapshot();
    expect(listed(store)).toContain("bold");

    await store.switchMaster(regular);
    await store.refreshSnapshots();
    expect(listed(store)).not.toContain("bold");

    await store.snapshot();
    expect(listed(store)).toContain(regular);
    expect(listed(store)).not.toContain("bold");

    await store.switchMaster("bold");
    await store.refreshSnapshots();
    expect(listed(store)).toContain("bold");
    expect(listed(store)).not.toContain(regular);
  });

  it("cannot be put back into another master", async () => {
    const { store, regular } = await twoMasters(new MemoryFileStore());
    await store.snapshot();
    const at = store.getState().snapshots[0]!.at;

    await store.switchMaster(regular);
    await store.refreshSnapshots();

    await expect(store.restoreSnapshot(at)).rejects.toThrow(/copy of Bold/);
    expect(drawing(store)).toBe("# the regular");
  });

  it("are put back into the master they are of, which stays that master", async () => {
    const files = new MemoryFileStore();
    const { store, regular } = await twoMasters(files);
    await store.snapshot();
    const at = store.getState().snapshots[0]!.at;
    draw(store, "# the bold, spoiled");

    await store.restoreSnapshot(at);
    expect(drawing(store)).toBe("# the bold");
    expect(store.getState().project.current).toBe("bold");

    await store.flushNow();
    const again = await opened(files);
    expect(again.getState().project.current).toBe("bold");
    expect(drawing(again)).toBe("# the bold");
    await again.switchMaster(regular);
    expect(drawing(again)).toBe("# the regular");
  });

  it("puts back this master's copy where another's was kept in the same millisecond", async () => {
    const { store, regular } = await twoMasters(new MemoryFileStore());

    // One moment, for both: a copy was asked for by its time alone, and the
    // first found at that time was as often the other master's.
    const at = 5_000_000_000_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    onTestFinished(() => {
      clock.mockRestore();
    });
    await store.switchMaster(regular);
    await store.snapshot();
    await store.switchMaster("bold");
    await store.snapshot();
    clock.mockRestore();
    expect(store.getState().snapshots.filter((it) => it.at === at)).toHaveLength(2);

    draw(store, "# the bold, spoiled");
    await store.restoreSnapshot(at);
    expect(drawing(store)).toBe("# the bold");

    await store.switchMaster(regular);
    draw(store, "# the regular, spoiled");
    await store.restoreSnapshot(at);
    expect(drawing(store)).toBe("# the regular");

    // And named outright, as the list names it, the other master's is refused.
    await expect(store.restoreSnapshot(at, "bold")).rejects.toThrow(/copy of Bold/);
  });

  it("offers a copy from before there was a second master to either", async () => {
    const store = await opened(new MemoryFileStore());
    draw(store, "# drawn once");
    await store.snapshot();
    await store.setAxes([WEIGHT]);
    await store.addMaster("bold", "Bold", { wght: 900 });

    // One or two of them: the first edit keeps a copy of its own, and whether
    // that and the one asked for are two files or one depends on whether a
    // millisecond passed between them. Either way none says, and all are here.
    const before = listed(store);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((master) => master === null)).toBe(true);

    await store.switchMaster("bold");
    await store.refreshSnapshots();
    expect(listed(store)).toEqual(before);
  });
});

describe("a folder read again, in a font drawn more than once", () => {
  it("replaces the drawing in front of you and leaves the other masters", async () => {
    const { restore } = installFakeIdb();
    onTestFinished(restore);
    const files = new MemoryFileStore();
    const store = await opened(files);

    // The font as its folder has it, opened from there.
    draw(store, "# in the folder");
    const folder = new FakeFolder("Test.ufo");
    await writeFolder(folder, ufoFiles(store.editor.document));
    (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = () =>
      Promise.resolve(folder);
    await store.openFolder();
    const regular = store.getState().project.current;

    await store.setAxes([WEIGHT]);
    await store.addMaster("bold", "Bold", { wght: 900 });
    await store.switchMaster("bold");
    draw(store, "# the bold");
    await store.switchMaster(regular);
    draw(store, "# the regular, changed since");

    const report = await store.reopenFolder();

    expect(report?.master).toBe("Regular");
    expect(store.getState().project.masters.map((m) => m.name)).toEqual(["Regular", "Bold"]);
    expect(store.getState().project.current).toBe(regular);
    expect(drawing(store)).toBe("# in the folder");

    await store.switchMaster("bold");
    expect(drawing(store)).toBe("# the bold");
  });
});
