import type { Vec2 } from "@typewright/geometry";
import {
  type Contour,
  type IdFactory,
  type Node,
  type NodeType,
  addContour,
  contour,
  node,
  removeContour,
} from "@typewright/font-model";

import { type ToolResult, begin, commit, result } from "./effects.js";
import { type EditorState, currentGlyph, editCurrentGlyph } from "./state.js";

/**
 * Cut, copy and paste, carried on the system clipboard as text.
 *
 * Text rather than an in-memory slot, because that is what makes it work
 * between two windows of the editor, survive a reload, and be inspectable by
 * anyone who pastes it somewhere else. It costs a serialization format, which is
 * a fair price.
 *
 * Ids are deliberately *not* carried. They identify a node within a document,
 * not a shape, so pasting a copy back into the glyph it came from would produce
 * two contours claiming the same identity — and selection addresses nodes by id.
 * They are minted fresh on arrival instead.
 */

const MARKER = "typewright/contours";

/**
 * What the marker said before the editor was named.
 *
 * Accepted on paste, never written. The clipboard can outlive a reload, so
 * someone who copied before updating and pasted after would otherwise find the
 * paste silently doing nothing.
 */
const OLD_MARKER = "fonteditor/contours";
const VERSION = 1;

type StoredNode = {
  readonly pt: Vec2;
  readonly type: NodeType;
  readonly in: Vec2 | null;
  readonly out: Vec2 | null;
  readonly hvLock: boolean | { readonly in?: boolean; readonly out?: boolean };
};

type Payload = {
  readonly kind: typeof MARKER | typeof OLD_MARKER;
  readonly version: number;
  readonly contours: ReadonlyArray<{
    readonly closed: boolean;
    readonly nodes: readonly StoredNode[];
  }>;
};

/**
 * The contours a selection covers.
 *
 * Whole contours, not the individual points selected. A partial contour is an
 * open fragment of a path, which the model can hold but which is almost never
 * what someone copying part of an outline wants back. Selecting any point of a
 * contour takes the contour.
 */
export function selectedContours(state: EditorState): Contour[] {
  const glyph = currentGlyph(state);
  if (glyph === null) return [];

  const wanted = new Set(state.selection.map((item) => item.contourId));
  return glyph.contours.filter((c) => wanted.has(c.id));
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

/** What to put on the clipboard, or `null` when the selection covers nothing. */
export function clipboardText(state: EditorState): string | null {
  const contours = selectedContours(state);
  if (contours.length === 0) return null;

  const payload: Payload = {
    kind: MARKER,
    version: VERSION,
    contours: contours.map((c) => ({
      closed: c.closed,
      nodes: c.nodes.map((n) => ({
        pt: n.pt,
        type: n.type,
        in: n.in,
        out: n.out,
        hvLock: { in: n.hvLock.in, out: n.hvLock.out },
      })),
    })),
  };
  return JSON.stringify(payload, null, 1);
}

/** Remove the contours a selection covers. The other half of a cut. */
export function deleteSelectedContours(state: EditorState): ToolResult {
  const contours = selectedContours(state);
  if (contours.length === 0) return result(state);

  let editor = state;
  for (const c of contours) {
    const document = editCurrentGlyph(editor, (g) => removeContour(g, c.id));
    if (document !== null) editor = { ...editor, document };
  }
  if (editor === state) return result(state);

  return result({ ...editor, selection: [], focusedSegment: null, hoveredSegment: null }, [
    begin(contours.length === 1 ? "Cut contour" : "Cut contours", false),
    commit,
  ]);
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function point(value: unknown): Vec2 | null {
  if (!isRecord(value)) return null;
  const { x, y } = value;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function nodeType(value: unknown): NodeType {
  return value === "smooth" || value === "tangent" ? value : "corner";
}

/**
 * Read a payload back.
 *
 * Everything is checked. The clipboard is the one input to this program that
 * genuinely comes from anywhere — another application, a text editor, a person
 * with a keyboard — so a malformed paste has to be refused rather than trusted
 * into the document, where it would break invariants nothing else can violate.
 */
/**
 * Read a pasted lock, from this format or from the boolean it used to be.
 *
 * Clipboard text can come from an older build, or from a person editing it by
 * hand, so anything unrecognised reads as unlocked rather than refusing the
 * paste.
 */
function readLock(raw: unknown): { in: boolean; out: boolean } {
  if (raw === true) return { in: true, out: true };
  if (raw !== null && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return { in: o["in"] === true, out: o["out"] === true };
  }
  return { in: false, out: false };
}

export function parseClipboard(text: string, ids: IdFactory): Contour[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  if (!isRecord(raw) || (raw["kind"] !== MARKER && raw["kind"] !== OLD_MARKER)) return null;
  if (typeof raw["version"] !== "number" || raw["version"] > VERSION) return null;
  if (!Array.isArray(raw["contours"])) return null;

  const contours: Contour[] = [];
  for (const entry of raw["contours"] as unknown[]) {
    if (!isRecord(entry) || !Array.isArray(entry["nodes"])) return null;

    const nodes: Node[] = [];
    for (const rawNode of entry["nodes"] as unknown[]) {
      if (!isRecord(rawNode)) return null;
      const pt = point(rawNode["pt"]);
      if (pt === null) return null;

      nodes.push(
        node(ids.node(), pt, {
          type: nodeType(rawNode["type"]),
          in: point(rawNode["in"]),
          out: point(rawNode["out"]),
          hvLock: readLock(rawNode["hvLock"]),
        }),
      );
    }

    // A contour of fewer than two points draws nothing and cannot be edited
    // into anything; dropping it is kinder than pasting an invisible artefact.
    if (nodes.length < 2) continue;
    contours.push(contour(ids.contour(), nodes, entry["closed"] !== false));
  }

  return contours.length === 0 ? null : contours;
}

/**
 * Paste contours into the current glyph.
 *
 * At the coordinates they were copied from, not at the cursor. Between glyphs
 * that is what makes an accent or a counter land where it belongs, and within a
 * glyph the copy sits exactly on the original, ready to be moved — which is what
 * the selection afterwards is for.
 */
export function pasteContours(state: EditorState, text: string, ids: IdFactory): ToolResult {
  const contours = parseClipboard(text, ids);
  if (contours === null) return result(state);

  let editor = state;
  for (const c of contours) {
    const document = editCurrentGlyph(editor, (g) => addContour(g, c));
    if (document !== null) editor = { ...editor, document };
  }
  if (editor === state) return result(state);

  // Selecting what arrived: a paste you cannot immediately move is a paste you
  // have to go and find first.
  const selection = contours.flatMap((c) =>
    c.nodes.map((n) => ({ contourId: c.id, nodeId: n.id, part: "point" as const })),
  );

  return result({ ...editor, selection }, [
    begin(contours.length === 1 ? "Paste contour" : "Paste contours", false),
    commit,
  ]);
}
