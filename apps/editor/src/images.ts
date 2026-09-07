/**
 * The pictures a font is traced from, decoded once and kept in memory.
 *
 * The document holds names; the working store holds bytes; this holds the
 * decoded bitmaps, which is the third form the same picture takes and the only
 * one a canvas can draw. Keeping it here rather than in the document is the
 * whole point of the arrangement: an alphabet sheet is decoded once for the
 * session however many glyphs trace from it, and undo never touches it.
 *
 * Decoding is asynchronous and drawing is not, so a bitmap that has not arrived
 * yet is simply absent and the frame is drawn without it. When it lands, the
 * cache says so and the canvas redraws — which is one frame later than ideal
 * and considerably better than a renderer that can wait.
 */

/** What a decoded picture is, as far as anything here is concerned. */
export type Decoded = {
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
};

export class ImageCache {
  private readonly decoded = new Map<string, Decoded>();
  /** Names being decoded, so a name is never fetched twice at once. */
  private readonly waiting = new Map<string, Promise<Decoded | null>>();
  /** Names that could not be decoded, so a broken file is not retried per frame. */
  private readonly failed = new Set<string>();

  constructor(
    private readonly fetch: (name: string) => Promise<Uint8Array | null>,
    private readonly changed: () => void,
  ) {}

  /**
   * The picture, if it is decoded, and a request for it if it is not.
   *
   * Called from drawing, so it never waits and never throws. The `changed`
   * callback is what turns a late arrival into a redraw.
   */
  get(name: string): Decoded | null {
    const found = this.decoded.get(name);
    if (found !== undefined) return found;

    if (!this.failed.has(name) && !this.waiting.has(name)) void this.load(name);
    return null;
  }

  /** Whether a name has been tried and could not be shown. */
  broken(name: string): boolean {
    return this.failed.has(name);
  }

  private async load(name: string): Promise<Decoded | null> {
    const work = this.decode(name);
    this.waiting.set(name, work);

    const decoded = await work;
    this.waiting.delete(name);

    if (decoded === null) this.failed.add(name);
    else this.decoded.set(name, decoded);

    this.changed();
    return decoded;
  }

  private async decode(name: string): Promise<Decoded | null> {
    try {
      const bytes = await this.fetch(name);
      if (bytes === null) return null;

      // `createImageBitmap` decodes off the main thread and hands back
      // something a canvas draws without decoding again, which is what makes a
      // twenty-megapixel scan behind a drag survivable.
      const blob = new Blob([new Uint8Array(bytes)]);
      const bitmap = await createImageBitmap(blob);
      return { bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // A format the browser will not decode is the designer's file all the
      // same. It is still in the font and still written back out; it just
      // cannot be shown, and the panel says so.
      return null;
    }
  }

  /**
   * Forget one, so the next request decodes it again.
   *
   * Called when an image is replaced by name — the bytes changed under a name
   * that has not — and when one is removed.
   */
  forget(name: string): void {
    this.decoded.get(name)?.bitmap.close();
    this.decoded.delete(name);
    this.failed.delete(name);
    this.waiting.delete(name);
  }

  /** Let go of every bitmap, for a font being replaced wholesale. */
  clear(): void {
    for (const { bitmap } of this.decoded.values()) bitmap.close();
    this.decoded.clear();
    this.failed.clear();
    this.waiting.clear();
  }
}
