import { describe, expect, it } from "vitest";

import {
  type Files,
  type Store,
  WEIGHT,
  mark,
  markOf,
  opened,
  printOf,
  seeded,
} from "./walk-harness.js";

const { MemoryFileStore } = await import("@typewright/storage");
const { sameStructure } = await import("@typewright/font-model");
const { createGlyphs, deleteGlyph, renameCurrentGlyph } = await import("@typewright/tools");
const { copyOfOpenMaster } = await import("../src/store/snapshots.js");

/**
 * The store, walked at random.
 *
 * Every bug that lost somebody's drawing here was a sequence nobody had thought
 * to write a test for: go to another master *after a reload*; add a master
 * *after an edit* and export *without visiting it*; type *while* the font was
 * being written. A test written by hand is a sequence somebody thought of. So
 * these make the sequences up — a few thousand steps of everything the store
 * can be asked to do, in an order chosen by a seed — and after every step ask
 * the things that must always be true:
 *
 *  - the master the project says is open is the master whose drawing is on
 *    screen, and it is as it was left: no master has another's drawing;
 *  - the font read back after a reload is the font that was there;
 *  - what the masters share is the same in all of them, once the one being
 *    drawn has been left;
 *  - a copy put back is the font it was a copy of;
 *  - nothing the store is asked to do throws.
 *
 * A seed that fails says so with every step it took, so it can be run again.
 */

/** What the walk knows must be true, kept beside the store as it goes. */
type Known = {
  /** Each master's mark, as it was last written while that master was open. */
  marks: Map<string, string>;
  /** The marks before each undoable step of this master's history, newest last. */
  history: string[];
  /** Copies kept on purpose: which master, and what the font was. */
  copies: Map<number, { master: string | null; mark: string; print: string }>;
  /**
   * Whether the masters may differ in what they share: a copy put back is a
   * master as it was, which is not made to agree with the others.
   */
  apart: boolean;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function walk(seed: number, steps: number, withCopies: boolean): Promise<void> {
  const random = seeded(seed);
  const files: Files = new MemoryFileStore();
  let store: Store = await opened(files);
  const log: string[] = [];
  let made = 0;

  const known: Known = { marks: new Map(), history: [], copies: new Map(), apart: false };
  await store.setAxes([WEIGHT]);
  mark(store, "first");
  known.marks.set(store.getState().project.current, "first");
  known.history.push(markOf(store.editor.document) === "first" ? "" : "");

  const current = (): string => store.getState().project.current;
  const masters = (): readonly { id: string; name: string; location: Record<string, number> }[] =>
    store.getState().project.masters;
  const glyphs = (): readonly string[] => store.editor.document.glyphOrder;
  const fresh = (prefix: string): string => `${prefix}${String(++made)}`;
  /**
   * Take a step in the open master's history: an edit, which may be refused —
   * a name that is taken, a glyph another is built from — and is a step only
   * where the font changed.
   */
  const step = (edit: () => void): void => {
    const before = store.editor.document;
    const was = known.marks.get(current()) ?? "";
    edit();
    if (store.editor.document !== before) known.history.push(was);
  };
  /** The open master has been arrived at: its history begins again. */
  const arrived = (): void => {
    known.history = [];
  };

  /** What must be true after every step. */
  const check = (after: string): void => {
    const state = store.getState();
    if (process.env["WALK_TRACE"] === String(seed))
      console.log(
        "TRACE",
        after,
        "| store",
        JSON.stringify(markOf(store.editor.document)),
        "| known",
        JSON.stringify(known.marks.get(state.project.current)),
        "| history",
        JSON.stringify(known.history),
        store.canUndo(),
      );
    const ids = state.project.masters.map((m) => m.id).sort();
    expect(ids, `${after}: the masters there are`).toEqual([...known.marks.keys()].sort());
    expect(ids, `${after}: the open master is one of them`).toContain(state.project.current);
    expect(markOf(store.editor.document), `${after}: the open master's own drawing`).toBe(
      known.marks.get(state.project.current),
    );
  };

  /** What the masters share is the same in all of them. */
  const agree = async (after: string): Promise<void> => {
    if (known.apart) return;
    for (const m of masters()) {
      if (m.id === current()) continue;
      const checked = await store.compareWith(m.id);
      expect(checked, `${after}: ${m.name} can be read`).not.toBeNull();
      expect(
        sameStructure(checked!.structure),
        `${after}: ${m.name} shares what this master has: ${JSON.stringify(checked!.structure)}`,
      ).toBe(true);
    }
  };

  const ops: { name: string; weight: number; can: () => boolean; run: () => Promise<void> }[] = [
    {
      name: "mark",
      weight: 5,
      can: () => true,
      run: async () => {
        const text = fresh("mark");
        step(() => mark(store, text));
        known.marks.set(current(), text);
        await Promise.resolve();
      },
    },
    {
      name: "add a glyph",
      weight: 3,
      can: () => true,
      run: async () => {
        step(() => store.applyTool(createGlyphs(store.editor, [{ name: fresh("g") }], 500)));
        await Promise.resolve();
      },
    },
    {
      name: "remove a glyph",
      weight: 2,
      can: () => glyphs().filter((n) => n !== ".notdef").length > 2,
      run: async () => {
        const gone = random.pick(glyphs().filter((n) => n !== ".notdef"));
        step(() => store.applyTool(deleteGlyph(store.editor, gone)));
        await Promise.resolve();
      },
    },
    {
      name: "rename a glyph",
      weight: 2,
      can: () => glyphs().some((n) => n !== ".notdef"),
      run: async () => {
        store.setCurrentGlyph(random.pick(glyphs().filter((n) => n !== ".notdef")));
        step(() => store.applyTool(renameCurrentGlyph(store.editor, fresh("r"))));
        await Promise.resolve();
      },
    },
    {
      name: "write features",
      weight: 2,
      can: () => true,
      run: async () => {
        step(() => store.setFeatures(`# ${fresh("fea")}`, true));
        await Promise.resolve();
      },
    },
    {
      name: "undo",
      weight: 3,
      can: () => known.history.length > 0 && store.canUndo(),
      run: async () => {
        store.undo();
        known.marks.set(current(), known.history.pop() ?? "");
        await Promise.resolve();
      },
    },
    {
      name: "add a master",
      weight: 2,
      can: () => masters().length < 4,
      run: async () => {
        const taken = new Set(masters().map((m) => m.location["wght"] ?? 400));
        const free = [100, 200, 300, 500, 600, 700, 800, 900].filter((v) => !taken.has(v));
        const id = fresh("m");
        await store.addMaster(id, `Master ${id}`, { wght: random.pick(free) });
        // A copy of the drawing in front of you, mark and all.
        known.marks.set(id, known.marks.get(current()) ?? "");
      },
    },
    {
      name: "go to another master",
      weight: 6,
      can: () => masters().length > 1,
      run: async () => {
        const to = random.pick(masters().filter((m) => m.id !== current()));
        await store.switchMaster(to.id);
        expect(current(), "the master gone to is the one open").toBe(to.id);
        arrived();
        await agree("having gone to another master");
      },
    },
    {
      name: "remove a master",
      weight: 1,
      can: () => masters().length > 1,
      run: async () => {
        const gone = random.pick(masters());
        const wasOpen = gone.id === current();
        await store.removeMaster(gone.id);
        known.marks.delete(gone.id);
        if (wasOpen) arrived();
      },
    },
    {
      name: "export every master",
      weight: 2,
      can: () => true,
      run: async () => {
        const all = await store.allMasters();
        expect(all.map((m) => m.id).sort()).toEqual([...known.marks.keys()].sort());
        for (const m of all) {
          expect(markOf(m.document), `exported: ${m.name}'s own drawing`).toBe(
            known.marks.get(m.id),
          );
        }
        if (!known.apart) {
          const first = all[0]!.document;
          for (const m of all) {
            expect(m.document.glyphOrder, `exported: ${m.name}'s glyphs`).toEqual(first.glyphOrder);
            expect(m.document.features, `exported: ${m.name}'s features`).toBe(first.features);
          }
        }
      },
    },
    {
      name: "close and open again",
      weight: 3,
      can: () => true,
      run: async () => {
        const before = { open: current(), print: printOf(store.editor.document) };
        await store.flushNow();
        store = await opened(files);
        expect(current(), "reopened on the master that was open").toBe(before.open);
        if (
          process.env["WALK_TRACE"] === String(seed) &&
          printOf(store.editor.document) !== before.print
        ) {
          console.log("TRACE was ", before.print);
          console.log("TRACE now ", printOf(store.editor.document));
        }
        expect(printOf(store.editor.document), "reopened as the font that was there").toBe(
          before.print,
        );
        arrived();
      },
    },
    {
      name: "keep a copy",
      weight: withCopies ? 2 : 0,
      can: () => true,
      run: async () => {
        // A moment of its own, so no two copies are kept under one time.
        await sleep(2);
        await store.snapshot();
        const newest = store.getState().snapshots[0];
        expect(newest, "the copy just kept is listed").toBeDefined();
        known.copies.set(newest!.at, {
          master: newest!.master,
          mark: known.marks.get(current()) ?? "",
          print: printOf(store.editor.document),
        });
        await sleep(2);
      },
    },
    {
      name: "put a copy back",
      weight: withCopies ? 2 : 0,
      can: () => known.copies.size > 0,
      run: async () => {
        await store.refreshSnapshots();
        const state = store.getState();
        const mine = state.snapshots.filter(
          (entry) => known.copies.has(entry.at) && copyOfOpenMaster(entry, state.project),
        );
        if (mine.length === 0) return;
        const entry = random.pick(mine);
        const copy = known.copies.get(entry.at)!;

        await store.restoreSnapshot(entry.at);
        expect(printOf(store.editor.document), "put back as the font it was a copy of").toBe(
          copy.print,
        );
        known.marks.set(current(), copy.mark);
        known.apart = true;
        arrived();
      },
    },
  ];

  try {
    check("to begin with");
    for (let n = 0; n < steps; n++) {
      const able = ops.filter((op) => op.weight > 0 && op.can());
      const total = able.reduce((sum, op) => sum + op.weight, 0);
      let at = random.int(total);
      const op = able.find((it) => (at -= it.weight) < 0) ?? able[0]!;
      log.push(op.name);
      await op.run();
      check(`step ${String(n + 1)}, ${op.name}`);
    }

    // And at the end of it all: closed, opened, and every master gone to.
    await store.flushNow();
    store = await opened(files);
    check("opened again at the end");
    for (const m of [...masters()]) {
      if (m.id === current()) continue;
      await store.switchMaster(m.id);
      check(`at the end, in ${m.name}`);
    }
  } catch (error) {
    const says = error instanceof Error ? error.message : String(error);
    throw new Error(
      `seed ${String(seed)} failed after ${String(log.length)} steps: ${says}\n  steps: ${log.join(" → ")}`,
      { cause: error },
    );
  }
}

describe("the store, walked at random", () => {
  // Enough seeds to turn up what a hand-written test would not, and few enough
  // to run with every other test. A seed that fails is named in the failure.
  // WALK_SEEDS and WALK_STEPS ask for more, for a longer look than every run wants.
  const SEEDS = Number(process.env["WALK_SEEDS"] ?? 60);
  const STEPS = Number(process.env["WALK_STEPS"] ?? 50);

  it(
    "keeps every master its own drawing, and what they share the same",
    { timeout: 3_600_000 },
    async () => {
      for (let seed = 1; seed <= SEEDS; seed++) await walk(seed, STEPS, false);
    },
  );

  it(
    "does the same with copies kept and put back along the way",
    { timeout: 3_600_000 },
    async () => {
      for (let seed = 1001; seed <= 1000 + SEEDS / 2; seed++) await walk(seed, STEPS, true);
    },
  );
});
