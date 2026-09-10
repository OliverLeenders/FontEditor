import { setGlyphImage } from "@typewright/font-model";
import { usableImageName } from "@typewright/storage";
import { type EditorState, editCurrentGlyph } from "@typewright/tools";

import type { FontHost } from "./fonts.js";

/**
 * Adding pictures to a font, and putting them behind letters.
 *
 * Two steps on purpose, because they are two decisions. Adding a scan is about
 * the font: this sheet is now one of the things this typeface was drawn from.
 * Placing it is about a letter: this is where the `b` is on that sheet. Doing
 * both in one act would mean re-adding the same scan for every glyph, which is
 * exactly what this arrangement exists to avoid.
 */

/** What adding a picture turned out to do. */
export type AddedImage = {
  readonly name: string;
  readonly bytes: number;
  /** True where a picture of that name was already in the font. */
  readonly replaced: boolean;
};

/**
 * Put a file in the font's pictures.
 *
 * The name comes from the file, tidied to something the format can hold. A name
 * already in use replaces what is there, which is how a scan is swapped for a
 * better one: every glyph tracing from it follows, because the name is the
 * whole of the link.
 */
export async function addImage(host: FontHost, file: File): Promise<AddedImage> {
  const name = imageNameFor(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());

  const already = (await host.disk.images()).some((entry) => entry.name === name);
  const written = await host.disk.putImage(name, bytes);
  if (written === null) throw new Error("another tab is saving this project");

  // The bytes under this name have changed, so whatever was decoded from it is
  // no longer what the font holds.
  host.forgetImage(name);
  await refreshImages(host);

  return { name, bytes: written.bytes, replaced: already };
}

/**
 * A file's name, as an image in a font may be called.
 *
 * Everything the format will not carry becomes an underscore rather than being
 * dropped, so two files that differ only in a space do not collide, and the
 * name still looks like the file it came from — which is how somebody finds it
 * in the list.
 */
export function imageNameFor(fileName: string): string {
  const bare = fileName.split(/[\\/]/).pop() ?? fileName;
  const tidy = bare.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return usableImageName(tidy) ? tidy : `image-${String(Date.now())}.png`;
}

/** Read the list of pictures back from the store, for whatever will show it. */
export async function refreshImages(host: FontHost): Promise<void> {
  host.patch({ images: await host.disk.images() });
}

/**
 * Put a picture behind the current glyph, or take the one there away.
 *
 * Placed as it comes — one pixel to the unit, sitting on the origin — because
 * where it goes is the next decision and not this one. The sheet view and the
 * inspector are both about answering it.
 */
export function setImageOn(state: EditorState, name: string | null): EditorState | null {
  const document = editCurrentGlyph(state, (g) =>
    setGlyphImage(g, name === null ? null : { name, transform: PLACED_AS_IT_COMES, color: null }),
  );
  return document === null ? null : { ...state, document };
}

const PLACED_AS_IT_COMES = {
  xScale: 1,
  xyScale: 0,
  yxScale: 0,
  yScale: 1,
  xOffset: 0,
  yOffset: 0,
};

/** Every image name any glyph is using, for tidying up and for the panel. */
export function imagesInUse(state: EditorState): Set<string> {
  const used = new Set<string>();
  for (const name of state.document.glyphOrder) {
    const image = state.document.glyphs[name]?.image;
    if (image !== null && image !== undefined) used.add(image.name);
  }
  return used;
}

/** The glyphs tracing from one picture, in font order. */
export function glyphsTracing(state: EditorState, image: string): string[] {
  return state.document.glyphOrder.filter(
    (name) => state.document.glyphs[name]?.image?.name === image,
  );
}
