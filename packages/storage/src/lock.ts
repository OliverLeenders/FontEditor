/**
 * Exclusive ownership of the project, so only one tab ever writes to it.
 *
 * The origin private file system is shared by every tab on the origin, and each
 * tab holds its own copy of the document. Without this, two tabs write over each
 * other: the one that did not import still believes in the old font and puts its
 * glyphs and its index back, so a discarded font returns on the next load. That
 * is not a race to narrow, it is a second writer to remove.
 *
 * Built on Web Locks, which browsers already release when a tab closes or
 * crashes — the one part of this that would otherwise need a heartbeat and a
 * timeout, and be wrong.
 */

/** A granted lock, or `null` when `ifAvailable` found it taken. */
export type LockGrant = { readonly name: string } | null;

/** The slice of `navigator.locks` used here, so a test can supply its own. */
export type LockManagerLike = {
  request(
    name: string,
    options: {
      mode?: "exclusive" | "shared";
      ifAvailable?: boolean;
      steal?: boolean;
    },
    callback: (lock: LockGrant) => Promise<unknown>,
  ): Promise<unknown>;
};

/**
 * The lock one project's working copy is written under.
 *
 * Per project, not per editor. The lock is what makes a second window on the
 * same font read-only, and that is the right answer for the same font and the
 * wrong one for a different font — two windows on two fonts write to two
 * directories and have nothing to disagree about.
 */
export function projectLock(id: string): string {
  return `typewright/project/${id}`;
}

/** What a lock with nothing said about which project falls back to. */
export const PROJECT_LOCK = projectLock("project");

export function browserLocks(): LockManagerLike | null {
  const locks = (navigator as { locks?: LockManagerLike }).locks;
  return locks ?? null;
}

export class ProjectLock {
  /** Resolving this releases the lock; null when we do not hold it. */
  private release: (() => void) | null = null;

  /**
   * @param onLost called when another tab takes the lock from us, so the editor
   *   can stop writing before it overwrites the tab that now owns the project.
   */
  constructor(
    private readonly locks: LockManagerLike | null,
    private readonly onLost: () => void,
    private readonly name: string = PROJECT_LOCK,
  ) {}

  get held(): boolean {
    return this.release !== null;
  }

  /**
   * Take the lock if it is free, without waiting.
   *
   * Never queues. A tab that waited would sit looking read-only until some other
   * tab happened to close, with nothing on screen explaining why.
   */
  tryAcquire(): Promise<boolean> {
    return this.take({ ifAvailable: true });
  }

  /**
   * Take the lock from whoever holds it.
   *
   * What "edit here instead" does. The previous holder is told through its own
   * `onLost` and stops writing; it does not get a say, which is the point — the
   * alternative is asking a tab the user is not looking at.
   */
  steal(): Promise<boolean> {
    return this.take({ steal: true });
  }

  /** Give the lock up, letting another tab take it. */
  releaseLock(): void {
    const release = this.release;
    this.release = null;
    release?.();
  }

  private take(options: { ifAvailable?: boolean; steal?: boolean }): Promise<boolean> {
    // No Web Locks in this browser: carry on as sole owner rather than refuse to
    // save. Losing coordination is worse than losing nothing, but refusing to
    // write at all would be worse still.
    if (this.locks === null) return Promise.resolve(true);
    if (this.release !== null) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (granted: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(granted);
      };

      void this.locks
        ?.request(this.name, { mode: "exclusive", ...options }, (lock) => {
          if (lock === null) {
            settle(false);
            return Promise.resolve();
          }
          // Held for as long as this promise is pending.
          const holding = new Promise<void>((done) => {
            this.release = done;
          });
          settle(true);
          return holding;
        })
        .catch(() => {
          // Stolen, or the request failed outright.
          const wasHeld = this.release !== null;
          this.release = null;
          settle(false);
          if (wasHeld) this.onLost();
        });
    });
  }
}
