import {
  type Contour,
  type FontDocument,
  type Glyph,
  type IdFactory,
  PRIVATE_USE_FIRST,
  PRIVATE_USE_LAST,
  contourWinding,
  correctDirections,
  fixedWidthOf,
  freePrivateUse,
  glyph,
  glyphNameFromText,
  reverseContour,
  withNib,
} from "@typewright/font-model";

import { type PathCommand, contoursFromCommands } from "./commands.js";
import { type XmlElement, isElement, parseXml, textOf } from "./xml.js";

/**
 * An SVG read as a drawing a glyph can be made from.
 *
 * What an icon set is drawn in. An icon is a handful of shapes in a square, and
 * a font wants each as contours on its own em, so this reads the shapes — paths
 * and the basic ones, through whatever groups and transforms they sit in — into
 * the same path commands a font file's outlines arrive as, and
 * {@link contoursFromSvg} turns those into contours where a glyph wants them.
 *
 * Two kinds of shape come out. A filled one is an outline: its contours are the
 * edge of the ink. A stroked one is a skeleton, the path a pen was drawn along,
 * and comes in as a stroke contour with a round pen of the stroke's width — so
 * an icon set drawn in strokes stays drawn in strokes, and its weight can be
 * changed afterwards. A round pen is exactly an SVG stroke with round caps and
 * joins, which is what stroked icon sets are nearly always drawn with; square
 * ends and mitred corners come in rounded, and the drawing says which it had.
 *
 * Colour is not read, since a glyph has none: anything painted is ink. What a
 * drawing has that a glyph cannot — text, pictures, shapes cut by a clip or a
 * mask, a shape used by reference — is left out and named in `warnings`.
 */
export type SvgDrawing = {
  /** The box the drawing was made in, in its own units, y running down. */
  readonly viewBox: SvgBox;
  readonly shapes: readonly SvgShape[];
  /** What was left out or changed, each said once. */
  readonly warnings: readonly string[];
};

export type SvgBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type SvgShape = {
  /** The shape in the drawing's own units, every transform above it applied. */
  readonly commands: readonly PathCommand[];
  readonly filled: boolean;
  /** Filled by the even-odd rule, where a shape inside a shape is a hole whichever way it runs. */
  readonly evenOdd: boolean;
  /** The stroke's width in the drawing's units, or `null` for a shape with none. */
  readonly stroke: { readonly width: number } | null;
};

/** `[a, b, c, d, e, f]`: x′ = a·x + c·y + e and y′ = b·x + d·y + f, as SVG writes a matrix. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `outer` applied after `inner`: a child's transform inside its parent's. */
function compose(outer: Matrix, inner: Matrix): Matrix {
  const [a, b, c, d, e, f] = outer;
  const [A, B, C, D, E, F] = inner;
  return [
    a * A + c * B,
    b * A + d * B,
    a * C + c * D,
    b * C + d * D,
    a * E + c * F + e,
    b * E + d * F + f,
  ];
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** How much a matrix scales lengths by, taken evenly: what a stroke's width is multiplied by. */
function scaleOf(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/** Every number in a string of them, however they are separated. */
function numbers(text: string): number[] {
  const found = text.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  return found.map(Number);
}

/** A `transform` attribute: any number of functions, the first outermost. */
function parseTransform(text: string | undefined): Matrix {
  if (text === undefined) return IDENTITY;
  let out: Matrix = IDENTITY;
  for (const [, name, body] of text.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const n = numbers(body ?? "");
    const at = (i: number, fallback = 0): number => n[i] ?? fallback;
    let m: Matrix = IDENTITY;
    if (name === "matrix" && n.length >= 6) m = [at(0), at(1), at(2), at(3), at(4), at(5)];
    else if (name === "translate") m = [1, 0, 0, 1, at(0), at(1)];
    else if (name === "scale") m = [at(0, 1), 0, 0, at(1, at(0, 1)), 0, 0];
    else if (name === "rotate") {
      const r = (at(0) * Math.PI) / 180;
      const turn: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
      // About a point: there, turned, and back.
      m =
        n.length >= 3
          ? compose(compose([1, 0, 0, 1, at(1), at(2)], turn), [1, 0, 0, 1, -at(1), -at(2)])
          : turn;
    } else if (name === "skewX") m = [1, 0, Math.tan((at(0) * Math.PI) / 180), 1, 0, 0];
    else if (name === "skewY") m = [1, Math.tan((at(0) * Math.PI) / 180), 0, 1, 0, 0];
    out = compose(out, m);
  }
  return out;
}

/** What decides how a shape is painted, as far as a glyph cares. */
type Paint = {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly cap: string;
  readonly join: string;
  readonly fillRule: string;
  readonly shown: boolean;
};

const ROOT_PAINT: Paint = {
  fill: "black",
  stroke: "none",
  strokeWidth: 1,
  cap: "butt",
  join: "miter",
  fillRule: "nonzero",
  shown: true,
};

/** `a: b; c: d` as a record, the way a `style` attribute and a rule's body are both written. */
function declarations(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    out[part.slice(0, colon).trim().toLowerCase()] = part.slice(colon + 1).trim();
  }
  return out;
}

/**
 * The rules of a `<style>` element, by class.
 *
 * Only `.name { … }`, alone or in a list, which is what a drawing program
 * writes when it writes a stylesheet at all: `.cls-1{fill:none;stroke:#000}`.
 * Anything cleverer is not read, and the shapes it would have painted come in
 * as the attributes on them say.
 */
function classRules(root: XmlElement): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();
  const visit = (element: XmlElement): void => {
    if (localName(element) === "style") {
      const css = textOf(element).replace(/\/\*[\s\S]*?\*\//g, "");
      for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        for (const selector of (selectors ?? "").split(",")) {
          const name = /^\s*\.([\w-]+)\s*$/.exec(selector)?.[1];
          if (name === undefined) continue;
          rules.set(name, { ...rules.get(name), ...declarations(body ?? "") });
        }
      }
    }
    for (const child of element.children) if (isElement(child)) visit(child);
  };
  visit(root);
  return rules;
}

/** An element's name without a namespace prefix: `svg:path` is a `path`. */
function localName(element: XmlElement): string {
  const colon = element.name.indexOf(":");
  return colon < 0 ? element.name : element.name.slice(colon + 1);
}

/**
 * The paint an element ends up with: what it inherits, then its attributes,
 * then the rules of its classes, then its own `style`, each over the last —
 * the order a browser applies them in.
 */
function paintOf(
  element: XmlElement,
  inherited: Paint,
  rules: ReadonlyMap<string, Record<string, string>>,
): Paint {
  const said: Record<string, string> = {};
  for (const [key, value] of Object.entries(element.attributes)) said[key.toLowerCase()] = value;
  for (const name of (element.attributes["class"] ?? "").split(/\s+/)) {
    Object.assign(said, rules.get(name));
  }
  Object.assign(said, declarations(element.attributes["style"] ?? ""));

  const width =
    said["stroke-width"] === undefined ? Number.NaN : Number.parseFloat(said["stroke-width"]);
  return {
    fill: said["fill"] ?? inherited.fill,
    stroke: said["stroke"] ?? inherited.stroke,
    strokeWidth: Number.isFinite(width) ? width : inherited.strokeWidth,
    cap: said["stroke-linecap"] ?? inherited.cap,
    join: said["stroke-linejoin"] ?? inherited.join,
    fillRule: said["fill-rule"] ?? inherited.fillRule,
    shown: inherited.shown && said["display"] !== "none" && said["visibility"] !== "hidden",
  };
}

const painted = (value: string): boolean => {
  const v = value.trim().toLowerCase();
  return v !== "none" && v !== "transparent";
};

/** The circle a quarter of which a cubic stands in for: how far its handles reach. */
const KAPPA = 0.5522847498307936;

/**
 * An elliptical arc as cubics, from where the pen is to `(x, y)`.
 *
 * The arc is given by its ends, as a path writes it, and a cubic wants its
 * centre, so that is found first (the conversion the SVG specification gives),
 * and the arc is then cut into pieces of a quarter turn or less, each of which
 * a cubic draws to within a few thousandths of its radius.
 */
function arcToCubics(
  from: { x: number; y: number },
  rxIn: number,
  ryIn: number,
  rotation: number,
  large: boolean,
  sweep: boolean,
  x: number,
  y: number,
): PathCommand[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (from.x === x && from.y === y) return [];
  if (rx === 0 || ry === 0) return [{ type: "L", x, y }];

  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - x) / 2;
  const dy = (from.y - y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;

  // Radii too small to reach are grown until they do, as the specification says.
  const reach = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (reach > 1) {
    rx *= Math.sqrt(reach);
    ry *= Math.sqrt(reach);
  }

  const top = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const under = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, top / under));
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from.x + x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + y) / 2;

  const angle = (ux: number, uy: number): number => Math.atan2(uy, ux);
  const start = angle((x1 - cx1) / rx, (y1 - cy1) / ry);
  let turn = angle((-x1 - cx1) / rx, (-y1 - cy1) / ry) - start;
  if (sweep && turn < 0) turn += 2 * Math.PI;
  if (!sweep && turn > 0) turn -= 2 * Math.PI;

  const pieces = Math.max(1, Math.ceil(Math.abs(turn) / (Math.PI / 2) - 1e-9));
  const step = turn / pieces;
  // How far a cubic's handles reach to draw this much of a circle.
  const reachOf = (4 / 3) * Math.tan(step / 4);
  const at = (t: number): { x: number; y: number; dx: number; dy: number } => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    return {
      x: cx + rx * c * cos - ry * s * sin,
      y: cy + rx * c * sin + ry * s * cos,
      dx: -rx * s * cos - ry * c * sin,
      dy: -rx * s * sin + ry * c * cos,
    };
  };

  const out: PathCommand[] = [];
  for (let i = 0; i < pieces; i++) {
    const a = at(start + step * i);
    const b = at(start + step * (i + 1));
    out.push({
      type: "C",
      x1: a.x + a.dx * reachOf,
      y1: a.y + a.dy * reachOf,
      x2: b.x - b.dx * reachOf,
      y2: b.y - b.dy * reachOf,
      // The last piece ends exactly where the path says, not where the
      // arithmetic arrived.
      x: i === pieces - 1 ? x : b.x,
      y: i === pieces - 1 ? y : b.y,
    });
  }
  return out;
}

/**
 * A path's `d` as commands in absolute coordinates.
 *
 * Read a character at a time rather than split on spaces, because path data is
 * written to be short: `a1 1 0 011 1` is an arc whose two flags and the number
 * after them share one run of digits, and `1-2.5.5` is three numbers.
 */
function parsePath(d: string): PathCommand[] {
  const out: PathCommand[] = [];
  let at = 0;
  const skip = (): void => {
    while (at < d.length && /[\s,]/.test(d[at]!)) at += 1;
  };
  const number = (): number | null => {
    skip();
    const found = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(d.slice(at));
    if (found === null) return null;
    at += found[0].length;
    return Number(found[0]);
  };
  const flag = (): boolean | null => {
    skip();
    const c = d[at];
    if (c !== "0" && c !== "1") return null;
    at += 1;
    return c === "1";
  };

  let pen = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  /** The last control point, which a smooth curve reflects; `null` after anything else. */
  let cubicControl: { x: number; y: number } | null = null;
  let quadControl: { x: number; y: number } | null = null;
  let command = "";

  for (;;) {
    skip();
    if (at >= d.length) break;
    if (/[a-zA-Z]/.test(d[at]!)) {
      command = d[at]!;
      at += 1;
    } else if (command === "") {
      break;
    }
    const relative = command === command.toLowerCase();
    const kind = command.toUpperCase();
    const ox = relative ? pen.x : 0;
    const oy = relative ? pen.y : 0;

    if (kind === "Z") {
      out.push({ type: "Z" });
      pen = start;
      cubicControl = quadControl = null;
      // A number after a `z` belongs to nothing; stop rather than loop on it.
      command = "";
      continue;
    }

    if (kind === "M" || kind === "L" || kind === "T") {
      const x = number();
      const y = number();
      if (x === null || y === null) break;
      const to = { x: x + ox, y: y + oy };
      if (kind === "M") {
        out.push({ type: "M", ...to });
        start = to;
        // Further pairs after a move are lines.
        command = relative ? "l" : "L";
        quadControl = null;
      } else if (kind === "L") {
        out.push({ type: "L", ...to });
        quadControl = null;
      } else {
        const control: { x: number; y: number } =
          quadControl === null
            ? pen
            : { x: 2 * pen.x - quadControl.x, y: 2 * pen.y - quadControl.y };
        out.push({ type: "Q", x1: control.x, y1: control.y, ...to });
        quadControl = control;
      }
      pen = to;
      cubicControl = null;
      continue;
    }

    if (kind === "H" || kind === "V") {
      const v = number();
      if (v === null) break;
      pen = kind === "H" ? { x: v + ox, y: pen.y } : { x: pen.x, y: v + oy };
      out.push({ type: "L", ...pen });
      cubicControl = quadControl = null;
      continue;
    }

    if (kind === "C" || kind === "S") {
      let x1: number;
      let y1: number;
      if (kind === "C") {
        const a = number();
        const b = number();
        if (a === null || b === null) break;
        x1 = a + ox;
        y1 = b + oy;
      } else {
        x1 = cubicControl === null ? pen.x : 2 * pen.x - cubicControl.x;
        y1 = cubicControl === null ? pen.y : 2 * pen.y - cubicControl.y;
      }
      const x2 = number();
      const y2 = number();
      const x = number();
      const y = number();
      if (x2 === null || y2 === null || x === null || y === null) break;
      out.push({ type: "C", x1, y1, x2: x2 + ox, y2: y2 + oy, x: x + ox, y: y + oy });
      cubicControl = { x: x2 + ox, y: y2 + oy };
      quadControl = null;
      pen = { x: x + ox, y: y + oy };
      continue;
    }

    if (kind === "Q") {
      const x1 = number();
      const y1 = number();
      const x = number();
      const y = number();
      if (x1 === null || y1 === null || x === null || y === null) break;
      out.push({ type: "Q", x1: x1 + ox, y1: y1 + oy, x: x + ox, y: y + oy });
      quadControl = { x: x1 + ox, y: y1 + oy };
      cubicControl = null;
      pen = { x: x + ox, y: y + oy };
      continue;
    }

    if (kind === "A") {
      const rx = number();
      const ry = number();
      const rotation = number();
      const large = flag();
      const sweep = flag();
      const x = number();
      const y = number();
      if (
        rx === null ||
        ry === null ||
        rotation === null ||
        large === null ||
        sweep === null ||
        x === null ||
        y === null
      ) {
        break;
      }
      const to = { x: x + ox, y: y + oy };
      out.push(...arcToCubics(pen, rx, ry, rotation, large, sweep, to.x, to.y));
      pen = to;
      cubicControl = quadControl = null;
      continue;
    }

    // A letter that is no command: the rest of the path cannot be trusted.
    break;
  }
  return out;
}

/** An ellipse as four cubics, starting at its rightmost point. */
function ellipse(cx: number, cy: number, rx: number, ry: number): PathCommand[] {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    { type: "M", x: cx + rx, y: cy },
    { type: "C", x1: cx + rx, y1: cy + ky, x2: cx + kx, y2: cy + ry, x: cx, y: cy + ry },
    { type: "C", x1: cx - kx, y1: cy + ry, x2: cx - rx, y2: cy + ky, x: cx - rx, y: cy },
    { type: "C", x1: cx - rx, y1: cy - ky, x2: cx - kx, y2: cy - ry, x: cx, y: cy - ry },
    { type: "C", x1: cx + kx, y1: cy - ry, x2: cx + rx, y2: cy - ky, x: cx + rx, y: cy },
    { type: "Z" },
  ];
}

/** A rectangle, with its corners rounded where it says so. */
function rectangle(
  x: number,
  y: number,
  w: number,
  h: number,
  rxIn: number,
  ryIn: number,
): PathCommand[] {
  const rx = Math.min(Math.max(0, rxIn), w / 2);
  const ry = Math.min(Math.max(0, ryIn), h / 2);
  if (rx === 0 || ry === 0) {
    return [
      { type: "M", x, y },
      { type: "L", x: x + w, y },
      { type: "L", x: x + w, y: y + h },
      { type: "L", x, y: y + h },
      { type: "Z" },
    ];
  }
  const kx = rx * (1 - KAPPA);
  const ky = ry * (1 - KAPPA);
  const r = x + w;
  const b = y + h;
  return [
    { type: "M", x: x + rx, y },
    { type: "L", x: r - rx, y },
    { type: "C", x1: r - kx, y1: y, x2: r, y2: y + ky, x: r, y: y + ry },
    { type: "L", x: r, y: b - ry },
    { type: "C", x1: r, y1: b - ky, x2: r - kx, y2: b, x: r - rx, y: b },
    { type: "L", x: x + rx, y: b },
    { type: "C", x1: x + kx, y1: b, x2: x, y2: b - ky, x, y: b - ry },
    { type: "L", x, y: y + ry },
    { type: "C", x1: x, y1: y + ky, x2: x + kx, y2: y, x: x + rx, y },
    { type: "Z" },
  ];
}

/** Path commands moved by a matrix: a cubic's control points go where its ends do. */
function transformed(commands: readonly PathCommand[], m: Matrix): PathCommand[] {
  return commands.map((c): PathCommand => {
    if (c.type === "Z") return c;
    const to = apply(m, c.x, c.y);
    if (c.type === "M" || c.type === "L") return { type: c.type, ...to };
    const first = apply(m, c.x1, c.y1);
    if (c.type === "Q") return { type: "Q", x1: first.x, y1: first.y, ...to };
    const second = apply(m, c.x2, c.y2);
    return { type: "C", x1: first.x, y1: first.y, x2: second.x, y2: second.y, ...to };
  });
}

/** What a basic shape or a path draws, in its own coordinates, or `null` for anything else. */
function commandsOf(element: XmlElement): PathCommand[] | null {
  const n = (key: string): number => {
    const value = Number.parseFloat(element.attributes[key] ?? "");
    return Number.isFinite(value) ? value : 0;
  };
  switch (localName(element)) {
    case "path":
      return parsePath(element.attributes["d"] ?? "");
    case "rect": {
      // One radius given stands for both.
      const has = (key: string): boolean => element.attributes[key] !== undefined;
      const rx = has("rx") ? n("rx") : n("ry");
      const ry = has("ry") ? n("ry") : n("rx");
      return n("width") > 0 && n("height") > 0
        ? rectangle(n("x"), n("y"), n("width"), n("height"), rx, ry)
        : [];
    }
    case "circle":
      return n("r") > 0 ? ellipse(n("cx"), n("cy"), n("r"), n("r")) : [];
    case "ellipse":
      return n("rx") > 0 && n("ry") > 0 ? ellipse(n("cx"), n("cy"), n("rx"), n("ry")) : [];
    case "line":
      return [
        { type: "M", x: n("x1"), y: n("y1") },
        { type: "L", x: n("x2"), y: n("y2") },
      ];
    case "polyline":
    case "polygon": {
      const points = numbers(element.attributes["points"] ?? "");
      const out: PathCommand[] = [];
      for (let i = 0; i + 1 < points.length; i += 2) {
        out.push({ type: i === 0 ? "M" : "L", x: points[i]!, y: points[i + 1]! });
      }
      if (localName(element) === "polygon" && out.length > 0) out.push({ type: "Z" });
      return out;
    }
    default:
      return null;
  }
}

/** Containers whose children are drawn where they stand. */
const GROUPS = new Set(["svg", "g", "a", "switch"]);

/** What holds definitions rather than drawing, and is passed over without remark. */
const SILENT = new Set(["defs", "style", "title", "desc", "metadata", "symbol", "namedview"]);

/** What a glyph cannot hold, and what is said about each when it is met. */
const REFUSED: Readonly<Record<string, string>> = {
  text: "text, which is not drawn as shapes",
  image: "a picture",
  use: "a shape used by reference",
  foreignObject: "embedded content",
};

/**
 * Read an SVG. `null` where the text is not one at all.
 *
 * A drawing that reads but holds nothing a glyph can use comes back with no
 * shapes and whatever warnings say why, which is a different answer from a
 * file that is not an SVG.
 */
export function parseSvg(source: string): SvgDrawing | null {
  const root = parseXml(source);
  if (root === null || localName(root) !== "svg") return null;

  const rules = classRules(root);
  const shapes: SvgShape[] = [];
  const warnings = new Set<string>();

  const visit = (element: XmlElement, matrix: Matrix, inherited: Paint): void => {
    const name = localName(element);
    if (SILENT.has(name)) return;
    const refused = REFUSED[name];
    if (refused !== undefined) {
      warnings.add(`Left out ${refused}.`);
      return;
    }
    if (name === "clipPath" || name === "mask") return;

    const paint = paintOf(element, inherited, rules);
    if (!paint.shown) return;
    if (element.attributes["clip-path"] !== undefined || element.attributes["mask"] !== undefined) {
      warnings.add("A clip or a mask was not applied: the shapes under it came in whole.");
    }
    const here = compose(matrix, parseTransform(element.attributes["transform"]));

    if (GROUPS.has(name)) {
      for (const child of element.children) if (isElement(child)) visit(child, here, paint);
      return;
    }

    const drawn = commandsOf(element);
    if (drawn === null || drawn.length === 0) return;

    // A line has no inside, whatever its fill says.
    const filled = painted(paint.fill) && name !== "line";
    const stroked = painted(paint.stroke) && paint.strokeWidth > 0;
    if (!filled && !stroked) return;
    if (stroked && (paint.cap !== "round" || paint.join !== "round")) {
      warnings.add("Strokes with square ends or mitred corners came in with round ones.");
    }
    shapes.push({
      commands: transformed(drawn, here),
      filled,
      evenOdd: paint.fillRule === "evenodd",
      stroke: stroked ? { width: paint.strokeWidth * scaleOf(here) } : null,
    });
  };
  visit(root, IDENTITY, ROOT_PAINT);

  return { viewBox: viewBoxOf(root, shapes), shapes, warnings: [...warnings] };
}

/**
 * The box a drawing was made in: its `viewBox`, or its width and height from
 * the origin, or — for a drawing that states neither — the box its shapes fill.
 */
function viewBoxOf(root: XmlElement, shapes: readonly SvgShape[]): SvgBox {
  const said = numbers(root.attributes["viewBox"] ?? "");
  if (said.length >= 4 && said[2]! > 0 && said[3]! > 0) {
    return { x: said[0]!, y: said[1]!, width: said[2]!, height: said[3]! };
  }
  const width = Number.parseFloat(root.attributes["width"] ?? "");
  const height = Number.parseFloat(root.attributes["height"] ?? "");
  if (width > 0 && height > 0) return { x: 0, y: 0, width, height };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    for (const c of shape.commands) {
      if (c.type === "Z") continue;
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x);
      maxY = Math.max(maxY, c.y);
    }
  }
  return maxX > minX && maxY > minY
    ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    : { x: 0, y: 0, width: 1, height: 1 };
}

/** Where a drawing goes in a glyph: how big, and where its top left corner lands. */
export type SvgPlacement = {
  /** Design units to one of the drawing's. */
  readonly scale: number;
  /** Where the left edge of the view box lands. */
  readonly left: number;
  /** Where its top edge lands: the drawing's y runs down from here. */
  readonly top: number;
  /** The advance of a glyph made of this drawing alone. */
  readonly advance: number;
};

/**
 * Where a drawing sits in a font: its view box scaled evenly to run from the
 * descender to the ascender, which is the box a line of text gives a glyph and
 * so where an icon beside text belongs.
 *
 * The advance is the view box's width at that scale — or the font's fixed
 * width, with the drawing centred in it.
 */
export function svgPlacement(drawing: SvgDrawing, document: FontDocument): SvgPlacement {
  const { ascender, descender } = document.info;
  const scale = (ascender - descender) / drawing.viewBox.height;
  const natural = Math.round(drawing.viewBox.width * scale);
  const fixed = fixedWidthOf(document);
  return {
    scale,
    left: fixed === null ? 0 : Math.round((fixed - natural) / 2),
    top: ascender,
    advance: fixed ?? natural,
  };
}

/**
 * The drawing as contours, placed, on whole units.
 *
 * A filled shape's open paths are closed, as a fill closes them. Its contours
 * are then turned so the outermost runs anticlockwise, the way a font's
 * outlines do: by nesting where the shape is filled even-odd, and all together
 * otherwise, so the holes a shape made by running a path backwards stay holes
 * and two shapes that overlap are both ink rather than cancelling.
 *
 * A stroked shape comes in as it was drawn — open where it was open — with a
 * round pen of the stroke's width. A shape both filled and stroked is both.
 */
export function contoursFromSvg(
  drawing: SvgDrawing,
  placement: SvgPlacement,
  ids: IdFactory,
): Contour[] {
  const { scale, left, top } = placement;
  const box = drawing.viewBox;
  const place = (x: number, y: number): { x: number; y: number } => ({
    x: Math.round(left + (x - box.x) * scale),
    y: Math.round(top - (y - box.y) * scale),
  });
  const placed = (commands: readonly PathCommand[]): PathCommand[] =>
    commands.map((c): PathCommand => {
      if (c.type === "Z") return c;
      const to = place(c.x, c.y);
      if (c.type === "M" || c.type === "L") return { type: c.type, ...to };
      const first = place(c.x1, c.y1);
      if (c.type === "Q") return { type: "Q", x1: first.x, y1: first.y, ...to };
      const second = place(c.x2, c.y2);
      return { type: "C", x1: first.x, y1: first.y, x2: second.x, y2: second.y, ...to };
    });
  // Whether a path came back to its start: within a tenth of a unit, since
  // everything is on whole units by now.
  const epsilon = 0.1;

  const out: Contour[] = [];
  for (const shape of drawing.shapes) {
    const commands = placed(shape.commands);

    if (shape.filled) {
      const closed = contoursFromCommands(closing(commands), ids, epsilon).filter(
        (c) => c.nodes.length > 1,
      );
      out.push(...(shape.evenOdd ? correctDirections(closed) : outermostAnticlockwise(closed)));
    }

    if (shape.stroke !== null) {
      const width = Math.max(1, Math.round(shape.stroke.width * scale));
      const nib = { angle: 0, width, thickness: width };
      for (const c of contoursFromCommands(commands, ids, epsilon)) {
        if (c.nodes.length > 1) out.push(withNib(c, nib));
      }
    }
  }
  return out;
}

/** The same commands with every subpath closed, which is what filling one does. */
function closing(commands: readonly PathCommand[]): PathCommand[] {
  const out: PathCommand[] = [];
  let open = false;
  for (const c of commands) {
    if (c.type === "M" && open) out.push({ type: "Z" });
    out.push(c);
    open = c.type !== "Z";
  }
  if (open) out.push({ type: "Z" });
  return out;
}

/**
 * A shape's contours, all turned over together if its largest runs clockwise.
 *
 * Together, so the holes it cut by running a path the other way are still
 * holes. The largest stands for the outermost: an outline's outer edge encloses
 * the rest of it.
 */
function outermostAnticlockwise(contours: readonly Contour[]): readonly Contour[] {
  let largest = 0;
  for (const c of contours) {
    const winding = contourWinding(c);
    if (Math.abs(winding) > Math.abs(largest)) largest = winding;
  }
  return largest < 0 ? contours.map(reverseContour) : contours;
}

/** One SVG file: what it is called and what it says. */
export type SvgFile = { readonly name: string; readonly text: string };

/** What came of a set of SVG files. */
export type SvgGlyphs = {
  /** The glyphs made, in the order of the files, each with a private-use code point. */
  readonly glyphs: readonly Glyph[];
  /**
   * Icons the font already had, redrawn: each as it is to be now, with the
   * drawing and the width from its file and everything else as it was.
   */
  readonly replaced: readonly Glyph[];
  /** Files left out, and why: not an SVG, nothing to draw, the name of a glyph that is no icon. */
  readonly skipped: readonly { readonly file: string; readonly why: string }[];
  /** What was changed or left out inside the files that did come in, by glyph. */
  readonly warnings: readonly { readonly glyph: string; readonly message: string }[];
};

/**
 * A set of SVG files as glyphs for this font: an icon set coming in.
 *
 * Each file is one glyph, named for the file and given the next private-use
 * code point nothing in the font has, since an icon is a character Unicode has
 * no code point for.
 *
 * A set is brought in more than once: it is redrawn, and the font follows. So
 * a file named for an icon the font has — a glyph with a private-use code
 * point — redraws it: the drawing and the width are the file's, and the code
 * point, the name, the anchors, the guides and the mark stay, since those are
 * what a web page and a designer know the icon by. A file named for any other
 * glyph is left out. `a.svg` must never draw over the letter `a`, and a second
 * `home` under another name would be an icon nobody can find.
 */
export function glyphsFromSvgs(
  files: readonly SvgFile[],
  document: FontDocument,
  ids: IdFactory,
): SvgGlyphs {
  const taken = new Set(Object.keys(document.glyphs));
  const used: number[] = [];
  for (const g of Object.values(document.glyphs)) used.push(...g.unicodes);
  const codes = freePrivateUse(used, files.length);

  const glyphs: Glyph[] = [];
  const replaced: Glyph[] = [];
  const redrawn = new Set<string>();
  const skipped: { file: string; why: string }[] = [];
  const warnings: { glyph: string; message: string }[] = [];

  for (const file of files) {
    const name = glyphNameFromText(file.name.replace(/\.svg$/i, ""));
    if (name === null) {
      skipped.push({ file: file.name, why: "its name has nothing a glyph can be called" });
      continue;
    }
    const existing = document.glyphs[name];
    if (redrawn.has(name) || (existing === undefined && taken.has(name))) {
      skipped.push({ file: file.name, why: `another file in this set is already ${name}` });
      continue;
    }
    if (existing !== undefined && !isIcon(existing)) {
      skipped.push({
        file: file.name,
        why: `the font already has ${name}, which is not an icon`,
      });
      continue;
    }
    const drawing = parseSvg(file.text);
    if (drawing === null) {
      skipped.push({ file: file.name, why: "it is not an SVG" });
      continue;
    }
    const placement = svgPlacement(drawing, document);
    const contours = contoursFromSvg(drawing, placement, ids);
    if (contours.length === 0) {
      skipped.push({ file: file.name, why: "it has no shapes a glyph can hold" });
      continue;
    }
    for (const message of drawing.warnings) warnings.push({ glyph: name, message });
    if (existing !== undefined) {
      redrawn.add(name);
      replaced.push({ ...existing, advance: placement.advance, contours, components: [] });
      continue;
    }
    const code = codes[glyphs.length];
    taken.add(name);
    glyphs.push(
      glyph(name, {
        advance: placement.advance,
        contours,
        unicodes: code === undefined ? [] : [code],
      }),
    );
  }
  return { glyphs, replaced, skipped, warnings };
}

/** Whether a glyph is an icon: one with a private-use code point. */
function isIcon(g: Glyph): boolean {
  return g.unicodes.some((code) => code >= PRIVATE_USE_FIRST && code <= PRIVATE_USE_LAST);
}
