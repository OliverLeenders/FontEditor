import type { FileStore } from "@typewright/storage";
import { describe, expect, it } from "vitest";

import {
  type Files,
  type Store,
  WEIGHT,
  copyOf,
  mark,
  markOf,
  opened,
  printOf,
} from "./walk-harness.js";

const { MemoryFileStore } = await import("@typewright/storage");

/**
 * Storage that is full.
 *
 * A browser gives a site so much room and refuses a write past it. Nothing was
 * lost by that in itself — the font is in the window — but the save said
 * `failed` and was not tried again until something was drawn, and a font being
 * opened, which is the usual thing to fill the room, was not tried again at
 * all: it stayed on screen over a working copy that still held the font
 * before. These ask that a save refused is said as what it is, is tried again
 * unasked, and lands whole once there is room.
 */

/** What a browser throws at a write there is no room for. */
function noRoom(): Error {
  const error = new Error("The quota has been exceeded.");
  error.name = "QuotaExceededError";
  return error;
}

/** A working copy with no room for some of what is written to it, while it is told so. */
class FullFiles implements FileStore {
  /** Which writes there is no room for; none, to begin with. */
  refuses: (path: string) => boolean = () => false;

  constructor(readonly inner: Files) {}

  private room(path: string): void {
    if (this.refuses(path)) throw noRoom();
  }

  read(path: string): Promise<string | null> {
    return this.inner.read(path);
  }
  readBytes(path: string): Promise<Uint8Array | null> {
    return this.inner.readBytes(path);
  }
  list(prefix: string): Promise<string[]> {
    return this.inner.list(prefix);
  }
  remove(path: string): Promise<void> {
    return this.inner.remove(path);
  }
  async write(path: string, contents: string): Promise<void> {
    this.room(path);
    await this.inner.write(path, contents);
  }
  async writeBytes(path: string, contents: Uint8Array): Promise<void> {
    this.room(path);
    await this.inner.writeBytes(path, contents);
  }
  async append(path: string, contents: string): Promise<void> {
    this.room(path);
    await this.inner.append(path, contents);
  }
}

const settled = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** The font a working copy opens as, and the master it opens on. */
async function reopened(files: Files): Promise<Store> {
  return await opened(await copyOf(files));
}

describe("storage that is full", () => {
  it("says so, keeps the edit, and saves it once there is room", async () => {
    const files = new FullFiles(new MemoryFileStore());
    const store = await opened(files);
    mark(store, "saved while there was room");
    await store.flushNow();

    files.refuses = () => true;
    mark(store, "drawn with no room left");
    await store.flushNow().catch(() => undefined);
    await settled();

    expect(store.getState().saveStatus).toBe("failed");
    expect(store.getState().storageDetail).toBe("this browser's storage is full");
    expect(store.notSaved).toBe(true);
    // In the window still, and on disk the font as it was last saved.
    expect(markOf(store.editor.document)).toBe("drawn with no room left");
    expect(markOf((await reopened(files.inner)).editor.document)).toBe(
      "saved while there was room",
    );

    files.refuses = () => false;
    await store.flushNow();
    await settled();

    expect(store.getState().saveStatus).toBe("idle");
    expect(store.notSaved).toBe(false);
    expect(markOf((await reopened(files.inner)).editor.document)).toBe("drawn with no room left");
  });

  it("owes a whole font it had no room to write, and writes it whole when there is", async () => {
    const files = new FullFiles(new MemoryFileStore());
    const store = await opened(files);
    mark(store, "the regular");
    await store.setAxes([WEIGHT]);
    await store.addMaster("bold", "Bold", { wght: 900 });
    await store.switchMaster("bold");
    mark(store, "the bold");
    const regular = store.getState().project.masters.find((m) => m.id !== "bold")!.id;
    await store.switchMaster(regular);
    await store.flushNow();
    await settled();

    // Room for everything but a font written whole, which is the large thing.
    files.refuses = (path) => path.endsWith("glyphs.pack");
    await store.switchMaster("bold").catch(() => undefined);
    await settled();

    const shown = printOf(store.editor.document);
    const drawing = store.getState().project.current;
    expect(store.getState().saveStatus).toBe("failed");
    expect(store.getState().storageDetail).toBe("this browser's storage is full");

    files.refuses = () => false;
    await store.flushNow();
    await settled();
    expect(store.getState().saveStatus).toBe("idle");

    // What is on disk is what is on screen: that master, as that master.
    const again = await reopened(files.inner);
    expect(again.getState().project.current).toBe(drawing);
    expect(printOf(again.editor.document)).toBe(shown);
    // And the other is still itself.
    const other = drawing === "bold" ? regular : "bold";
    await again.switchMaster(other);
    expect(markOf(again.editor.document)).toBe(other === "bold" ? "the bold" : "the regular");
  });
});
