import type { FontDocument } from "@fonteditor/font-model";
import {
  Autosave,
  type AutosaveStatus,
  type LoadedProject,
  ProjectLock,
  StorageClient,
  browserLocks,
  dirtyGlyphs,
  removedGlyphs,
  requestPersistence,
} from "@fonteditor/storage";

export type StorageState = "connecting" | "ready" | "unavailable";

/**
 * Whether this tab owns the project, and may therefore write to it.
 *
 * `reading` is a full editor over a document it will not save. That is a strange
 * state to be in, so it is named rather than implied by a flag, and the
 * interface says so plainly instead of quietly dropping the work.
 */
export type Ownership = "owner" | "reading";

/** What the store shows about the tab's relationship to disk. */
export type PersistenceReport = {
  readonly storage?: StorageState;
  readonly storageDetail?: string;
  readonly saveStatus?: AutosaveStatus;
  readonly ownership?: Ownership;
};

/**
 * Everything between the editor and the disk: the worker, the journal, the
 * autosave timer, and the lock that decides which tab may write at all.
 *
 * Separate from the store because the two answer different questions. The store
 * answers what is on screen; this answers what is on disk and whether we are
 * allowed to change it. The seam is narrow on purpose — nothing here knows about
 * sessions, selections or the camera, and the store does not know that a save is
 * a journal pass followed by a glyph pass.
 *
 * Ownership is the reason it is a class rather than a few functions. A tab that
 * loses the lock has to stop writing at once, and that arrives asynchronously
 * from another tab, so something has to be listening.
 */
export class Persistence {
  private client: StorageClient | null = null;
  private readonly lock: ProjectLock;
  private readonly autosave: Autosave;
  private lastJournalled: FontDocument | null = null;
  private owner = true;

  /**
   * @param report Called whenever the disk side changes something the interface
   *   shows. Never called synchronously from the constructor.
   */
  constructor(private readonly report: (changes: PersistenceReport) => void) {
    // Losing the lock has to stop writes at once, not at the next save: the tab
    // that took it is now the truth, and this one still believes in the font it
    // had.
    this.lock = new ProjectLock(browserLocks(), () => {
      this.owner = false;
      this.report({ ownership: "reading", saveStatus: "idle" });
    });

    this.autosave = new Autosave({
      journal: async (document) => {
        if (!this.owner) return;
        for (const g of dirtyGlyphs(this.lastJournalled, document)) {
          await this.client?.journal(g);
        }
        this.lastJournalled = document;
      },
      save: async (document, previous) => {
        if (!this.owner) return;
        await this.client?.saveGlyphs(dirtyGlyphs(previous, document));
        // Before the index is rewritten, so a crash in between leaves files the
        // index still lists rather than files it does not.
        await this.client?.removeGlyphs(removedGlyphs(previous, document));
        await this.client?.saveFontInfo(document);
        // Only when it moved: the table is persistent, so this is exact, and it
        // can be large enough that rewriting it on every stroke would show.
        if (previous === null || previous.kerning !== document.kerning) {
          await this.client?.saveKerning(document);
        }
      },
      saved: () => {
        void this.client?.clearJournal();
        this.report({ saveStatus: this.autosave.status });
      },
      failed: (error) => {
        this.report({ saveStatus: "failed", storageDetail: error.message });
      },
    });
  }

  /** Whether this tab may write. Every path to disk is gated on it. */
  get writable(): boolean {
    return this.owner;
  }

  get status(): AutosaveStatus {
    return this.autosave.status;
  }

  /**
   * Open the store and take the lock if it is free.
   *
   * Returns what was on disk, or `null` when there is nothing there or the store
   * could not be opened at all — everything above works without storage, and a
   * browser without OPFS should still give a usable editor that simply cannot
   * remember anything.
   *
   * The lock is taken *before* the read, so a tab that cannot write never
   * journals or saves on the way to finding that out.
   */
  async open(worker: Worker): Promise<LoadedProject | null> {
    try {
      const client = new StorageClient(worker);
      this.client = client;
      await client.open("project");

      this.owner = await this.lock.tryAcquire();
      this.report({ ownership: this.owner ? "owner" : "reading" });

      const loaded = await client.load();
      if (loaded.kind === "loaded") {
        for (const problem of loaded.problems) console.warn("[storage]", problem);
      }
      return loaded;
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  /**
   * Say what state the document is in relative to disk, and settle it there.
   *
   * `dirty` means the copy in memory is ahead of the glyph files — recovered
   * from the journal, or never written at all — in which case it is flushed
   * rather than left for the next edit to notice.
   */
  async settle(document: FontDocument, dirty: boolean): Promise<void> {
    try {
      this.autosave.markLoaded(document, dirty && this.owner);
      if (dirty && this.owner) await this.autosave.flush();
      this.report({ storage: "ready", saveStatus: this.autosave.status });

      if (!(await requestPersistence())) {
        console.info("[storage] persistence not granted; the browser may evict this data");
      }
    } catch (error) {
      this.fail(error);
    }
  }

  /** Take the project over from whichever tab holds it. */
  async steal(): Promise<boolean> {
    if (this.owner) return false;
    if (!(await this.lock.steal())) return false;
    this.owner = true;
    this.report({ ownership: "owner" });
    return true;
  }

  /** Read the project back from disk, or `null` when there is no store. */
  async reload(): Promise<LoadedProject | null> {
    return (await this.client?.load()) ?? null;
  }

  /** Tell autosave the document moved. Cheap when it did not. */
  commit(document: FontDocument): void {
    this.autosave.commit(document);
  }

  /** Adopt a document as exactly what is on disk, without writing anything. */
  markLoaded(document: FontDocument, dirty: boolean): void {
    this.autosave.markLoaded(document, dirty);
  }

  /**
   * Write a whole new font over whatever is there.
   *
   * `replaceAll` rather than the per-glyph path: a few thousand glyphs is one
   * round trip and one pass over the directory, and it is the only route that
   * clears out the font being replaced.
   *
   * Autosave is abandoned first. A save scheduled or running from the previous
   * font would otherwise land after the replacement and put its glyphs back, so
   * the font just discarded returns on the next load.
   */
  async replaceAll(document: FontDocument): Promise<void> {
    const client = this.client;
    // A tab that does not own the project must not replace it. The buttons that
    // lead here are disabled, so this is the backstop rather than the message.
    if (client === null || !this.owner) return;

    await this.autosave.abandon();
    this.report({ saveStatus: "saving" });
    await client.replaceAll(document);

    // Disk now holds exactly this document, so autosave starts from it rather
    // than believing every glyph is still unwritten.
    this.autosave.markLoaded(document, false);
    // Disk holds every glyph of this document, so nothing is ahead of it and the
    // font just replaced must not be what the next journal pass diffs against.
    this.lastJournalled = document;
    this.report({ saveStatus: this.autosave.status });
  }

  flush(): void {
    void this.autosave.flush();
  }

  /** Give up on storage, saying why. The editor keeps working without it. */
  private fail(error: unknown): void {
    this.client = null;
    this.report({
      storage: "unavailable",
      storageDetail: error instanceof Error ? error.message : String(error),
    });
  }
}
