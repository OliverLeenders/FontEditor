import {
  type Anchor,
  type Component,
  type Contour,
  type Glyph,
  type Guide,
  type ImageRef,
  type IdFactory,
  type Node,
  anchor,
  component,
  contour,
  glyph,
  guide,
  imageRef,
  node,
} from "@typewright/font-model";
import { IDENTITY_AFFINE, type Vec2 } from "@typewright/geometry";

import {
  type XmlElement,
  childNamed,
  childrenNamed,
  isElement,
  parseXml,
  textOf,
  writeXml,
} from "./xml.js";

/**
 * Reading a `.glif`: UFO's outline format, and the mirror of `glif()` beside it.
 *
 * The whole subtlety is the point list. UFO stores a contour as one flat cyclic
 * list in which an on-curve point carries the type of the segment *arriving* at
 * it, and that segment's control points sit immediately before it. So a control
 * point belongs to the node after it or the node before it depending on which of
 * the pair it is, and the list wraps — the closing segment's controls are at the
 * end and pair with the first point.
 *
 * Going the other way means walking the list, gathering the run of off-curve
 * points before each on-curve one, and handing the first of that run to the
 * previous node's `out` and the last to this node's `in`.
 */

export type GlifWarning = {
  readonly glyph: string | null;
  readonly message: string;
};

type RawPoint = {
  readonly pt: Vec2;
  /** Absent for an off-curve control point. */
  readonly type: string | null;
  readonly smooth: boolean;
};

const number = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/**
 * Parse one glif into a glyph.
 *
 * `null` only when the file is not a glif at all. Everything short of that is a
 * warning and a glyph: a contour with a bad point is dropped and reported, and
 * the rest of the glyph still opens. A font is worth more with one contour
 * missing than not at all, and silence is what would make that a bad trade.
 */
export function parseGlif(
  source: string,
  ids: IdFactory,
  warn: (message: string) => void,
): Glyph | null {
  const root = parseXml(source);
  if (root === null || root.name !== "glyph") return null;

  const name = root.attributes["name"] ?? "";
  const advanceElement = childNamed(root, "advance");
  const advance = advanceElement === null ? 0 : (number(advanceElement.attributes["width"]) ?? 0);

  const unicodes: number[] = [];
  for (const u of childrenNamed(root, "unicode")) {
    const hex = u.attributes["hex"];
    if (hex === undefined) continue;
    const code = Number.parseInt(hex, 16);
    if (Number.isNaN(code)) warn(`ignored an unreadable unicode value "${hex}"`);
    else unicodes.push(code);
  }

  const outline = childNamed(root, "outline");
  const contours: Contour[] = [];
  const components: Component[] = [];
  const anchors: Anchor[] = [];

  if (outline !== null) {
    for (const element of outline.children) {
      if (!("name" in element)) continue;
      if (element.name === "contour") {
        // A format-1 file has no <anchor> element and writes an anchor as a
        // contour of one named move point. Reading that as a one-point contour
        // would put a stray point in the outline and lose the attachment, so it
        // is recognised here and turned into what it means.
        const legacy = legacyAnchor(element, ids);
        if (legacy !== null) {
          anchors.push(legacy);
          continue;
        }
        const c = parseContour(element, ids, warn);
        if (c !== null) contours.push(c);
      } else if (element.name === "component") {
        const placed = parseComponent(element, ids, warn);
        if (placed !== null) components.push(placed);
      }
    }
  }

  // Format 2 puts anchors beside the outline rather than inside it.
  for (const element of childrenNamed(root, "anchor")) {
    const x = number(element.attributes["x"]);
    const y = number(element.attributes["y"]);
    if (x === null || y === null) {
      warn("dropped an anchor with no position");
      continue;
    }
    anchors.push(anchor(ids.anchor(), element.attributes["name"] ?? "", { x, y }));
  }

  const guides: Guide[] = [];
  for (const element of childrenNamed(root, "guideline")) {
    const read = parseGuideline(element, ids);
    if (read === null) warn("dropped a guideline with no position");
    else guides.push(read);
  }

  const { kept, markColor } = keptOf(root);
  return glyph(name, {
    unicodes,
    advance,
    contours,
    components,
    anchors,
    guides,
    image: parseImage(childNamed(root, "image")),
    kept,
    markColor,
  });
}

/**
 * One guideline, in any of the three ways the format writes them.
 *
 * `x` alone is a vertical line, `y` alone a horizontal one, and the two
 * together with an angle is a line through that point. The model keeps all
 * three as a point and an angle, which is the same set of lines said once
 * instead of three times.
 */
export function parseGuideline(element: XmlElement, ids: IdFactory): Guide | null {
  const x = number(element.attributes["x"]);
  const y = number(element.attributes["y"]);
  const angle = number(element.attributes["angle"]);
  const name = element.attributes["name"] ?? "";
  const color = element.attributes["color"] ?? null;

  if (x !== null && y !== null) {
    // The format requires an angle alongside both coordinates. A file without
    // one is somebody's hand edit, and level is the likelier of the two.
    return guide(ids.guide(), { x, y }, angle ?? 0, name, color);
  }
  if (x !== null) return guide(ids.guide(), { x, y: 0 }, 90, name, color);
  if (y !== null) return guide(ids.guide(), { x: 0, y }, 0, name, color);
  return null;
}

/** The elements of a `.glif` this editor models, and therefore rewrites. */
const MODELLED = new Set(["advance", "unicode", "outline", "anchor", "guideline", "image"]);

/**
 * The picture this glyph is traced from, if it names one.
 *
 * The six numbers are the same transform a component carries and default the
 * same way, so an image with only a `fileName` sits on the baseline at one
 * pixel to the unit — which is what UFO says an untransformed image means.
 */
export function parseImage(element: XmlElement | null): ImageRef | null {
  if (element === null) return null;

  const name = element.attributes["fileName"];
  if (name === undefined || name === "") return null;

  const at = (key: string, fallback: number): number => number(element.attributes[key]) ?? fallback;
  return imageRef(
    name,
    {
      xScale: at("xScale", 1),
      xyScale: at("xyScale", 0),
      yxScale: at("yxScale", 0),
      yScale: at("yScale", 1),
      xOffset: at("xOffset", 0),
      yOffset: at("yOffset", 0),
    },
    element.attributes["color"] ?? null,
  );
}

/**
 * Everything else in the file, as the XML it was written as.
 *
 * A `.glif` may carry guidelines, a note, an image, and a `lib` anybody may put
 * anything in. None of it is modelled here, and none of it may be lost either:
 * this editor now saves over the folder a font was opened from, so a glyph
 * written back without them is a glyph that has had them taken out.
 *
 * Kept as text rather than parsed, deliberately. Parsing would mean deciding
 * what these mean, and the whole point is that we do not know.
 */
function keptOf(root: XmlElement): { kept: string[]; markColor: string | null } {
  const kept: string[] = [];
  let markColor: string | null = null;
  for (const child of root.children) {
    if (!isElement(child) || MODELLED.has(child.name)) continue;
    if (child.name === "lib") {
      // One key of the lib is modelled, the mark colour, and the rest are kept.
      const read = withoutMarkColor(child);
      markColor = read.markColor;
      if (read.lib !== null) kept.push(writeXml(read.lib, "\t"));
      continue;
    }
    kept.push(writeXml(child, "\t"));
  }
  return { kept, markColor };
}

/** The lib key a glyph's colour mark is kept under, by the UFO's own convention. */
const MARK_COLOR_KEY = "public.markColor";

/**
 * A glyph's `lib` with its mark colour taken out.
 *
 * The colour is read into the model, so it must not also ride along in what is
 * kept, or saving would write it twice. Everything else in the lib is somebody
 * else's and stays exactly as it was; a lib that held nothing but the colour is
 * not kept at all, since an empty one says nothing.
 */
function withoutMarkColor(lib: XmlElement): { lib: XmlElement | null; markColor: string | null } {
  const dict = childNamed(lib, "dict");
  if (dict === null) return { lib, markColor: null };

  const entries = dict.children.filter(isElement);
  const at = entries.findIndex((e) => e.name === "key" && textOf(e).trim() === MARK_COLOR_KEY);
  const key = entries[at];
  const value = entries[at + 1];
  if (key === undefined || value?.name !== "string") return { lib, markColor: null };

  const remaining = dict.children.filter((c) => c !== key && c !== value);
  const markColor = textOf(value).trim();
  if (!remaining.some(isElement)) return { lib: null, markColor };

  const children = lib.children.map((c) => (c === dict ? { ...dict, children: remaining } : c));
  return { lib: { ...lib, children }, markColor };
}

/** A format-1 anchor: one point, of type `move`, carrying a name. */
function legacyAnchor(element: XmlElement, ids: IdFactory): Anchor | null {
  const points = childrenNamed(element, "point");
  if (points.length !== 1) return null;

  const only = points[0]!;
  if (only.attributes["type"] !== "move") return null;

  const name = only.attributes["name"];
  if (name === undefined || name === "") return null;

  const x = number(only.attributes["x"]);
  const y = number(only.attributes["y"]);
  if (x === null || y === null) return null;

  return anchor(ids.anchor(), name, { x, y });
}

function parseComponent(
  element: XmlElement,
  ids: IdFactory,
  warn: (message: string) => void,
): Component | null {
  const base = element.attributes["base"];
  if (base === undefined || base === "") {
    warn("dropped a component that names no glyph");
    return null;
  }

  return component(ids.component(), base, {
    xScale: number(element.attributes["xScale"]) ?? IDENTITY_AFFINE.xScale,
    xyScale: number(element.attributes["xyScale"]) ?? IDENTITY_AFFINE.xyScale,
    yxScale: number(element.attributes["yxScale"]) ?? IDENTITY_AFFINE.yxScale,
    yScale: number(element.attributes["yScale"]) ?? IDENTITY_AFFINE.yScale,
    xOffset: number(element.attributes["xOffset"]) ?? IDENTITY_AFFINE.xOffset,
    yOffset: number(element.attributes["yOffset"]) ?? IDENTITY_AFFINE.yOffset,
  });
}

function parseContour(
  element: XmlElement,
  ids: IdFactory,
  warn: (message: string) => void,
): Contour | null {
  const raw: RawPoint[] = [];
  for (const p of childrenNamed(element, "point")) {
    const x = number(p.attributes["x"]);
    const y = number(p.attributes["y"]);
    if (x === null || y === null) {
      warn("dropped a contour with a point that has no position");
      return null;
    }
    raw.push({
      pt: { x, y },
      type: p.attributes["type"] ?? null,
      smooth: p.attributes["smooth"] === "yes",
    });
  }

  if (raw.length === 0) return null;

  // An outline of nothing but control points describes no curve at all.
  if (!raw.some((p) => p.type !== null)) {
    warn("dropped a contour with no on-curve points");
    return null;
  }

  // A contour is open exactly when it begins with a move. Everything else wraps.
  const closed = raw[0]?.type !== "move";
  const points = expandQuadratics(raw, warn);

  return buildContour(points, closed, ids);
}

/**
 * Turn quadratic segments into the cubics the model holds.
 *
 * The conversion itself is exact — a quadratic is a cubic whose controls sit two
 * thirds of the way from each anchor toward the quadratic's own control — so
 * nothing is approximated here. What has to be handled first is TrueType's habit
 * of leaving on-curve points out: a run of several controls in a row implies an
 * on-curve point midway between each neighbouring pair, and those are put back
 * before the conversion.
 */
function expandQuadratics(raw: readonly RawPoint[], warn: (message: string) => void): RawPoint[] {
  if (!raw.some((p) => p.type === "qcurve")) return [...raw];
  warn("converted quadratic curves to cubics");

  const out: RawPoint[] = [];
  const n = raw.length;

  for (let i = 0; i < n; i++) {
    const point = raw[i]!;
    if (point.type !== "qcurve") {
      out.push(point);
      continue;
    }

    // Gather the controls of this segment: the run of off-curves before it.
    const controls: Vec2[] = [];
    for (let back = 1; back <= n; back++) {
      const at = (i - back + n) % n;
      const candidate = raw[at]!;
      if (candidate.type !== null) break;
      controls.unshift(candidate.pt);
    }

    // Those controls were already pushed as themselves; take them back off, the
    // implied midpoints and the cubic controls go in their place.
    out.length -= Math.min(controls.length, out.length);

    const startIndex = (i - controls.length - 1 + n) % n;
    let start = raw[startIndex]!.pt;

    for (let k = 0; k < controls.length; k++) {
      const q = controls[k]!;
      const last = k === controls.length - 1;
      const end = last ? point.pt : midpoint(q, controls[k + 1]!);

      out.push({ pt: cubicControl(start, q), type: null, smooth: false });
      out.push({ pt: cubicControl(end, q), type: null, smooth: false });
      out.push(last ? { ...point, type: "curve" } : { pt: end, type: "curve", smooth: true });
      start = end;
    }

    if (controls.length === 0) out.push({ ...point, type: "line" });
  }

  return out;
}

const midpoint = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** The cubic control that reproduces a quadratic's, seen from one anchor. */
const cubicControl = (anchor: Vec2, q: Vec2): Vec2 => ({
  x: anchor.x + (2 / 3) * (q.x - anchor.x),
  y: anchor.y + (2 / 3) * (q.y - anchor.y),
});

/**
 * Walk the point list into nodes.
 *
 * Each on-curve point becomes a node. The off-curve run immediately before it
 * belongs to the segment arriving there: its last member is this node's `in`,
 * and its first is the previous node's `out`.
 *
 * A control that lands exactly on its own anchor is dropped. It is not a handle
 * — it is the absence of one written down, which is how a half-handled curve
 * reaches a file that cannot leave a control out without becoming ambiguous.
 * Keeping it would put a control point where nothing can be clicked, which is
 * the state `extractHandles` exists to get back out of. The two readings are the
 * same curve; only one of them is editable.
 */
/** Whether a control sits exactly on the anchor it belongs to. */
function onAnchor(handle: Vec2 | null, anchor: Vec2): boolean {
  return handle !== null && handle.x === anchor.x && handle.y === anchor.y;
}

function buildContour(
  points: readonly RawPoint[],
  closed: boolean,
  ids: IdFactory,
): Contour | null {
  const onCurve = points.map((p, i) => ({ p, i })).filter(({ p }) => p.type !== null);
  if (onCurve.length === 0) return null;

  const handles = new Map<number, { in: Vec2 | null; out: Vec2 | null }>();
  for (const { i } of onCurve) handles.set(i, { in: null, out: null });

  const n = points.length;
  for (let k = 0; k < onCurve.length; k++) {
    const here = onCurve[k]!;
    // An open contour's first point has no segment arriving at it.
    if (!closed && k === 0) continue;

    const controls: number[] = [];
    for (let back = 1; back <= n; back++) {
      const at = (here.i - back + n) % n;
      if (points[at]!.type !== null) break;
      controls.unshift(at);
    }
    if (controls.length === 0) continue;

    const previous = onCurve[(k - 1 + onCurve.length) % onCurve.length]!;
    const first = controls[0]!;
    const last = controls[controls.length - 1]!;

    // With one control the two ends would otherwise both claim it. It belongs to
    // the arriving side, which is where UFO puts a lone control.
    if (controls.length > 1) handles.get(previous.i)!.out = points[first]!.pt;
    handles.get(here.i)!.in = points[last]!.pt;
  }

  const nodes: Node[] = onCurve.map(({ p, i }) => {
    const h = handles.get(i)!;
    return node(ids.node(), p.pt, {
      type: p.smooth ? "smooth" : "corner",
      in: onAnchor(h.in, p.pt) ? null : h.in,
      out: onAnchor(h.out, p.pt) ? null : h.out,
    });
  });

  return contour(ids.contour(), nodes, closed);
}
