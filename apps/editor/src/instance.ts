import { type FontDocument, interpolateFont } from "@typewright/font-model";

import type { StoreState } from "./store/state.js";

/**
 * The whole font at the place being previewed, for the workspaces that set text.
 *
 * `null` where there is nothing to work out: no location asked for, one master,
 * or a master still being read in from disk. A caller falls back to the document
 * it was already showing, which is the master being edited.
 *
 * Remembered against what it was made from, because it is the whole font rather
 * than one glyph and a line of text asks for it on every keystroke. The key is
 * three references and a location: change a master, move the slider or edit the
 * open font and it is worked out again; type into the strip and it is not.
 */
export function instanceDocument(state: StoreState): FontDocument | null {
  const at = state.preview;
  const { project } = state;
  if (at === null || project.masters.length < 2 || project.axes.length === 0) return null;

  const editor = state.session.editor;
  const sources = project.masters.map((m) =>
    m.id === project.current ? editor.document : (project.sources[m.id] ?? null),
  );
  if (sources.some((s) => s === null)) return null;

  const key = `${project.current}|${JSON.stringify(at)}`;
  if (
    held !== null &&
    held.key === key &&
    held.sources.length === sources.length &&
    held.sources.every((s, i) => s === sources[i])
  ) {
    return held.document;
  }

  const { document } = interpolateFont(
    project.axes,
    project.masters.map((m) => m.location),
    sources as FontDocument[],
    at,
    project.masters.map((m) => m.sparse !== undefined),
  );

  held = { key, sources: sources as FontDocument[], document };
  return document;
}

/** The last one worked out, and what it was worked out from. */
let held: {
  key: string;
  sources: readonly FontDocument[];
  document: FontDocument;
} | null = null;
