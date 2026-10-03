import type { FontDocument } from "@typewright/font-model";
import type { FileStore } from "@typewright/storage";

import { FakeWorker } from "../../../packages/storage/test/fake-worker.js";
import { clearStoredSettings, installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { EditorStore } = await import("../src/store/index.js");
const { MemoryFileStore } = await import("@typewright/storage");
const { setInfo } = await import("@typewright/tools");

/**
 * What the tests that walk the store at random, and the ones that stop it part
 * of the way, have in common: an editor over a working copy, a way of telling
 * one master's drawing from another's, and a way of saying what a font is in a
 * line that two fonts can be compared by.
 */

export type Store = InstanceType<typeof EditorStore>;
export type Files = InstanceType<typeof MemoryFileStore>;

export const WEIGHT = { tag: "wght", name: "Weight", min: 100, default: 400, max: 900 };

let fonts = 0;

/**
 * An editor opened on a working copy, under a name nothing else has.
 *
 * A name of its own each time, so that no two editors here contend for one
 * font's lock: a "reload" in these tests is a new editor over the same files,
 * and the editor before it is simply not used again.
 */
export async function opened(files: FileStore): Promise<Store> {
  clearStoredSettings();
  const store = new EditorStore();
  fonts += 1;
  await store.connectStorage(
    new FakeWorker(files as unknown as Files) as unknown as Worker,
    `walk-${String(fonts)}`,
  );
  return store;
}

/** A copy of a working copy, file for file, to do something to without touching the first. */
export async function copyOf(files: Files): Promise<Files> {
  const copy = new MemoryFileStore();
  for (const [path, text] of Object.entries(files.snapshot())) await copy.write(path, text);
  return copy;
}

/**
 * The mark of the master that is open: something written in what a master
 * keeps to itself, so it says whose drawing is on screen whatever the masters
 * share.
 */
export const markOf = (document: FontDocument): string =>
  document.info.openTypeNamePreferredSubfamilyName;

/** Write that mark in the open master, as an edit like any other. */
export function mark(store: Store, text: string): void {
  store.applyTool(setInfo(store.editor, { openTypeNamePreferredSubfamilyName: text }));
}

/**
 * A font in a line: its mark, its glyphs in order with what each is, and its
 * features. Two documents with one line are one font as far as these tests
 * can lose anything.
 */
export function printOf(document: FontDocument): string {
  return JSON.stringify({
    mark: markOf(document),
    features: document.features,
    glyphs: document.glyphOrder.map((name) => {
      const g = document.glyphs[name];
      return [name, g?.advance, g?.unicodes, g?.contours.length];
    }),
  });
}

/**
 * A working copy that stops being written to part of the way, as a tab closed
 * or a browser killed stops.
 *
 * Counts every call that changes a file. Armed with a number, it lets that
 * many through and refuses everything after — reads as well, since a tab that
 * has gone reads nothing either.
 */
export class StoppingFiles implements FileStore {
  /** Calls that changed a file, so far. */
  changes = 0;
  private stopAt: number | null = null;
  private stopped = false;

  constructor(readonly inner: Files) {}

  /** Let this many more changes through, and then stop. */
  arm(more: number): void {
    this.stopAt = this.changes + more;
  }

  get hasStopped(): boolean {
    return this.stopped;
  }

  private alive(): void {
    if (this.stopped) throw new Error("the tab was closed");
  }

  private changing(): void {
    this.alive();
    if (this.stopAt !== null && this.changes >= this.stopAt) {
      this.stopped = true;
      throw new Error("the tab was closed");
    }
    this.changes += 1;
  }

  async read(path: string): Promise<string | null> {
    this.alive();
    return await this.inner.read(path);
  }
  async readBytes(path: string): Promise<Uint8Array | null> {
    this.alive();
    return await this.inner.readBytes(path);
  }
  async list(prefix: string): Promise<string[]> {
    this.alive();
    return await this.inner.list(prefix);
  }
  async write(path: string, contents: string): Promise<void> {
    this.changing();
    await this.inner.write(path, contents);
  }
  async writeBytes(path: string, contents: Uint8Array): Promise<void> {
    this.changing();
    await this.inner.writeBytes(path, contents);
  }
  async append(path: string, contents: string): Promise<void> {
    this.changing();
    await this.inner.append(path, contents);
  }
  async remove(path: string): Promise<void> {
    this.changing();
    await this.inner.remove(path);
  }
}

/** A random number generator that gives the same numbers for the same seed. */
export function seeded(seed: number): {
  /** A whole number from 0 up to, and not including, `below`. */
  int: (below: number) => number;
  pick: <T>(from: readonly T[]) => T;
} {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (below: number): number => Math.floor(next() * below);
  return {
    int,
    pick: <T>(from: readonly T[]): T => {
      const one = from[int(from.length)];
      if (one === undefined) throw new Error("nothing to pick from");
      return one;
    },
  };
}
