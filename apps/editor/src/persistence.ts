import { FIRST_PROJECT } from "@typewright/disk";
import type { FontDocument } from "@typewright/font-model";
import {
  type ImageEntry,
  type StoredDesignspace,
  Autosave,
  type AutosaveStatus,
  type LoadedProject,
  type SnapshotEntry,
  type StoredLayer,
  ProjectLock,
  StorageClient,
  browserLocks,
  projectLock,
  dirtyGlyphs,
  removedGlyphs,
  requestPersistence,
} from "@typewright/storage";

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
  /**
   * Null until a project has been opened, because the lock is named after it.
   * Nothing writes before `open`, so there is no window in which this being
   * absent means "unlocked" rather than "nothing to lock yet".
   */
  private lock: ProjectLock | null = null;
  private readonly autosave: Autosave;
  private lastJournalled: FontDocument | null = null;
  private owner = true;

  /**
   * @param report Called whenever the disk side changes something the interface
   *   shows. Never called synchronously from the constructor.
   */
  constructor(private readonly report: (changes: PersistenceReport) => void) {
    this.autosave = new Autosave({
      journal: (document) => this.journal(document),
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
      saved: (document) => {
        this.journalSaved(document);
        this.report({ saveStatus: this.autosave.status });
      },
      failed: (error) => {
        this.report({ saveStatus: "failed", storageDetail: error.message });
      },
    });
  }

  /**
   * The journal's writes, one after another in the order they were asked for.
   *
   * A record is a glyph as it was at one commit, and the journal is read back
   * by taking the last record of each glyph — so the order they are written in
   * is what they mean, and two commits journalled side by side could leave an
   * older glyph after a newer one.
   */
  private journalling: Promise<void> = Promise.resolve();
  /**
   * Which emptying of the journal a write belongs before. A write still waiting
   * its turn when the journal is emptied is of a font the save has since made
   * true or untrue, and is let go rather than written into the empty journal —
   * where it stayed, and brought a glyph since renamed or removed back the next
   * time the font was opened.
   */
  private journalEpoch = 0;

  /** Note what a commit changed, as one record, after the commits before it. */
  private journal(document: FontDocument): Promise<void> {
    if (!this.owner) return Promise.resolve();

    // Worked out now, against the commit before this one, and not when the
    // writing gets round to it: by then there may have been three more.
    const changed = dirtyGlyphs(this.lastJournalled, document);
    // And the glyphs it took away: removed, renamed, or added and undone.
    const removed = removedGlyphs(this.lastJournalled, document);
    // And the order they are in, where that is not the order they were in.
    const order =
      this.lastJournalled !== null && this.lastJournalled.glyphOrder !== document.glyphOrder
        ? document.glyphOrder
        : null;
    this.lastJournalled = document;
    const epoch = this.journalEpoch;

    this.journalling = this.journalling
      .then(async () => {
        if (epoch !== this.journalEpoch) return;
        // One record for the commit: whole in the journal, or not in it.
        await this.client?.journalCommit(changed, removed, order);
      })
      .catch(() => {
        // A journal write that failed is not worth stopping the next one for;
        // the save that follows is what matters.
      });
    return this.journalling;
  }

  /**
   * The font is on disk as `document`: the journal is of nothing any more.
   *
   * Emptied at once — asked for now, not once the records queued before it
   * have had their turn. Those are let go by the epoch: the one being written
   * as this is asked was asked first and so is written first, and none after
   * it is asked for at all. Waiting behind them left the journal standing for
   * as long as they took, and a window closed in that time opened next on a
   * journal of the font before the save: a glyph added and then removed was
   * back. What has been committed since that document — while it was being
   * saved — is not on disk and is journalled again, against it.
   */
  private journalSaved(document: FontDocument): void {
    this.journalEpoch += 1;
    const cleared = this.client?.clearJournal().catch(() => undefined);
    this.journalling = this.journalling.then(async () => {
      await cleared;
    });

    this.lastJournalled = document;
    const later = this.autosave.pending;
    if (later !== null && later !== document) void this.journal(later);
  }

  /**
   * The lock for one project, listening for the moment another tab takes it.
   *
   * Losing it has to stop writes at once, not at the next save: the tab that
   * took it is now the truth, and this one still believes in the font it had.
   */
  private lockFor(project: string): ProjectLock {
    return new ProjectLock(
      browserLocks(),
      () => {
        this.owner = false;
        this.report({ ownership: "reading", saveStatus: "idle" });
      },
      projectLock(project),
    );
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
  async open(
    worker: Worker,
    project: string = FIRST_PROJECT,
    /** Told how many glyph files have been read, of how many. */
    progress?: (done: number, total: number) => void,
  ): Promise<LoadedProject | null> {
    try {
      const client = new StorageClient(worker);
      this.client = client;
      // The project's id names its directory, so two fonts are two working
      // copies rather than one that the second one opened overwrites.
      await client.open(project);

      this.lock = this.lockFor(project);
      this.owner = await this.lock.tryAcquire();
      this.report({ ownership: this.owner ? "owner" : "reading" });

      const loaded = await this.read(progress);
      if (loaded === null) return null;
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
      // What a commit is measured against, from the first one. Left unset, the
      // first edit after a font was opened journalled every glyph it has.
      this.lastJournalled = document;
      if (dirty && this.owner) await this.autosave.flush();
      this.report({ storage: "ready", saveStatus: this.autosave.status });

      if (!(await requestPersistence())) {
        console.info("[storage] persistence not granted; the browser may evict this data");
      }
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * Leave this font's working copy and open another one's.
   *
   * Everything held is per-project and all of it has to change together: the
   * directory the worker writes into, the lock that says this tab may write,
   * and the journal's idea of what it last wrote. Doing it in this order
   * matters — what is pending is flushed while the old copy is still the one
   * being written to, and the lock on it is dropped before the new one is
   * taken, so a tab moving between two fonts never holds both.
   *
   * Returns what is in the new working copy, which for a font opened for the
   * first time is nothing at all.
   */
  async moveTo(project: string): Promise<LoadedProject | null> {
    try {
      if (this.owner) await this.autosave.flush();
      this.lock?.releaseLock();
      this.lock = null;

      await this.client?.open(project);

      this.lock = this.lockFor(project);
      this.owner = await this.lock.tryAcquire();
      this.report({ ownership: this.owner ? "owner" : "reading" });

      // The journal compares against what it last wrote, and what it last wrote
      // was to a different font. Nothing here is a change to this one, and
      // nothing still waiting to be written there belongs here.
      this.journalEpoch += 1;
      this.lastJournalled = null;

      return await this.read();
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  /** Take the project over from whichever tab holds it. */
  async steal(): Promise<boolean> {
    if (this.owner) return false;
    if (this.lock === null || !(await this.lock.steal())) return false;
    this.owner = true;
    this.report({ ownership: "owner" });
    return true;
  }

  /** Read the project back from disk, or `null` when there is no store. */
  async reload(): Promise<LoadedProject | null> {
    return await this.read();
  }

  /**
   * Read the font, and take out the files of glyphs the journal removed.
   *
   * The document read does not have them; their files are still there. Taken
   * out here, by the tab that may write: the save that follows writes only what
   * the document has, and would leave them to come back the time after.
   */
  private async read(
    progress?: (done: number, total: number) => void,
  ): Promise<LoadedProject | null> {
    const client = this.client;
    if (client === null) return null;
    const loaded = await client.load(progress);
    if (loaded.kind === "loaded" && this.owner && loaded.gone.length > 0) {
      await client.removeGlyphs(loaded.gone);
    }
    return loaded;
  }

  /** Tell autosave the document moved. Cheap when it did not. */
  commit(document: FontDocument): void {
    this.autosave.commit(document);
  }

  /** Adopt a document as exactly what is on disk, without writing anything. */
  markLoaded(document: FontDocument, dirty: boolean): void {
    this.autosave.markLoaded(document, dirty);
    this.lastJournalled = document;
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
  async replaceAll(
    document: FontDocument,
    /** The master this document is, written with it: see `MASTER_PATH` in storage. */
    master: string | null = null,
  ): Promise<void> {
    const client = this.client;
    // A tab that does not own the project must not replace it. The buttons that
    // lead here are disabled, so this is the backstop rather than the message.
    if (client === null || !this.owner) return;

    await this.autosave.abandon();
    this.report({ saveStatus: "saving" });

    // The journal goes with the font it was of. A record still waiting its turn
    // is of the font being replaced — another master, as often as not — and
    // written after this it would be in the new font's journal, to be read back
    // in the next time it was opened: a glyph of one master turning up in
    // another. So what is waiting is let go, and from here a commit is measured
    // against the document being written, which is what the journal it lands in
    // will be beside.
    this.journalEpoch += 1;
    this.lastJournalled = document;
    await client.replaceAll(document, master);

    // Disk now holds exactly this document, so autosave starts from it rather
    // than believing every glyph is still unwritten — and keeps whatever was
    // committed while it was being written, which is newer than it.
    this.autosave.rebase(document);
    this.report({ saveStatus: this.autosave.status });
  }

  flush(): void {
    void this.flushNow().catch(() => undefined);
  }

  /** The same, and finished: for when there may be no later to finish it in. */
  async flushNow(): Promise<void> {
    // The journal of what is about to be saved, first. A save a second after
    // an edit finds it long written; one asked for at once — a window closing
    // on the heels of an edit — was writing the glyph files of three commits
    // while the journal held the first of them, and stopped part of the way
    // left files of the last commit beside a journal of the first: a glyph
    // under its new name and its old one both.
    await this.journalling;
    await this.autosave.flush();
    // And the journal settled: emptied where the save has made it untrue, and
    // every record that is still true written.
    await this.journalling;
  }

  /**
   * Keep a copy of the whole font as it is now.
   *
   * Refused without the lock, like every other write. Returns the copies there
   * are afterwards, or an empty list where there is no store — the editor works
   * without one, and so does this, by keeping nothing and saying so.
   */
  async snapshot(
    document: FontDocument,
    at: number = Date.now(),
    /** The master it is a copy of, where the font has several. */
    master: string | null = null,
  ): Promise<readonly SnapshotEntry[]> {
    const client = this.client;
    if (client === null || !this.owner) return [];
    return await client.snapshot(document, at, master);
  }

  async snapshots(): Promise<readonly SnapshotEntry[]> {
    return (await this.client?.snapshots()) ?? [];
  }

  /** One snapshot as a document again, or `null` where it has gone. */
  async readSnapshot(
    at: number,
  ): Promise<{ document: FontDocument; problems: readonly string[] } | null> {
    return (await this.client?.readSnapshot(at)) ?? null;
  }

  // ---- the masters that are not being drawn -------------------------------

  /**
   * Park a master, whole.
   *
   * Refused without the lock, as every write is. Switching master in a tab that
   * is only reading somebody else's project changes what is on the screen and
   * nothing on the disk, which is the right answer for a reader.
   */
  async putMaster(master: string, document: FontDocument): Promise<void> {
    if (this.client === null || !this.owner) return;
    await this.client.putMaster(master, document);
  }

  async getMaster(
    master: string,
  ): Promise<{ document: FontDocument; problems: readonly string[] } | null> {
    return (await this.client?.getMaster(master)) ?? null;
  }

  async dropMaster(master: string): Promise<void> {
    if (this.client === null || !this.owner) return;
    await this.client.dropMaster(master);
  }

  async putDesignspace(designspace: {
    axes: unknown;
    masters: unknown;
    current: string;
    instances: unknown;
    rules: unknown;
    rulesProcessing: string;
    kept: unknown;
  }): Promise<void> {
    if (this.client === null || !this.owner) return;
    await this.client.putDesignspace(designspace);
  }

  async getDesignspace(): Promise<StoredDesignspace | null> {
    return (await this.client?.getDesignspace()) ?? null;
  }

  // ---- the pictures a font is traced from --------------------------------

  /**
   * Put an image in the font, or replace one of the same name.
   *
   * Refused without the lock, as every other write is: a tab that is only
   * reading somebody else's project must not add megabytes to it.
   */
  async putImage(name: string, bytes: Uint8Array): Promise<ImageEntry | null> {
    const client = this.client;
    if (client === null || !this.owner) return null;
    return await client.putImage(name, bytes);
  }

  async getImage(name: string): Promise<Uint8Array | null> {
    return (await this.client?.getImage(name)) ?? null;
  }

  async images(): Promise<readonly ImageEntry[]> {
    return (await this.client?.images()) ?? [];
  }

  /** Every picture in the font, for handing it to something that wants it whole. */
  async allImages(): Promise<Map<string, Uint8Array>> {
    const out = new Map<string, Uint8Array>();
    for (const entry of await this.images()) {
      const bytes = await this.getImage(entry.name);
      if (bytes !== null) out.set(entry.name, bytes);
    }
    return out;
  }

  async removeImage(name: string): Promise<void> {
    if (this.client === null || !this.owner) return;
    await this.client.removeImage(name);
  }

  /**
   * The layers of the source this editor does not edit, kept whole.
   *
   * They belong to the font as much as the pictures do and are as large, so
   * they live here rather than on the document — and they have to survive a
   * reload, because the save that would drop them is the one that comes after
   * it.
   */
  async putLayers(layers: readonly StoredLayer[]): Promise<void> {
    if (this.client === null || !this.owner) return;
    await this.client.putLayers(layers);
  }

  async layers(): Promise<readonly StoredLayer[]> {
    return (await this.client?.layers()) ?? [];
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
