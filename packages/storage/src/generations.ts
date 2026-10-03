import type { FileStore } from "./file-store.js";
import { inParallel } from "./parallel.js";

/**
 * A font's own files kept so that replacing them all is one step.
 *
 * Opening a font, switching master and restoring a copy each write a whole new
 * font over the one in the working copy: a few thousand glyph files, then the
 * font's info. Written over in place, a reload or a crash part of the way
 * through left a font that was neither — the old one's info over some of the
 * new one's glyphs, and the file being written when it stopped cut off — and it
 * opened as if nothing had happened.
 *
 * So the font's own files — its glyphs, its info, its kerning and the journal
 * of edits not yet saved — live in a numbered *generation*, a folder of their
 * own. A replacement is written into the next one beside it, and only when
 * every file is down does a new pointer file make it the current one; the old
 * generation is then removed. Until the pointer is written the old font is
 * the font, whatever happened to the new one; a generation left half written
 * is cleared away the next time the working copy is opened.
 *
 * The pointer is a file of its own for each generation, `generation.N`, holding
 * the generation's name. It is created rather than overwritten, so stopping
 * while it is written leaves either no file or one whose contents are not the
 * name — and that is read as no pointer, never as a broken one. The highest
 * generation with a whole pointer is current.
 *
 * Everything else in the working copy — pictures, the copies kept as you work,
 * the masters not being drawn — is not part of a replacement and stays where it
 * was. A working copy written before generations has its font's files at the
 * top, and is read from there until it is first replaced.
 */
export class GenerationalStore implements FileStore {
  private constructor(
    private readonly inner: FileStore,
    /** The current generation's folder, or `""` for a working copy that has none yet. */
    private current: string,
    private number: number,
  ) {}

  /** The store over a working copy, its current generation found and the leftovers cleared. */
  static async over(inner: FileStore): Promise<GenerationalStore> {
    const names = await inner.list("");
    let best = 0;
    for (const path of names) {
      const n = pointerNumber(path);
      if (n === null || n <= best) continue;
      if ((await inner.read(path)) === pointerText(n)) best = n;
    }
    const store = new GenerationalStore(inner, best === 0 ? "" : folderOf(best), best);
    await store.clearLeftovers(names);
    return store;
  }

  /** Whether a path is one of the font's own files, which belong to a generation. */
  private static owns(path: string): boolean {
    return path.startsWith(GLYPHS) || OWN_FILES.has(path);
  }

  private at(path: string, folder = this.current): string {
    if (!GenerationalStore.owns(path) || folder === "") return path;
    return `${folder}/${path}`;
  }

  read(path: string): Promise<string | null> {
    return this.inner.read(this.at(path));
  }
  write(path: string, contents: string): Promise<void> {
    return this.inner.write(this.at(path), contents);
  }
  readBytes(path: string): Promise<Uint8Array | null> {
    return this.inner.readBytes(this.at(path));
  }
  writeBytes(path: string, contents: Uint8Array): Promise<void> {
    return this.inner.writeBytes(this.at(path), contents);
  }
  append(path: string, contents: string): Promise<void> {
    return this.inner.append(this.at(path), contents);
  }
  remove(path: string): Promise<void> {
    return this.inner.remove(this.at(path));
  }

  /**
   * Paths beginning with `prefix`, as the rest of storage names them: the
   * font's own files without their generation's folder. Asked for everything,
   * the answer is everything, folders and pointers included — which is what
   * removing everything wants.
   */
  async list(prefix: string): Promise<string[]> {
    if (prefix === "" || this.current === "" || !GenerationalStore.owns(prefix)) {
      return this.inner.list(prefix);
    }
    const folder = `${this.current}/`;
    return (await this.inner.list(`${folder}${prefix}`)).map((path) => path.slice(folder.length));
  }

  /**
   * Write a whole font as the next generation, and make it the current one.
   *
   * `write` is handed a store that writes into the next generation, and does
   * everything the replacement is made of through it. Nothing the rest of
   * storage reads changes until it has finished and the pointer is down.
   */
  /**
   * Forget the generations, for a working copy that has just been emptied: what
   * is written next goes at the top, as it would in a new one, rather than into
   * a generation whose pointer is gone and which the next open would clear.
   */
  emptied(): void {
    this.current = "";
    this.number = 0;
  }

  async replace(write: (next: FileStore) => Promise<void>): Promise<void> {
    const number = this.number + 1;
    const folder = folderOf(number);
    const next: FileStore = {
      read: (path) => this.inner.read(this.at(path, folder)),
      write: (path, contents) => this.inner.write(this.at(path, folder), contents),
      readBytes: (path) => this.inner.readBytes(this.at(path, folder)),
      writeBytes: (path, contents) => this.inner.writeBytes(this.at(path, folder), contents),
      append: (path, contents) => this.inner.append(this.at(path, folder), contents),
      remove: (path) => this.inner.remove(this.at(path, folder)),
      list: async (prefix) =>
        (await this.inner.list(this.at(prefix, folder))).map((path) =>
          path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path,
        ),
    };
    await write(next);

    // The step that makes it so.
    await this.inner.write(pointerName(number), pointerText(number));
    this.current = folder;
    this.number = number;

    // The old generation, and the pointer to it. A working copy from before
    // generations has its font's files at the top, and those go instead.
    await this.clearLeftovers(await this.inner.list(""));
  }

  /**
   * Remove what no longer belongs: generations other than the current one,
   * their pointers, and — once there is a generation — a font's files left at
   * the top from before there were any.
   */
  private async clearLeftovers(names: readonly string[]): Promise<void> {
    const mine = this.current === "" ? null : `${this.current}/`;
    const folders = new Set<number>();
    const files: string[] = [];
    for (const path of names) {
      const n = pointerNumber(path);
      if (n !== null) {
        if (n !== this.number) files.push(path);
        continue;
      }
      const generation = generationOf(path);
      if (generation !== null) {
        if (generation !== this.number) folders.add(generation);
        continue;
      }
      // The font's own files at the top, from before generations.
      if (mine !== null && GenerationalStore.owns(path)) files.push(path);
    }

    // A folder in one step where the store can; otherwise its files one by one.
    const removeFolder = this.inner.removeFolder?.bind(this.inner);
    for (const n of folders) {
      if (removeFolder !== undefined) await removeFolder(folderOf(n));
      else {
        for (const path of names) if (generationOf(path) === n) files.push(path);
      }
    }
    await inParallel(files, (path) => this.inner.remove(path));
    // The glyphs folder at the top, emptied, where the store keeps folders.
    if (mine !== null && removeFolder !== undefined && names.some((p) => p.startsWith(GLYPHS))) {
      await removeFolder("glyphs");
    }
  }
}

/** The folder glyph files live in, inside a generation or at the top. */
const GLYPHS = "glyphs/";

/** The font's own files that are not glyphs. */
const OWN_FILES = new Set(["fontinfo.json", "kerning.json", "journal.ndjson"]);

const folderOf = (n: number): string => `generation-${String(n)}`;
const pointerName = (n: number): string => `generation.${String(n)}`;
const pointerText = (n: number): string => `${folderOf(n)}\n`;

/** The generation a pointer file names, or `null` for anything else. */
function pointerNumber(path: string): number | null {
  const found = /^generation\.(\d+)$/.exec(path);
  return found === null ? null : Number(found[1]);
}

/** The generation a file is inside, or `null` for one at the top. */
function generationOf(path: string): number | null {
  const found = /^generation-(\d+)\//.exec(path);
  return found === null ? null : Number(found[1]);
}

/** Whether a store keeps generations, and so can replace a font in one step. */
export function isGenerational(store: FileStore): store is GenerationalStore {
  return store instanceof GenerationalStore;
}
