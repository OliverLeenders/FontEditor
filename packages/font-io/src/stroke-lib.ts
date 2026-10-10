import {
  type ContinuousCorner,
  type Contour,
  type IdFactory,
  type Nib,
  type NodeType,
  type StrokeEnd,
  contour,
  node,
  readContinuous,
  readSegmentBlend,
  readSquareness,
  readStrokeEnd,
} from "@typewright/font-model";
import type { SegmentBlend } from "@typewright/geometry";

import { type XmlElement, isElement, textOf } from "./xml.js";

/**
 * Strokes kept in a `.ufo`, beside the ink that stands in for them.
 *
 * The format has no word for a pen. What goes in a glyph's outline is the ink a
 * stroke leaves, because another application reading the file wants the shape of
 * the letter — and that is the whole of what it can be given. This editor wants
 * the stroke back: the path the pen was drawn along and the pen itself, so that
 * a font kept as a UFO folder and opened again is still drawn with a pen.
 *
 * So both are written. The ink goes at the end of the outline, and the glyph's
 * own `lib` — the place the format keeps for what an application has no field
 * for — carries the skeletons and a note of how many contours at the end of the
 * outline are their ink, with a fingerprint of exactly the points written for it.
 *
 * Reading it back, the fingerprint is the test. If the last contours are still
 * the ink that was written, they are taken out and the skeletons put back where
 * they were. If they are not — another application has redrawn the letter since
 * — the outlines are what the file now says the letter is, so they are kept and
 * the strokes are let go, with a warning rather than silently. Putting a stale
 * pen back over somebody's edit would undo it.
 */

/** The glyph-lib key the strokes are kept under, beside this editor's others. */
export const STROKES_KEY = "org.typewright.strokes";

/** What is kept, so a later version can read an earlier one. */
const VERSION = 1;

/** A skeleton, where it sat among the glyph's contours, and its pen. */
type StoredStroke = {
  readonly at: number;
  readonly closed: boolean;
  /** The pen, for a stroke; absent for an outline kept for its continuous corners. */
  readonly nib?: Nib;
  readonly nodes: readonly StoredNode[];
};

type StoredNode = {
  readonly pt: readonly [number, number];
  readonly type: NodeType;
  readonly in: readonly [number, number] | null;
  readonly out: readonly [number, number] | null;
  readonly hvLock?: readonly [boolean, boolean];
  readonly harmonised?: true;
  readonly pen?: Nib;
  readonly blend?: SegmentBlend;
  readonly continuous?: ContinuousCorner;
  readonly end?: StrokeEnd;
};

/** What was read out of a glyph's lib: the strokes, and what their ink should be. */
export type KeptStrokes = {
  readonly strokes: readonly StoredStroke[];
  readonly inkContours: number;
  readonly inkPrint: string;
};

/**
 * A fingerprint of the points written for some contours.
 *
 * Over the text of each point exactly as it went into the file — its x, its y and
 * its type — so that the same file read back gives the same fingerprint whatever
 * the model does with the points afterwards. FNV-1a, which is short, fast, and
 * more than enough to tell a contour that was left alone from one that was not;
 * this is a check for an edit, not a defence against anybody.
 */
export function inkPrint(contours: readonly (readonly string[])[]): string {
  let hash = 0x811c9dc5;
  const feed = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  for (const points of contours) {
    feed("[");
    for (const p of points) feed(`${p};`);
    feed("]");
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The lib entry for a glyph's strokes, as the key and the value to put in its dict.
 *
 * The skeletons are written as JSON inside a string. A plist of points would be
 * the tidier file and a much larger one, and the string is only ever read by this
 * editor: every other application carries a lib key it does not know untouched,
 * which is the arrangement this relies on.
 */
export function strokesEntry(
  skeletons: readonly { readonly at: number; readonly contour: Contour }[],
  inkPoints: readonly (readonly string[])[],
): XmlElement[] {
  const strokes: StoredStroke[] = skeletons.map(({ at, contour: c }) => ({
    at,
    closed: c.closed,
    ...(c.nib === undefined ? {} : { nib: { ...c.nib } }),
    nodes: c.nodes.map(storedNode),
  }));

  const text = (value: string) => ({ text: value });
  const pair = (key: string, value: XmlElement): XmlElement[] => [
    { name: "key", attributes: {}, children: [text(key)] },
    value,
  ];

  return [
    { name: "key", attributes: {}, children: [text(STROKES_KEY)] },
    {
      name: "dict",
      attributes: {},
      children: [
        ...pair("version", { name: "integer", attributes: {}, children: [text(String(VERSION))] }),
        ...pair("inkContours", {
          name: "integer",
          attributes: {},
          children: [text(String(inkPoints.length))],
        }),
        ...pair("inkPrint", {
          name: "string",
          attributes: {},
          children: [text(inkPrint(inkPoints))],
        }),
        ...pair("strokes", {
          name: "string",
          attributes: {},
          children: [text(JSON.stringify(strokes))],
        }),
      ],
    },
  ];
}

function storedNode(n: Contour["nodes"][number]): StoredNode {
  const pair = (p: { readonly x: number; readonly y: number }): [number, number] => [p.x, p.y];
  return {
    pt: pair(n.pt),
    type: n.type,
    in: n.in === null ? null : pair(n.in),
    out: n.out === null ? null : pair(n.out),
    ...(n.hvLock.in || n.hvLock.out ? { hvLock: [n.hvLock.in, n.hvLock.out] as const } : {}),
    ...(n.harmonised ? { harmonised: true as const } : {}),
    ...(n.pen === undefined ? {} : { pen: { ...n.pen } }),
    ...(n.blend === undefined ? {} : { blend: { ...n.blend } }),
    ...(n.continuous === undefined ? {} : { continuous: { ...n.continuous } }),
    ...(n.end === undefined ? {} : { end: { ...n.end } }),
  };
}

/**
 * The strokes in a glyph's lib dict, and the dict without them.
 *
 * `null` for the strokes where there are none, or where what is there cannot be
 * read — a later version's, or one damaged in transit. The entry is taken out of
 * the dict either way, since it is this editor's and is written afresh on save.
 */
export function takeStrokes(dict: XmlElement): {
  readonly strokes: KeptStrokes | null;
  readonly rest: XmlElement;
} {
  const entries = dict.children.filter(isElement);
  const at = entries.findIndex((e) => e.name === "key" && textOf(e).trim() === STROKES_KEY);
  const key = entries[at];
  const value = entries[at + 1];
  if (key === undefined || value === undefined) return { strokes: null, rest: dict };

  const rest = { ...dict, children: dict.children.filter((c) => c !== key && c !== value) };
  return { strokes: value.name === "dict" ? readEntry(value) : null, rest };
}

function readEntry(value: XmlElement): KeptStrokes | null {
  const fields = new Map<string, XmlElement>();
  const children = value.children.filter(isElement);
  for (let i = 0; i + 1 < children.length; i += 2) {
    const k = children[i]!;
    if (k.name === "key") fields.set(textOf(k).trim(), children[i + 1]!);
  }

  const version = Number(textOf(fields.get("version") ?? EMPTY).trim());
  if (version !== VERSION) return null;

  const inkContours = Number(textOf(fields.get("inkContours") ?? EMPTY).trim());
  const inkPrintText = textOf(fields.get("inkPrint") ?? EMPTY).trim();
  if (!Number.isInteger(inkContours) || inkContours < 0 || inkPrintText === "") return null;

  let raw: unknown;
  try {
    raw = JSON.parse(textOf(fields.get("strokes") ?? EMPTY));
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;

  const strokes: StoredStroke[] = [];
  for (const entry of raw as unknown[]) {
    const read = readStroke(entry);
    if (read === null) return null;
    strokes.push(read);
  }
  return { strokes, inkContours, inkPrint: inkPrintText };
}

const EMPTY: XmlElement = { name: "", attributes: {}, children: [] };

function readStroke(raw: unknown): StoredStroke | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const at = r["at"];
  const rawNib = r["nib"];
  if (typeof at !== "number" || !Number.isInteger(at) || at < 0) return null;
  // No pen is an outline kept for its continuous corners; a pen that is there has
  // to be one.
  let nib: Nib | undefined;
  if (rawNib !== undefined) {
    if (typeof rawNib !== "object" || rawNib === null) return null;
    const pen = rawNib as Record<string, unknown>;
    const angle = pen["angle"];
    const width = pen["width"];
    const thickness = pen["thickness"];
    if (typeof angle !== "number" || typeof width !== "number" || !(width >= 0)) return null;
    nib =
      typeof thickness === "number" && thickness > 0
        ? { angle, width, thickness, ...readSquareness(pen["squareness"]) }
        : { angle, width };
  }
  if (!Array.isArray(r["nodes"])) return null;

  const nodes: StoredNode[] = [];
  for (const n of r["nodes"] as unknown[]) {
    const read = readNode(n);
    if (read === null) return null;
    nodes.push(read);
  }
  if (nodes.length < 2) return null;

  return {
    at,
    closed: r["closed"] === true,
    ...(nib === undefined ? {} : { nib }),
    nodes,
  };
}

function readNode(raw: unknown): StoredNode | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const pt = pairOf(r["pt"]);
  if (pt === null) return null;
  const type = r["type"];
  return {
    pt,
    type: type === "smooth" || type === "tangent" ? type : "corner",
    in: pairOf(r["in"]),
    out: pairOf(r["out"]),
    ...(Array.isArray(r["hvLock"])
      ? { hvLock: [r["hvLock"][0] === true, r["hvLock"][1] === true] as const }
      : {}),
    ...(r["harmonised"] === true ? { harmonised: true as const } : {}),
    ...penOf(r["pen"]),
    ...((): { readonly blend?: SegmentBlend } => {
      const blend = readSegmentBlend(r["blend"]);
      return blend === undefined ? {} : { blend };
    })(),
    ...((): { readonly continuous?: ContinuousCorner } => {
      const continuous = readContinuous(r["continuous"]);
      return continuous === undefined ? {} : { continuous };
    })(),
    ...((): { readonly end?: StrokeEnd } => {
      const end = readStrokeEnd(r["end"]);
      return end === undefined ? {} : { end };
    })(),
  };
}

/** A point's own pen as stored, or nothing where it has none or it cannot be read. */
function penOf(raw: unknown): { readonly pen?: Nib } {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const angle = r["angle"];
  const width = r["width"];
  const thickness = r["thickness"];
  if (typeof angle !== "number" || !Number.isFinite(angle)) return {};
  if (typeof width !== "number" || !Number.isFinite(width) || width < 0) return {};
  return {
    pen:
      typeof thickness === "number" && Number.isFinite(thickness) && thickness > 0
        ? { angle, width, thickness, ...readSquareness(r["squareness"]) }
        : { angle, width },
  };
}

function pairOf(raw: unknown): readonly [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [x, y] = raw as unknown[];
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)
    ? [x, y]
    : null;
}

/**
 * The glyph's contours with its strokes put back, or `null` when the ink written
 * for them is no longer there as it was written.
 *
 * `points` is the text of the points of every contour read from the outline, in
 * order, so the fingerprint is taken from exactly what the file says.
 */
export function restoreStrokes(
  contours: readonly Contour[],
  points: readonly (readonly string[])[],
  kept: KeptStrokes,
  ids: IdFactory,
): Contour[] | null {
  const count = kept.inkContours;
  if (count > contours.length || points.length !== contours.length) return null;
  if (inkPrint(points.slice(points.length - count)) !== kept.inkPrint) return null;

  const outlines = contours.slice(0, contours.length - count);
  const restored = [...outlines];
  // In the order they were written, which is the order they sat in; each goes
  // back to the place it had, or to the end if the outlines around it are fewer
  // than they were.
  for (const stroke of [...kept.strokes].sort((l, r) => l.at - r.at)) {
    const skeleton = {
      ...contour(
        ids.contour(),
        stroke.nodes.map((n) =>
          node(
            ids.node(),
            { x: n.pt[0], y: n.pt[1] },
            {
              type: n.type,
              in: n.in === null ? null : { x: n.in[0], y: n.in[1] },
              out: n.out === null ? null : { x: n.out[0], y: n.out[1] },
              hvLock: n.hvLock === undefined ? false : { in: n.hvLock[0], out: n.hvLock[1] },
              harmonised: n.harmonised === true,
              ...(n.pen === undefined ? {} : { pen: n.pen }),
              ...(n.blend === undefined ? {} : { blend: n.blend }),
              ...(n.continuous === undefined ? {} : { continuous: n.continuous }),
              ...(n.end === undefined ? {} : { end: n.end }),
            },
          ),
        ),
        stroke.closed,
      ),
      ...(stroke.nib === undefined ? {} : { nib: stroke.nib }),
    };
    restored.splice(Math.min(stroke.at, restored.length), 0, skeleton);
  }
  return restored;
}
