import type { FontDocument } from "@typewright/font-model";

import { type FontHost, showDocument } from "./fonts.js";

/**
 * How long the font has to be worked on before another copy of it is kept.
 *
 * Long enough that the copies are worth having and few enough to keep — twenty
 * of them at five minutes covers the best part of two hours of work, which is
 * about as far back as anyone reaches before reaching for the file they
 * exported.
 */
const SNAPSHOT_EVERY_MS = 5 * 60 * 1000;

/**
 * Copies of the whole font, kept now and then while it is being worked on.
 *
 * Undo is a session's memory and dies with the tab; autosave keeps up with what
 * just happened, which is exactly no help when what just happened is the thing
 * you want back. A copy every so often is the difference between "an hour ago"
 * being a place you can return to and a thing you remember.
 *
 * A class rather than functions over the host, unlike the modules beside it,
 * because it has something to remember between calls: when the last copy was
 * kept, and of what.
 */
export class Snapshots {
  /**
   * When the last copy of the whole font was kept, and of what.
   *
   * The document as well as the time: nothing is worth copying twice, and a
   * font left open in a window that is not being touched should not accumulate
   * identical copies of itself.
   */
  private at = 0;
  private kept: FontDocument | null = null;

  constructor(private readonly host: FontHost) {}

  /**
   * Keep a copy if it is time to, after an edit has been committed.
   *
   * Time rather than edit count, and only when the document has actually moved:
   * a font is a megabyte or two of JSON, and the point is to have a few useful
   * copies rather than a thousand identical ones.
   */
  consider(document: FontDocument): void {
    if (document === this.kept) return;
    if (Date.now() - this.at < SNAPSHOT_EVERY_MS) return;
    void this.keep(document);
  }

  /**
   * Keep a copy now, whatever the clock says.
   *
   * Called before anything that replaces the whole font — opening one, starting
   * a new one, restoring an older copy — because that is the moment a way back
   * is worth most and the moment the editor is about to stop having one.
   */
  async keep(document: FontDocument): Promise<void> {
    this.at = Date.now();
    this.kept = document;
    const entries = await this.host.disk.snapshot(document, this.at);
    this.host.patch({ snapshots: entries });
  }

  /** Read the list back from disk, for whatever is about to show it. */
  async refresh(): Promise<void> {
    this.host.patch({ snapshots: await this.host.disk.snapshots() });
  }

  /**
   * Put an older copy of the font back on screen and on disk.
   *
   * A copy of what is open is kept first, so restoring is itself something you
   * can come back from — which is the whole reason to trust the button at all.
   *
   * Not undoable, for the reason opening a font is not: a single ctrl-Z that
   * silently swapped the whole font back would be alarming, and the history it
   * restored would describe glyphs that are no longer open.
   */
  async restore(at: number): Promise<{ glyphs: number; problems: readonly string[] } | null> {
    const found = await this.host.disk.readSnapshot(at);
    if (found === null) return null;

    await this.keep(this.host.state().session.editor.document);
    showDocument(this.host, found.document, false);
    await this.host.disk.replaceAll(found.document);
    await this.refresh();

    return { glyphs: found.document.glyphOrder.length, problems: found.problems };
  }
}
