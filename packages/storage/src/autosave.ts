import type { FontDocument } from "@fonteditor/font-model";

/**
 * Decides *when* to write, having been told *what* changed.
 *
 * Two things happen on a commit, and the order matters:
 *
 *  1. The journal is appended immediately — one small write, so a crash inside
 *     the debounce window costs nothing.
 *  2. A real save is scheduled, batching a burst of edits into one round of file
 *     writes, and clearing the journal once it lands.
 *
 * Timers are injected so the whole thing can be driven deterministically in a
 * test instead of waiting out real seconds.
 */
export type AutosaveHooks = {
  /** Called immediately on every commit. Should be cheap. */
  journal: (document: FontDocument) => Promise<void>;
  /** Called after the quiet period, with the glyphs that actually changed. */
  save: (document: FontDocument, previous: FontDocument | null) => Promise<void>;
  /** Called once a save has landed, so the journal can be dropped. */
  saved?: (document: FontDocument) => void;
  /** Called when a save throws. Autosave must never take the app down with it. */
  failed?: (error: Error) => void;
};

export type AutosaveOptions = {
  /** Quiet period before writing, in milliseconds. */
  readonly debounceMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => number;
  readonly clearTimer?: (handle: number) => void;
};

export const DEFAULT_DEBOUNCE_MS = 1000;

export type AutosaveStatus = "idle" | "pending" | "saving" | "failed";

export class Autosave {
  private timer: number | null = null;
  private lastSaved: FontDocument | null = null;
  private queued: FontDocument | null = null;
  private inFlight = false;
  /** The write currently in progress, so it can be waited on. */
  private writing: Promise<void> | null = null;
  private state: AutosaveStatus = "idle";

  private readonly debounceMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => number;
  private readonly clearTimer: (handle: number) => void;

  constructor(
    private readonly hooks: AutosaveHooks,
    options: AutosaveOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  get status(): AutosaveStatus {
    return this.state;
  }

  /** True when there are committed edits not yet written. */
  get dirty(): boolean {
    return this.queued !== null && this.queued !== this.lastSaved;
  }

  /**
   * Tell autosave a document was committed.
   *
   * Cheap to call with an unchanged document: reference comparison finds nothing
   * dirty and no timer is set, so a caller need not work out whether anything
   * actually happened.
   */
  commit(document: FontDocument): void {
    // Reference equality, not a glyph diff. The document is persistent, so any
    // change at all — a glyph, the metrics, the order, the kerning — produces a
    // new object, and asking only about glyphs meant a kerning edit scheduled
    // no save whatsoever.
    if (this.lastSaved === document) return;

    this.queued = document;
    this.state = "pending";
    void this.hooks.journal(document).catch(() => {
      // A failed journal write is not worth interrupting the user for; the real
      // save is still coming and is the one that matters.
    });

    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /** Write now, without waiting out the quiet period. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }

    const document = this.queued;
    if (document === null || this.inFlight) return;
    if (this.lastSaved === document) {
      this.state = "idle";
      return;
    }

    this.inFlight = true;
    this.state = "saving";
    const write = (async (): Promise<void> => {
      try {
        await this.hooks.save(document, this.lastSaved);
        this.lastSaved = document;
        this.state = this.queued === document ? "idle" : "pending";
        this.hooks.saved?.(document);
      } catch (error) {
        this.state = "failed";
        this.hooks.failed?.(error instanceof Error ? error : new Error(String(error)));
      } finally {
        this.inFlight = false;
        this.writing = null;
      }
    })();

    this.writing = write;
    await write;
  }

  /**
   * Give up any scheduled or running write, and wait for one already in flight.
   *
   * What to call before replacing the whole project — an import, or starting a
   * new font. Without it, a save scheduled a moment earlier lands *after* the
   * replacement has cleaned the old glyph files and writes them straight back,
   * so the discarded font returns on the next load. The in-flight one cannot be
   * recalled, so it is waited out instead: its writes then happen before the
   * replacement rather than after it, and the replacement wins.
   */
  async abandon(): Promise<void> {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.writing !== null) await this.writing;

    this.queued = null;
    this.state = "idle";
  }

  /**
   * Adopt a document at startup, saying whether any of it is actually on disk.
   *
   * The distinction is easy to get wrong and there are two ways to get it wrong,
   * both of which leave disk permanently behind the truth:
   *
   *  - A document **recovered from the journal** is newer than the files. It was
   *    committed but never written.
   *  - A document that is **there because the store was empty** — a new project,
   *    or a starter font — has never been written at all.
   *
   * In both cases calling it saved means nothing is ever flushed until the user
   * happens to touch something, and then only the part they touched. Only a
   * document read back from the glyph files is genuinely already on disk.
   */
  markLoaded(document: FontDocument, unwritten: boolean): void {
    // A timer left armed from before would flush against the new baseline.
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (!unwritten) {
      this.markSaved(document);
      return;
    }
    this.lastSaved = null;
    this.queued = document;
    this.state = "pending";
  }

  /**
   * Adopt a document as already written — what a fresh load should call, so the
   * first edit does not re-save something that just came off disk.
   */
  markSaved(document: FontDocument): void {
    this.lastSaved = document;
    this.queued = document;
    this.state = "idle";
  }

  dispose(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }
}
