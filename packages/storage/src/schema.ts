import {
  type Component,
  type Kerning,
  EMPTY_KERNING,
  type Contour,
  type FontDocument,
  type FontInfo,
  type Glyph,
  type Node,
  type NodeType,
  DEFAULT_FONT_INFO,
  component,
  contour,
  fontDocument,
  glyph,
  node,
} from "@fonteditor/font-model";
import type { Vec2 } from "@fonteditor/geometry";

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
  /** Omitted when false, which is almost every node. */
  readonly hvLock?: true;
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
};

/** Success, or a reason a file could not be understood. */
export type Decoded<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

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
  return n.hvLock ? { ...base, hvLock: true } : base;
}

export function encodeFontInfo(document: FontDocument): StoredFontInfo {
  return {
    schema: SCHEMA_VERSION,
    glyphOrder: [...document.glyphOrder],
    ...document.info,
  };
}

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
} {
  if (!isRecord(raw)) return { info: DEFAULT_FONT_INFO, glyphOrder: [] };

  const number = (key: keyof FontInfo, fallback: number): number => {
    const value = raw[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };
  const text = (key: keyof FontInfo, fallback: string): string => {
    const value = raw[key];
    return typeof value === "string" ? value : fallback;
  };

  return {
    info: {
      familyName: text("familyName", DEFAULT_FONT_INFO.familyName),
      styleName: text("styleName", DEFAULT_FONT_INFO.styleName),
      unitsPerEm: number("unitsPerEm", DEFAULT_FONT_INFO.unitsPerEm),
      ascender: number("ascender", DEFAULT_FONT_INFO.ascender),
      descender: number("descender", DEFAULT_FONT_INFO.descender),
      xHeight: number("xHeight", DEFAULT_FONT_INFO.xHeight),
      capHeight: number("capHeight", DEFAULT_FONT_INFO.capHeight),
    },
    glyphOrder: Array.isArray(raw["glyphOrder"])
      ? raw["glyphOrder"].filter((n): n is string => typeof n === "string")
      : [],
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
  const [x, y] = raw;
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
  if (raw["in"] != null && incoming === null) return fail(`node ${raw["id"]} has an invalid in handle`);

  const outgoing = raw["out"] === null || raw["out"] === undefined ? null : decodePoint(raw["out"]);
  if (raw["out"] != null && outgoing === null) return fail(`node ${raw["id"]} has an invalid out handle`);

  return ok(
    node(raw["id"], pt, {
      type: type as NodeType,
      in: incoming,
      out: outgoing,
      hvLock: raw["hvLock"] === true,
    }),
  );
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

  return ok(glyph(source["name"], { unicodes, advance, contours, components }));
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
    number, number, number, number, number, number,
  ];

  return component(raw["id"], raw["base"], {
    xScale, xyScale, yxScale, yScale, xOffset, yOffset,
  });
}

export function decodeDocument(raw: unknown): Decoded<FontDocument> {
  const decoded = decodeGlyph(raw);
  return decoded.ok ? ok(fontDocument([decoded.value])) : fail(decoded.reason);
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
