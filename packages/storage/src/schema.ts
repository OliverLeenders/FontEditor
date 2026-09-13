import {
  type Anchor,
  type Component,
  type Kerning,
  EMPTY_KERNING,
  type Contour,
  type FontDocument,
  type FontInfo,
  type Glyph,
  type Guide,
  type HandleLock,
  type ImageRef,
  type Kept,
  type MetricKeys,
  type PlainValue,
  type Node,
  type NodeType,
  BOTH_LOCKED,
  DEFAULT_FONT_INFO,
  NO_LOCK,
  NOTHING_KEPT,
  NO_METRIC_KEYS,
  STYLE_MAP_STYLES,
  anchor,
  component,
  contour,
  glyph,
  guide,
  hasMetricKeys,
  imageRef,
  node,
} from "@typewright/font-model";
import type { Vec2 } from "@typewright/geometry";

/**
 * The on-disk format, written out explicitly rather than by dumping the model.
 *
 * The model is already plain JSON-able, so `JSON.stringify(glyph)` would work
 * today — and that is exactly the problem. It would make every future change to
 * an internal type a silent change to the stored format, discovered when
 * somebody's autosaved work fails to open. An explicit mapping is a place to
 * notice, and a place to hang migrations.
 *
 * Points are stored as `[x, y]` pairs rather than `{ x, y }` objects. A glyph
 * with forty nodes carries a hundred-odd points, a font has thousands of glyphs,
 * and `"pt":[100,480]` against `"pt":{"x":100,"y":480}` is most of the file.
 * That divergence from the model is the other reason encode and decode are
 * written by hand.
 */
export const SCHEMA_VERSION = 1;

export type StoredPoint = readonly [number, number];

export type StoredNode = {
  readonly id: string;
  readonly pt: StoredPoint;
  readonly type: NodeType;
  readonly in: StoredPoint | null;
  readonly out: StoredPoint | null;
  /**
   * Which handles are held to an axis. Omitted when neither is, which is almost
   * every node. `true` is the older form, when the lock was one flag for the
   * whole node, and still reads as both.
   */
  readonly hvLock?: true | "in" | "out";
};

export type StoredContour = {
  readonly id: string;
  readonly closed: boolean;
  readonly nodes: readonly StoredNode[];
};

export type StoredComponent = {
  readonly id: string;
  readonly base: string;
  /** UFO's order: xScale, xyScale, yxScale, yScale, xOffset, yOffset. */
  readonly transform: readonly [number, number, number, number, number, number];
};

export type StoredAnchor = {
  readonly id: string;
  readonly name: string;
  readonly at: StoredPoint;
};

export type StoredGlyph = {
  readonly schema: number;
  readonly name: string;
  readonly unicodes: readonly number[];
  readonly advance: number;
  readonly contours: readonly StoredContour[];
  /**
   * Optional on the way in, so a glyph written before components existed still
   * reads. Written always, so one saved now says plainly that it has none.
   */
  readonly components?: readonly StoredComponent[];
  /** Optional on the way in, for the same reason components are. */
  readonly anchors?: readonly StoredAnchor[];
  /** The glyph's own guides. Optional on the way in, as anchors are. */
  readonly guides?: readonly StoredGuide[];
  /**
   * The picture it is traced from: the file's name, and where it sits.
   *
   * The name only — the bytes are under `images/` in the same store, for the
   * reason the model gives: a scan in a document is a scan in every step of the
   * undo stack.
   */
  readonly image?: {
    readonly name: string;
    readonly transform: readonly number[];
    readonly color?: string;
  };
  /**
   * The parts of the glyph's own `.glif` this editor cannot model, verbatim.
   *
   * Written only when there are any, which is never for a glyph drawn here.
   */
  readonly kept?: readonly string[];
  /**
   * Where the glyph takes its spacing from, where it is another glyph's.
   *
   * Written only when it says something, which is never for a glyph spaced on
   * its own — and that is nearly every glyph in nearly every font.
   */
  readonly metricKeys?: {
    readonly left?: string;
    readonly right?: string;
    readonly width?: string;
  };
  /** The glyph's colour mark, as `"r,g,b,a"`. Written only when there is one. */
  readonly markColor?: string;
};

/** A guide: a point, an angle, and what it is called. */
export type StoredGuide = {
  readonly id: string;
  readonly at: StoredPoint;
  readonly angle: number;
  readonly name?: string;
  readonly color?: string;
};

export type StoredFontInfo = {
  readonly schema: number;
  /** Glyph names in order. Ordering belongs to the font, not to the glyphs. */
  readonly glyphOrder: readonly string[];
  readonly familyName: string;
  readonly styleName: string;
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly xHeight: number;
  readonly capHeight: number;
  /** Feature source. Omitted when empty, which is most fonts most of the time. */
  readonly features?: string;
  /** The font's own guides, drawn in every glyph. Omitted when there are none. */
  readonly guides?: readonly StoredGuide[];
  /**
   * `fontinfo` and `lib` keys this editor does not model, as they were found.
   *
   * Autosave has to carry these as faithfully as the file does. A reload that
   * dropped them would put the loss back exactly where it was taken out — the
   * next save to disk would write a font missing what the reader kept.
   */
  readonly kept?: { readonly fontInfo: PlainRecord; readonly lib: PlainRecord };
};

type PlainRecord = Readonly<Record<string, PlainValue>>;

/** Success, or a reason a file could not be understood. */
export type Decoded<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

const ok = <T>(value: T): Decoded<T> => ({ ok: true, value });
const fail = <T>(reason: string): Decoded<T> => ({ ok: false, reason });

// ---------------------------------------------------------------------------
// encoding
// ---------------------------------------------------------------------------

const point = (p: Vec2): StoredPoint => [p.x, p.y];

export function encodeGlyph(g: Glyph): StoredGlyph {
  return {
    schema: SCHEMA_VERSION,
    name: g.name,
    unicodes: [...g.unicodes],
    advance: g.advance,
    contours: g.contours.map(encodeContour),
    components: g.components.map(encodeComponent),
    anchors: g.anchors.map((a) => ({ id: a.id, name: a.name, at: point(a.pt) })),
    ...(g.guides.length === 0 ? {} : { guides: g.guides.map(encodeGuide) }),
    ...(g.image === null ? {} : { image: encodeImage(g.image) }),
    ...(g.kept.length === 0 ? {} : { kept: [...g.kept] }),
    ...(hasMetricKeys(g.metricKeys) ? { metricKeys: writtenKeys(g.metricKeys) } : {}),
    ...(g.markColor === null ? {} : { markColor: g.markColor }),
  };
}

function encodeComponent(c: Component): StoredComponent {
  const t = c.transform;
  // An array rather than an object: it is the order every font format writes
  // this transform in, and six keys repeated per component is a lot of file for
  // no added clarity.
  return {
    id: c.id,
    base: c.base,
    transform: [t.xScale, t.xyScale, t.yxScale, t.yScale, t.xOffset, t.yOffset],
  };
}

function encodeContour(c: Contour): StoredContour {
  return { id: c.id, closed: c.closed, nodes: c.nodes.map(encodeNode) };
}

function encodeNode(n: Node): StoredNode {
  const base = {
    id: n.id,
    pt: point(n.pt),
    type: n.type,
    in: n.in === null ? null : point(n.in),
    out: n.out === null ? null : point(n.out),
  };
  if (n.hvLock.in && n.hvLock.out) return { ...base, hvLock: true };
  if (n.hvLock.in) return { ...base, hvLock: "in" };
  if (n.hvLock.out) return { ...base, hvLock: "out" };
  return base;
}

export function encodeFontInfo(document: FontDocument): StoredFontInfo {
  const base = {
    schema: SCHEMA_VERSION,
    glyphOrder: [...document.glyphOrder],
    ...document.info,
    ...(document.guides.length === 0 ? {} : { guides: document.guides.map(encodeGuide) }),
    ...(nothingKept(document.kept) ? {} : { kept: document.kept }),
  };
  return document.features === "" ? base : { ...base, features: document.features };
}

function encodeImage(image: ImageRef): NonNullable<StoredGlyph["image"]> {
  const t = image.transform;
  // An array, as a component's transform is, and in the same order every font
  // format writes it.
  return {
    name: image.name,
    transform: [t.xScale, t.xyScale, t.yxScale, t.yScale, t.xOffset, t.yOffset],
    ...(image.color === null ? {} : { color: image.color }),
  };
}

function decodeImage(raw: unknown): ImageRef | null {
  if (!isRecord(raw) || typeof raw["name"] !== "string") return null;

  const t = raw["transform"];
  if (!Array.isArray(t) || t.length !== 6 || t.some((n) => typeof n !== "number")) return null;
  const [xScale, xyScale, yxScale, yScale, xOffset, yOffset] = t as number[];

  return imageRef(
    raw["name"],
    {
      xScale: xScale ?? 1,
      xyScale: xyScale ?? 0,
      yxScale: yxScale ?? 0,
      yScale: yScale ?? 1,
      xOffset: xOffset ?? 0,
      yOffset: yOffset ?? 0,
    },
    typeof raw["color"] === "string" ? raw["color"] : null,
  );
}

function encodeGuide(g: Guide): StoredGuide {
  return {
    id: g.id,
    at: point(g.pt),
    angle: g.angle,
    ...(g.name === "" ? {} : { name: g.name }),
    ...(g.color === null ? {} : { color: g.color }),
  };
}

const nothingKept = (kept: Kept): boolean =>
  Object.keys(kept.fontInfo).length === 0 && Object.keys(kept.lib).length === 0;

/**
 * Read the font's own measurements back, falling back field by field.
 *
 * A missing or nonsensical value takes the default rather than failing the load:
 * losing a project because someone hand-edited the x-height to a string would be
 * a poor trade.
 */
export function decodeFontInfo(raw: unknown): {
  info: FontInfo;
  glyphOrder: readonly string[];
  features: string;
  guides: readonly Guide[];
  kept: Kept;
} {
  if (!isRecord(raw)) {
    return {
      info: DEFAULT_FONT_INFO,
      glyphOrder: [],
      features: "",
      guides: [],
      kept: NOTHING_KEPT,
    };
  }

  return {
    info: readInfo(raw),
    glyphOrder: Array.isArray(raw["glyphOrder"])
      ? raw["glyphOrder"].filter((n): n is string => typeof n === "string")
      : [],
    features: typeof raw["features"] === "string" ? raw["features"] : "",
    guides: readGuides(raw["guides"]),
    kept: readKept(raw["kept"]),
  };
}

/**
 * Every field of the font's information, each falling back on its own.
 *
 * Driven off the defaults rather than written out field by field: there are
 * two dozen of them now, the rule is the same for every one — take it if it is
 * of the right kind, and take the default if it is not — and a list repeated in
 * two places is a list that will disagree with itself.
 */
function readInfo(raw: Record<string, unknown>): FontInfo {
  const out: Record<string, unknown> = { ...DEFAULT_FONT_INFO };

  for (const [key, fallback] of Object.entries(DEFAULT_FONT_INFO)) {
    const value = raw[key];
    // A `null` default is an override: a number the font decided, or nothing,
    // meaning derive it. Without this branch it fell to the string one below,
    // and every override a font set was dropped the next time it was opened.
    if (typeof fallback === "number" || fallback === null) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    } else if (Array.isArray(fallback)) {
      // The one list, of `fsSelection` bit numbers.
      if (Array.isArray(value)) {
        out[key] = value.filter(
          (bit): bit is number =>
            typeof bit === "number" && Number.isInteger(bit) && bit >= 0 && bit <= 15,
        );
      }
    } else if (typeof value === "string") {
      out[key] = value;
    }
  }

  // The one field that is not any string of its type.
  const style = out["styleMapStyleName"];
  if (!STYLE_MAP_STYLES.some((s) => s === style)) {
    out["styleMapStyleName"] = DEFAULT_FONT_INFO.styleMapStyleName;
  }

  return out as FontInfo;
}

/**
 * Read back what was kept, without believing anything about it.
 *
 * It came out of a plist and went through JSON, so whatever survives that is
 * exactly what a `PlainValue` is. Nothing here inspects it — the two records
 * are somebody else's data, and the only question is whether they are records.
 */
/**
 * Guides back from a file, dropping any that says nothing.
 *
 * A guide is a line to draw against and nothing depends on it, so one that
 * cannot be read is skipped rather than being a reason to fail the load.
 */
function readGuides(raw: unknown): Guide[] {
  if (!Array.isArray(raw)) return [];

  const out: Guide[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const at = decodePoint(entry["at"]);
    if (at === null || typeof entry["id"] !== "string") continue;

    out.push(
      guide(
        entry["id"],
        at,
        typeof entry["angle"] === "number" ? entry["angle"] : 0,
        typeof entry["name"] === "string" ? entry["name"] : "",
        typeof entry["color"] === "string" ? entry["color"] : null,
      ),
    );
  }
  return out;
}

function readKept(raw: unknown): Kept {
  if (!isRecord(raw)) return NOTHING_KEPT;
  const fontInfo = raw["fontInfo"];
  const lib = raw["lib"];
  return {
    fontInfo: isRecord(fontInfo) ? (fontInfo as PlainRecord) : {},
    lib: isRecord(lib) ? (lib as PlainRecord) : {},
  };
}

// ---------------------------------------------------------------------------
// decoding
//
// Everything read from a file is untrusted: it may be corrupt, hand-edited, or
// from a version that does not exist yet. Decoding validates and reports a
// reason rather than throwing, so one bad glyph does not take the project with
// it.
// ---------------------------------------------------------------------------

const NODE_TYPES: readonly NodeType[] = ["corner", "smooth", "tangent"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodePoint(raw: unknown): Vec2 | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  // `isArray` says `any[]`, so the two are read as unknown and checked below
  // rather than trusted into a destructuring.
  const pair = raw as unknown[];
  const x: unknown = pair[0];
  const y: unknown = pair[1];
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function decodeNode(raw: unknown): Decoded<Node> {
  if (!isRecord(raw)) return fail("node is not an object");
  if (typeof raw["id"] !== "string") return fail("node has no id");

  const pt = decodePoint(raw["pt"]);
  if (pt === null) return fail(`node ${raw["id"]} has no valid point`);

  const type = raw["type"];
  if (typeof type !== "string" || !NODE_TYPES.includes(type as NodeType)) {
    return fail(`node ${raw["id"]} has an unknown type`);
  }

  const incoming = raw["in"] === null || raw["in"] === undefined ? null : decodePoint(raw["in"]);
  if (raw["in"] != null && incoming === null)
    return fail(`node ${raw["id"]} has an invalid in handle`);

  const outgoing = raw["out"] === null || raw["out"] === undefined ? null : decodePoint(raw["out"]);
  if (raw["out"] != null && outgoing === null)
    return fail(`node ${raw["id"]} has an invalid out handle`);

  return ok(
    node(raw["id"], pt, {
      type: type as NodeType,
      in: incoming,
      out: outgoing,
      hvLock: decodeLock(raw["hvLock"]),
    }),
  );
}

/**
 * Read a stored lock, in either the current form or the one before it.
 *
 * Anything unrecognised reads as unlocked rather than failing the node. A lock
 * is a convenience, and losing one is not worth refusing to open a glyph over.
 */
function decodeLock(raw: unknown): HandleLock {
  if (raw === true) return BOTH_LOCKED;
  if (raw === "in") return { in: true, out: false };
  if (raw === "out") return { in: false, out: true };
  return NO_LOCK;
}

function decodeContour(raw: unknown): Decoded<Contour> {
  if (!isRecord(raw)) return fail("contour is not an object");
  if (typeof raw["id"] !== "string") return fail("contour has no id");
  if (!Array.isArray(raw["nodes"])) return fail(`contour ${raw["id"]} has no nodes`);

  const nodes: Node[] = [];
  for (const rawNode of raw["nodes"]) {
    const decoded = decodeNode(rawNode);
    if (!decoded.ok) return fail(decoded.reason);
    nodes.push(decoded.value);
  }

  return ok(contour(raw["id"], nodes, raw["closed"] === true));
}

export function decodeGlyph(raw: unknown): Decoded<Glyph> {
  const migrated = migrate(raw);
  if (!migrated.ok) return fail(migrated.reason);
  const source = migrated.value;

  if (typeof source["name"] !== "string") return fail("glyph has no name");
  if (!Array.isArray(source["contours"])) return fail(`glyph ${source["name"]} has no contours`);

  const contours: Contour[] = [];
  for (const rawContour of source["contours"]) {
    const decoded = decodeContour(rawContour);
    if (!decoded.ok) return fail(`glyph ${source["name"]}: ${decoded.reason}`);
    contours.push(decoded.value);
  }

  const unicodes = Array.isArray(source["unicodes"])
    ? source["unicodes"].filter((u): u is number => typeof u === "number")
    : [];
  const advance = typeof source["advance"] === "number" ? source["advance"] : 0;

  const components: Component[] = [];
  if (Array.isArray(source["components"])) {
    for (const raw of source["components"]) {
      const decoded = decodeComponent(raw);
      // A malformed component is dropped rather than failing the glyph: losing
      // one placement is recoverable, losing the outline it sits on is not.
      if (decoded !== null) components.push(decoded);
    }
  }

  const anchors: Anchor[] = [];
  if (Array.isArray(source["anchors"])) {
    for (const raw of source["anchors"]) {
      const decoded = decodeAnchor(raw);
      // Dropped rather than failing the glyph, as a malformed component is:
      // losing one attachment point is recoverable, losing the outline is not.
      if (decoded !== null) anchors.push(decoded);
    }
  }

  // Whatever the glyph's own file held that this editor cannot model, as the
  // reader found it. Strings only: it is XML on the way back out.
  const kept = Array.isArray(source["kept"])
    ? source["kept"].filter((k): k is string => typeof k === "string")
    : [];

  return ok(
    glyph(source["name"], {
      unicodes,
      advance,
      contours,
      components,
      anchors,
      guides: readGuides(source["guides"]),
      image: decodeImage(source["image"]),
      kept,
      metricKeys: readMetricKeys(source["metricKeys"]),
      markColor: typeof source["markColor"] === "string" ? source["markColor"] : null,
    }),
  );
}

function decodeAnchor(raw: unknown): Anchor | null {
  if (!isRecord(raw)) return null;
  if (typeof raw["id"] !== "string" || typeof raw["name"] !== "string") return null;

  const at = decodePoint(raw["at"]);
  return at === null ? null : anchor(raw["id"], raw["name"], at);
}

function decodeComponent(raw: unknown): Component | null {
  if (!isRecord(raw)) return null;
  if (typeof raw["id"] !== "string" || typeof raw["base"] !== "string") return null;

  const t: unknown = raw["transform"];
  if (!Array.isArray(t) || t.length !== 6) return null;

  const numbers: number[] = [];
  for (const value of t as unknown[]) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    numbers.push(value);
  }
  const [xScale, xyScale, yxScale, yScale, xOffset, yOffset] = numbers as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  return component(raw["id"], raw["base"], {
    xScale,
    xyScale,
    yxScale,
    yScale,
    xOffset,
    yOffset,
  });
}

// ---------------------------------------------------------------------------
// migration
// ---------------------------------------------------------------------------

/**
 * Bring a stored object up to the current schema.
 *
 * Empty at version 1, and that is the point of writing it now rather than later.
 * The moment the format first changes there is already stored data in the wild;
 * without a stamp on it, the only way to tell what shape it is would be to guess
 * from its contents. OPFS is a working store, so that data may exist nowhere
 * else.
 *
 * Each migration takes the shape at version N and returns the shape at N + 1.
 */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // 1: (raw) => ({ ...raw, schema: 2, /* … */ }),
};

export function migrate(raw: unknown): Decoded<Record<string, unknown>> {
  if (!isRecord(raw)) return fail("file is not an object");

  const stamped = raw["schema"];
  if (typeof stamped !== "number" || !Number.isInteger(stamped)) {
    return fail("file has no schema version");
  }
  if (stamped > SCHEMA_VERSION) {
    return fail(
      `file was written by a newer version (schema ${stamped}, this build understands ${SCHEMA_VERSION})`,
    );
  }

  let current = raw;
  for (let version = stamped; version < SCHEMA_VERSION; version++) {
    const step = MIGRATIONS[version];
    if (step === undefined) return fail(`no migration from schema ${version}`);
    current = step(current);
  }
  return ok(current);
}

// ---------------------------------------------------------------------------
// kerning
// ---------------------------------------------------------------------------

export type StoredKerning = {
  readonly schema: number;
  readonly firstGroups: Readonly<Record<string, readonly string[]>>;
  readonly secondGroups: Readonly<Record<string, readonly string[]>>;
  readonly pairs: Readonly<Record<string, Readonly<Record<string, number>>>>;
};

export function encodeKerning(kerning: Kerning): StoredKerning {
  return {
    schema: SCHEMA_VERSION,
    firstGroups: kerning.firstGroups,
    secondGroups: kerning.secondGroups,
    pairs: kerning.pairs,
  };
}

/**
 * Read kerning back, discarding anything malformed.
 *
 * Never fails. Kerning is a refinement on top of outlines that are already
 * correct without it, so a damaged pair costs that pair; refusing to open the
 * font over one would trade something serious for something trivial.
 */
export function decodeKerning(raw: unknown): Kerning {
  if (!isRecord(raw)) return EMPTY_KERNING;

  const groups = (value: unknown): Record<string, string[]> => {
    if (!isRecord(value)) return {};
    const out: Record<string, string[]> = {};
    for (const [name, members] of Object.entries(value)) {
      if (!Array.isArray(members)) continue;
      const glyphs = members.filter((m): m is string => typeof m === "string");
      if (glyphs.length > 0) out[name] = glyphs;
    }
    return out;
  };

  const pairs: Record<string, Record<string, number>> = {};
  if (isRecord(raw["pairs"])) {
    for (const [first, row] of Object.entries(raw["pairs"])) {
      if (!isRecord(row)) continue;
      const kept: Record<string, number> = {};
      for (const [second, value] of Object.entries(row)) {
        if (typeof value === "number" && Number.isFinite(value)) kept[second] = value;
      }
      if (Object.keys(kept).length > 0) pairs[first] = kept;
    }
  }

  return {
    firstGroups: groups(raw["firstGroups"]),
    secondGroups: groups(raw["secondGroups"]),
    pairs,
  };
}

/** The three keys, with the empty ones left out of the file. */
function writtenKeys(keys: MetricKeys): NonNullable<StoredGlyph["metricKeys"]> {
  return {
    ...(keys.left === "" ? {} : { left: keys.left }),
    ...(keys.right === "" ? {} : { right: keys.right }),
    ...(keys.width === "" ? {} : { width: keys.width }),
  };
}

/** And back, believing nothing about what is on disk. */
function readMetricKeys(raw: unknown): MetricKeys {
  if (!isRecord(raw)) return NO_METRIC_KEYS;
  const said = (key: string): string => (typeof raw[key] === "string" ? raw[key] : "");
  return { left: said("left"), right: said("right"), width: said("width") };
}
