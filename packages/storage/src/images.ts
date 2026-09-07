import type { FileStore } from "./file-store.js";

/**
 * The pictures a font is traced from, kept beside it.
 *
 * Not in the document, and that is the whole arrangement. A scan is megabytes
 * that never change; the document is a value that history keeps a copy of on
 * every edit. Putting one inside the other would make undo cost a scan and an
 * autosave rewrite one.
 *
 * So a glyph names an image and this holds the bytes, exactly as a UFO does:
 * `images/sheet-01.png` in the font, `fileName="sheet-01.png"` in the glyph.
 * The name is the whole of the link, which means an image can be replaced by
 * writing over it and every glyph tracing from it follows.
 */

export const IMAGES_PREFIX = "images/";

/** What is known about an image without reading it. */
export type ImageEntry = {
  readonly name: string;
  readonly bytes: number;
};

const pathOf = (name: string): string => `${IMAGES_PREFIX}${name}`;

/**
 * Whether a name may be used for an image.
 *
 * A path separator would put the file somewhere else in the project, and a
 * leading dot is how the two names the format reserves are spelt. Neither is a
 * picture anybody meant to add.
 */
export function usableImageName(name: string): boolean {
  return name !== "" && !name.includes("/") && !name.includes("\\") && !name.startsWith(".");
}

export async function writeImage(
  store: FileStore,
  name: string,
  bytes: Uint8Array,
): Promise<ImageEntry> {
  if (!usableImageName(name)) throw new Error(`${name} is not a usable image name`);

  await store.writeBytes(pathOf(name), bytes);
  return { name, bytes: bytes.length };
}

export async function readImage(store: FileStore, name: string): Promise<Uint8Array | null> {
  if (!usableImageName(name)) return null;
  return await store.readBytes(pathOf(name));
}

export async function removeImage(store: FileStore, name: string): Promise<void> {
  if (!usableImageName(name)) return;
  await store.remove(pathOf(name));
}

/**
 * Every image in the store, by name.
 *
 * The sizes come from reading the files, which is the only way to know: the
 * store lists paths and nothing else. It is a handful of files, and the answer
 * is wanted once when a panel opens rather than per frame.
 */
export async function listImages(store: FileStore): Promise<ImageEntry[]> {
  const paths = await store.list(IMAGES_PREFIX);
  const out: ImageEntry[] = [];

  for (const path of paths) {
    const name = path.slice(IMAGES_PREFIX.length);
    if (!usableImageName(name)) continue;
    const bytes = await store.readBytes(path);
    if (bytes !== null) out.push({ name, bytes: bytes.length });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read them all, for handing a font to something that wants it whole.
 *
 * Used by export, which has to put the pictures into the archive it writes.
 * Everything else asks for one at a time.
 */
export async function allImages(store: FileStore): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const { name } of await listImages(store)) {
    const bytes = await readImage(store, name);
    if (bytes !== null) out.set(name, bytes);
  }
  return out;
}

/**
 * Take away every image no glyph is using.
 *
 * Called when a font is replaced, not while one is being drawn: an image is
 * unused for as long as it takes to assign it, and a tidy-up that ran on every
 * edit would delete a picture in the second between adding it and placing it.
 */
export async function pruneImages(store: FileStore, used: ReadonlySet<string>): Promise<string[]> {
  const gone: string[] = [];
  for (const { name } of await listImages(store)) {
    if (used.has(name)) continue;
    await removeImage(store, name);
    gone.push(name);
  }
  return gone;
}
