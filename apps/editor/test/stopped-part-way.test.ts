import { describe, expect, it } from "vitest";

import {
  type Files,
  type Store,
  StoppingFiles,
  WEIGHT,
  copyOf,
  mark,
  opened,
  printOf,
} from "./walk-harness.js";

const { MemoryFileStore } = await import("@typewright/storage");
const { createGlyphs, deleteGlyph, renameCurrentGlyph } = await import("@typewright/tools");

/**
 * Everything the store writes in more than one step, stopped after every step.
 *
 * A tab is closed, a browser is killed, a laptop runs out of battery: whatever
 * was being written stops where it had got to. Going to another master is a
 * dozen files; removing one, restoring a copy, closing the window after a glyph
 * was added are each several. The font that is opened afterwards has to be a
 * font — and each of these was once a way to open one master's drawing under
 * another's name, or a glyph nobody had any more.
 *
 * So each is run to the end once, to learn what it writes and what the font is
 * afterwards; and then again from the same beginning for every number of
 * changes it might have got through before stopping. After each, the working
 * copy is opened as it was left and every master is gone to. What is asked is
 * that each master is whole and is itself: as it was at some moment on the way
 * from before to after, and never another master's drawing or a glyph that
 * was in none of those moments.
 *
 * At some moment, and its glyphs and the rest of it each at a moment of their
 * own. What is promised of an edit not yet saved is that the glyphs it changed
 * are in the journal, a commit at a time; the features and the font's
 * information are safe at the next save, a second later, and until then are as
 * they last were saved. So a font stopped between the two may open with the
 * glyphs of one moment and the information of an earlier one — but each is of
 * a moment that was.
 */

/** What a working copy opens as: the master open, and every master's font in a line. */
type Found = { open: string; masters: Map<string, string> };

/** A font's line in its two halves: its glyphs, and the rest of it. */
function halves(print: string): { glyphs: string; rest: string } {
  const { glyphs, ...rest } = JSON.parse(print) as { glyphs: unknown };
  return { glyphs: JSON.stringify(glyphs), rest: JSON.stringify(rest) };
}

/** Every state each master has been seen in, a half at a time. */
class Moments {
  private readonly glyphs = new Map<string, Set<string>>();
  private readonly rest = new Map<string, Set<string>>();

  add(id: string, print: string): void {
    const half = halves(print);
    this.glyphs.set(id, (this.glyphs.get(id) ?? new Set()).add(half.glyphs));
    this.rest.set(id, (this.rest.get(id) ?? new Set()).add(half.rest));
  }

  addAll(found: Found): void {
    for (const [id, print] of found.masters) this.add(id, print);
  }

  /** What is wrong with a master opening as this, or `null` where it is a moment that was. */
  wrong(id: string, print: string): string | null {
    const half = halves(print);
    if (this.glyphs.get(id)?.has(half.glyphs) !== true)
      return `glyphs that never were: ${half.glyphs}`;
    if (this.rest.get(id)?.has(half.rest) !== true)
      return `information that never was: ${half.rest}`;
    return null;
  }
}

/** Open a copy of a working copy, and go to each of its masters. */
async function found(files: Files): Promise<Found> {
  const store = await opened(await copyOf(files));
  const open = store.getState().project.current;
  const masters = new Map<string, string>([[open, printOf(store.editor.document)]]);
  for (const m of [...store.getState().project.masters]) {
    if (m.id === open) continue;
    await store.switchMaster(m.id);
    masters.set(m.id, printOf(store.editor.document));
  }
  return { open, masters };
}

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Run `act` on a font made by `setup`, stopped after every number of changes
 * to its files it could have got through, and ask each time that what is left
 * opens as a font that was or would have been.
 */
async function stoppedAnywhere(
  setup: (store: Store) => Promise<void>,
  act: (store: Store) => Promise<void>,
): Promise<number> {
  const base: Files = new MemoryFileStore();
  const first = await opened(base);
  await setup(first);
  await first.flushNow();
  const before = await found(base);

  // To the end once: how many changes it makes, and what the font is after.
  const whole = new StoppingFiles(await copyOf(base));
  const through = await opened(whole);
  const start = whole.changes;
  // And every state the open master is in on the way.
  const moments = new Moments();
  moments.addAll(before);
  const watch = (): void => {
    moments.add(through.getState().project.current, printOf(through.editor.document));
  };
  const unwatch = through.subscribe(watch);
  await act(through);
  await through.flushNow();
  unwatch();
  const changes = whole.changes - start;
  const after = await found(whole.inner);
  moments.addAll(after);

  for (let n = 0; n < changes; n++) {
    const files = new StoppingFiles(await copyOf(base));
    const store = await opened(files);
    files.arm(n);

    // Whatever it throws once the files have stopped is the stopping.
    await act(store).catch(() => undefined);
    await store.flushNow().catch(() => undefined);
    await settled();

    const where = `stopped after ${String(n)} of ${String(changes)} changes`;
    let got: Found;
    try {
      got = await found(files.inner);
    } catch (error) {
      throw new Error(`${where}: could not be opened again: ${String(error)}`, { cause: error });
    }

    expect([before.open, after.open], `${where}: the master open`).toContain(got.open);
    const ids = [...got.masters.keys()].sort().join(",");
    expect(
      [[...before.masters.keys()].sort().join(","), [...after.masters.keys()].sort().join(",")],
      `${where}: the masters there are`,
    ).toContain(ids);
    for (const [id, print] of got.masters) {
      if (process.env["STOP_TRACE"] !== undefined && moments.wrong(id, print) !== null) {
        console.log("TRACE", where, moments.wrong(id, print));
        console.log("TRACE files", (await files.inner.list("")).join(" "));
        console.log("TRACE journal", await files.inner.read("journal.ndjson"));
      }
      expect(moments.wrong(id, print), `${where}: master ${id}`).toBeNull();
    }
  }
  return changes;
}

/** A regular and a bold, each marked as itself, the regular open. */
async function twoMasters(store: Store): Promise<void> {
  mark(store, "the regular");
  await store.setAxes([WEIGHT]);
  await store.addMaster("bold", "Bold", { wght: 900 });
  await store.switchMaster("bold");
  mark(store, "the bold");
  await store.switchMaster(store.getState().project.masters.find((m) => m.id !== "bold")!.id);
}

describe("stopped part of the way", () => {
  it("going to another master", { timeout: 120_000 }, async () => {
    const changes = await stoppedAnywhere(twoMasters, async (store) => {
      await store.switchMaster("bold");
    });
    expect(changes).toBeGreaterThan(3);
  });

  it("going to another master with edits behind it", { timeout: 120_000 }, async () => {
    await stoppedAnywhere(twoMasters, async (store) => {
      mark(store, "the regular, again");
      store.applyTool(createGlyphs(store.editor, [{ name: "fresh" }], 500));
      await store.switchMaster("bold");
    });
  });

  it("removing the master being drawn", { timeout: 120_000 }, async () => {
    await stoppedAnywhere(
      async (store) => {
        await twoMasters(store);
        await store.switchMaster("bold");
      },
      async (store) => {
        await store.removeMaster("bold");
      },
    );
  });

  it("removing another master", { timeout: 120_000 }, async () => {
    await stoppedAnywhere(twoMasters, async (store) => {
      await store.removeMaster("bold");
    });
  });

  it("adding a master", { timeout: 120_000 }, async () => {
    await stoppedAnywhere(twoMasters, async (store) => {
      await store.addMaster("light", "Light", { wght: 100 });
    });
  });

  it("putting a copy back", { timeout: 120_000 }, async () => {
    let at = 0;
    await stoppedAnywhere(
      async (store) => {
        await twoMasters(store);
        await store.snapshot();
        at = store.getState().snapshots[0]!.at;
        mark(store, "the regular, spoiled");
      },
      async (store) => {
        await store.refreshSnapshots();
        await store.restoreSnapshot(at);
      },
    );
  });

  it(
    "closing the window after glyphs were added, renamed and removed",
    { timeout: 120_000 },
    async () => {
      await stoppedAnywhere(
        async (store) => {
          mark(store, "the font");
        },
        async (store) => {
          store.applyTool(createGlyphs(store.editor, [{ name: "fresh" }], 500));
          store.setCurrentGlyph("o");
          store.applyTool(renameCurrentGlyph(store.editor, "o.alt"));
          store.applyTool(deleteGlyph(store.editor, "e"));
          await Promise.resolve();
        },
      );
    },
  );

  it("closing the window with a change the other masters share", { timeout: 120_000 }, async () => {
    await stoppedAnywhere(twoMasters, async (store) => {
      store.applyTool(createGlyphs(store.editor, [{ name: "fresh" }], 500));
      store.setFeatures("# the family's", true);
      await Promise.resolve();
    });
  });

  it("renaming a master", { timeout: 120_000 }, async () => {
    await stoppedAnywhere(twoMasters, async (store) => {
      await store.renameMaster("bold", "Black");
    });
  });
});
