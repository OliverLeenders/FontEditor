import { describe, expect, it } from "vitest";

import { FakeWorker } from "../../../packages/storage/test/fake-worker.js";
import { clearStoredSettings, installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { EditorStore } = await import("../src/store/index.js");
const { MemoryFileStore } = await import("@typewright/storage");

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
 * and saved as any edit in the editor is.
 */
const drawing = (store: Store): string => store.editor.document.features;

const WEIGHT = { tag: "wght", name: "Weight", min: 100, default: 400, max: 900 };

/** Two masters, each marked as itself, left open on the second: the font in the working copy. */
async function twoMasters(files: InstanceType<typeof MemoryFileStore>): Promise<{
  store: Store;
  regular: string;
}> {
  const store = await opened(files);
  const regular = store.getState().project.current;
  store.setFeatures("# the regular");

  await store.setAxes([WEIGHT]);
  await store.addMaster("bold", "Bold", { wght: 900 });
  await store.switchMaster("bold");
  store.setFeatures("# the bold");
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
    store.setFeatures("# typed while it was written");
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
    store.setFeatures("# edited before adding");
    await store.setAxes([WEIGHT]);
    await store.addMaster("bold", "Bold", { wght: 900 });

    const all = await store.allMasters();
    expect(all.find((m) => m.id === "bold")?.document.features).toBe("# edited before adding");
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
