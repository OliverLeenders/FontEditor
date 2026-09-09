/**
 * WOFF2, which is a font wrapped for the web and squeezed.
 *
 * Two things at once, and only one of them is compression. The tables are
 * Brotli'd, which is where most of the name goes — but before that `glyf` and
 * `loca` are taken apart and rewritten as parallel streams of point counts,
 * flags and deltas, which compress far better than the interleaved original.
 * The result is around a third smaller than WOFF1 and is what nearly every
 * website now serves.
 *
 * Neither half is ours. Brotli is not in any browser's `CompressionStream`, and
 * the transform is a specification in its own right, so this is a wasm build of
 * Google's `woff2` — the same C++ that `woff2_compress` and fontTools use. What
 * we do here is call it, which is the whole of the file and deliberately so:
 * anything else would be a second implementation of a format we would then have
 * to prove ourselves right about.
 *
 * The wasm is a megabyte, so it is imported when somebody asks for a WOFF2 and
 * never at startup. Exports are the last thing anybody does in a session, and a
 * moment there is cheaper than a megabyte on every load.
 */

export type Woff2Result = {
  readonly bytes: Uint8Array;
  /** How much smaller than the font it was made from, as a fraction. */
  readonly saved: number;
};

/**
 * Wrap a finished font as WOFF2.
 *
 * The input is a whole OTF or TTF — anything with an sfnt header — and both
 * flavours are handled: the transform applies to `glyf`, and a CFF font simply
 * has no `glyf` to transform.
 */
export async function toWoff2(sfnt: Uint8Array): Promise<Woff2Result> {
  const { compress } = await import("woff2-encoder");

  // A fresh copy: the encoder is handed the buffer, and a subarray of a larger
  // one would give it more than the font.
  const bytes = await compress(new Uint8Array(sfnt));
  return { bytes, saved: sfnt.length === 0 ? 0 : 1 - bytes.length / sfnt.length };
}
