import type { ZipFile } from "./unzip.js";

/**
 * The layers of a UFO that are not the one being drawn.
 *
 * A UFO holds several sets of glyphs — the drawing, and beside it whatever the
 * designer keeps: a sketch traced over, a previous version, a set of shapes
 * being fitted. `layercontents.plist` lists them all, one of them named
 * `public.default`, and that one is the font this editor edits.
 *
 * The others are carried through unread, which is the rule this reader already
 * follows for every `fontinfo` key the model has no field for and for the whole
 * of a `lib`. It is somebody's data passing through: the model does not
 * interpret it, and cannot, because a layer's glyphs are not the font's glyphs
 * and nothing in the editor addresses them.
 *
 * Beside the document rather than in it, for the reason the pictures are. The
 * document is a value history keeps a copy of on every edit and autosave
 * rewrites on every quiet second, and a second set of glyphs is exactly the
 * size of the first.
 */

export type LayerFile = {
  /** Where the file sits inside the layer's directory. */
  readonly path: string;
  readonly text: string;
};

export type ExtraLayer = {
  /** The layer's name, as `layercontents.plist` gives it. */
  readonly name: string;
  /** The directory it lives in, relative to the UFO's root. */
  readonly directory: string;
  readonly files: readonly LayerFile[];
  /**
   * Which master of a family the layer's UFO is, for whoever keeps layers for
   * several masters at once. Nothing here sets or reads it.
   */
  readonly master?: string;
};

/** Where the default layer lives when the file does not say. */
export const DEFAULT_LAYER_DIRECTORY = "glyphs";
const DEFAULT_LAYER_NAME = "public.default";

/**
 * Every [name, directory] pair in a `layercontents.plist`.
 *
 * Matched directly rather than through the plist reader, which would give a
 * list of lists to walk for what is plainly a table: the file is an array of
 * two-string arrays, and the pairing is the whole of its meaning.
 */
export function parseLayerContents(
  source: string | null,
): readonly { readonly name: string; readonly directory: string }[] {
  if (source === null) return [];

  const out: { name: string; directory: string }[] = [];
  const pair = /<string>([^<]*)<\/string>\s*<string>([^<]*)<\/string>/g;

  for (const match of source.matchAll(pair)) {
    const name = match[1];
    const directory = match[2];
    if (name === undefined || directory === undefined || directory === "") continue;
    out.push({ name, directory });
  }
  return out;
}

/**
 * Which directory the default layer lives in.
 *
 * Almost always `glyphs`, and required to be in practice, but the file says so
 * explicitly and a source with several layers is ordinary. Reading it costs
 * nothing and opening the wrong layer would be baffling.
 */
export function defaultLayer(source: string | null): string {
  const found = parseLayerContents(source).find((layer) => layer.name === DEFAULT_LAYER_NAME);
  return found?.directory ?? DEFAULT_LAYER_DIRECTORY;
}

/**
 * The layers other than the default one, with everything in them.
 *
 * Everything, rather than the `.glif` files alone: a layer directory holds a
 * `contents.plist` naming them and may hold a `layerinfo.plist` giving the
 * layer a colour, and a layer put back without those is a layer no other tool
 * can read. What is not understood is exactly what has to be copied whole.
 */
export function extraLayers(
  files: readonly ZipFile[],
  root: string,
  contents: string | null,
): ExtraLayer[] {
  const listed = parseLayerContents(contents);
  if (listed.length === 0) return [];

  const skip = defaultLayer(contents);
  const decoder = new TextDecoder();
  const out: ExtraLayer[] = [];

  for (const layer of listed) {
    if (layer.directory === skip) continue;

    const prefix = `${root}${layer.directory}/`;
    const inside: LayerFile[] = [];
    for (const file of files) {
      if (!file.path.startsWith(prefix)) continue;
      inside.push({ path: file.path.slice(prefix.length), text: decoder.decode(file.bytes) });
    }

    // A directory the file lists and the archive does not hold is not a layer
    // being kept, it is a stale listing. Writing it back would name a directory
    // that is not there, which is worse than dropping the line.
    if (inside.length > 0)
      out.push({ name: layer.name, directory: layer.directory, files: inside });
  }

  return out;
}

/**
 * The `layercontents.plist` for a font written back out.
 *
 * The default layer first, then the ones being carried, in the order they were
 * found. The default is written as `glyphs` because that is where this editor
 * puts its glyphs — a source whose default layer was somewhere else is the one
 * case where a save moves a file, and the folder writer says so.
 */
export function layerContentsPlist(layers: readonly ExtraLayer[]): string {
  const rows: (readonly [string, string])[] = [[DEFAULT_LAYER_NAME, DEFAULT_LAYER_DIRECTORY]];
  for (const layer of layers) {
    if (layer.directory === DEFAULT_LAYER_DIRECTORY) continue;
    rows.push([layer.name, layer.directory]);
  }

  return [
    "<array>",
    ...rows.flatMap(([name, directory]) => [
      "\t<array>",
      `\t\t<string>${escapeLayerText(name)}</string>`,
      `\t\t<string>${escapeLayerText(directory)}</string>`,
      "\t</array>",
    ]),
    "</array>",
  ].join("\n");
}

/** A layer's name is the designer's, so it may hold anything a string may. */
function escapeLayerText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
