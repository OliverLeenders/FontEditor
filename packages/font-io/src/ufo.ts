import {
  type Component,
  type Contour,
  type FontDocument,
  type Glyph,
  type PlainValue,
  glyphFileName,
  groupNameOf,
  isGroupKey,
  segments,
} from "@fonteditor/font-model";

import { type ZipEntry, zip } from "./zip.js";

/**
 * Writing a UFO.
 *
 * The interchange format the type world actually uses: a directory of XML, one
 * file per glyph, readable and diffable. Unlike the OTF exporter this loses
 * nothing the editor models — cubic curves, point types, glyph names, the
 * character map and the metrics all have a place in the format, so a round trip
 * through another tool comes back intact.
 *
 * Delivered as a zip because a browser cannot hand over a directory. Unzipping
 * gives an ordinary `.ufo` folder.
 */

const CREATOR = "com.fonteditor.tunni";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Coordinates are integers in a UFO, as they are in the compiled font. */
const round = (n: number): number => Math.round(n);

function plist(body: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    body,
    "</plist>",
    "",
  ].join("\n");
}

function dict(pairs: ReadonlyArray<readonly [string, string]>): string {
  const lines = ["<dict>"];
  for (const [key, value] of pairs) {
    lines.push(`\t<key>${escapeXml(key)}</key>`);
    lines.push(`\t${value}`);
  }
  lines.push("</dict>");
  return lines.join("\n");
}

const str = (value: string): string => `<string>${escapeXml(value)}</string>`;

function array(items: readonly string[]): string {
  return ["<array>", ...items.map((i) => `\t${i}`), "</array>"].join("\n");
}

/**
 * A pair's side, in the name UFO uses.
 *
 * Groups are marked by a prefix in the model and by a *namespaced name* in the
 * file, and the namespace carries the side — so the conversion is not just a
 * different sigil, it is where the side stops being structural and becomes part
 * of the name.
 */
function ufoSide(key: string, side: "first" | "second"): string {
  if (!isGroupKey(key)) return key;
  return `public.kern${side === "first" ? "1" : "2"}.${groupNameOf(key)}`;
}
const int = (value: number): string => `<integer>${String(round(value))}</integer>`;

// ---------------------------------------------------------------------------
// glif
// ---------------------------------------------------------------------------

type Point = {
  readonly x: number;
  readonly y: number;
  /** Absent for an off-curve control point. */
  readonly type?: "move" | "line" | "curve";
  readonly smooth?: boolean;
};

/**
 * A contour as UFO writes it: one flat, cyclic list of points.
 *
 * The shape of the list is the whole subtlety. An on-curve point carries the
 * type of the segment *arriving* at it, and the off-curve points of that segment
 * come immediately before it. The list wraps, so the control points of the
 * closing segment sit at the end and pair with the first point — which is why
 * the first point is emitted with the closing segment's type rather than its
 * own, and why the loop below stops one short and then emits the tail.
 *
 * A curve always writes *both* its control points, putting the missing one of a
 * half-handled segment on its own anchor. That is what the segment already means
 * — `segmentCubic` reads an absent handle as a control at the anchor — and
 * writing it out is the only unambiguous way to say so. UFO does permit a curve
 * with a single off-curve point, but readers do not agree on what one means:
 * fontTools takes a two-point curve as a quadratic, which is a different curve
 * from a cubic whose first control sits on the start anchor. Writing both leaves
 * nothing to interpret. Reading them back is `parseGlif`'s side of the bargain:
 * a control that coincides with its anchor is the absence of a handle.
 */
export function contourPoints(c: Contour): Point[] {
  const all = segments(c);
  const points: Point[] = [];

  const first = c.nodes[0];
  if (first === undefined) return points;

  const smooth = (index: number): boolean => c.nodes[index]?.type === "smooth";

  if (c.closed) {
    const closing = all[all.length - 1];
    points.push({
      x: round(first.pt.x),
      y: round(first.pt.y),
      type: closing?.kind === "curve" ? "curve" : "line",
      smooth: smooth(0),
    });
  } else {
    // An open contour starts with a `move`, which is what makes it open.
    points.push({ x: round(first.pt.x), y: round(first.pt.y), type: "move", smooth: smooth(0) });
  }

  const upTo = c.closed ? all.length - 1 : all.length;
  for (let i = 0; i < upTo; i++) {
    const segment = all[i]!;
    // A segment is a curve when *either* handle is set, which is the model's own
    // definition of one. Asking for both here is what used to write a
    // half-handled curve out as a straight line.
    const curve = segment.kind === "curve";
    if (curve) {
      const out = segment.out ?? segment.a;
      const incoming = segment.in ?? segment.b;
      points.push({ x: round(out.x), y: round(out.y) });
      points.push({ x: round(incoming.x), y: round(incoming.y) });
    }
    points.push({
      x: round(segment.b.x),
      y: round(segment.b.y),
      type: curve ? "curve" : "line",
      smooth: smooth(i + 1),
    });
  }

  if (c.closed) {
    const closing = all[all.length - 1];
    if (closing !== undefined && closing.kind === "curve") {
      // The first point was already written with this segment's type, so its
      // controls have to follow whenever that type is `curve` — otherwise the
      // file claims a curve and gives it nothing to curve through.
      const out = closing.out ?? closing.a;
      const incoming = closing.in ?? closing.b;
      points.push({ x: round(out.x), y: round(out.y) });
      points.push({ x: round(incoming.x), y: round(incoming.y) });
    }
  }

  return points;
}

/**
 * The transform attributes a component needs, and no more.
 *
 * UFO defaults every one of them, so a component that merely sits somewhere
 * writes two numbers rather than six — which is the common case by a wide
 * margin, and makes the file far easier to read.
 */
function componentAttributes(c: Component): string {
  const t = c.transform;
  const parts: string[] = [];
  const put = (name: string, value: number, fallback: number): void => {
    if (value !== fallback) parts.push(` ${name}="${String(value)}"`);
  };

  put("xScale", t.xScale, 1);
  put("xyScale", t.xyScale, 0);
  put("yxScale", t.yxScale, 0);
  put("yScale", t.yScale, 1);
  put("xOffset", round(t.xOffset), 0);
  put("yOffset", round(t.yOffset), 0);
  return parts.join("");
}

export function glif(g: Glyph): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<glyph name="${escapeXml(g.name)}" format="2">`,
    `\t<advance width="${String(round(g.advance))}"/>`,
  ];

  for (const code of g.unicodes) {
    lines.push(`\t<unicode hex="${code.toString(16).toUpperCase().padStart(4, "0")}"/>`);
  }

  const drawable = g.contours.filter((c) => c.nodes.length >= 2);
  if (drawable.length === 0 && g.components.length === 0) {
    lines.push("\t<outline/>");
  } else {
    lines.push("\t<outline>");
    for (const c of drawable) {
      lines.push("\t\t<contour>");
      for (const p of contourPoints(c)) {
        const type = p.type === undefined ? "" : ` type="${p.type}"`;
        const smooth = p.smooth === true && p.type !== undefined ? ' smooth="yes"' : "";
        lines.push(`\t\t\t<point x="${String(p.x)}" y="${String(p.y)}"${type}${smooth}/>`);
      }
      lines.push("\t\t</contour>");
    }
    // References, not outlines. This is the whole reason to export a UFO as
    // well as an OTF: the OTF has to flatten these, and this does not.
    for (const c of g.components) {
      lines.push(`\t\t<component base="${escapeXml(c.base)}"${componentAttributes(c)}/>`);
    }
    lines.push("\t</outline>");
  }

  // After the outline, which is where format 2 puts them and where every reader
  // looks. An anchor with no name is not written: the name is the whole of what
  // an anchor is for, and a nameless one would attach nothing to nothing.
  for (const a of g.anchors) {
    if (a.name === "") continue;
    lines.push(
      `\t<anchor name="${escapeXml(a.name)}" x="${String(round(a.pt.x))}" y="${String(round(a.pt.y))}"/>`,
    );
  }

  // Last, and unread: guidelines, a note, an image, a lib — whatever this glyph
  // was read carrying that the model has no field for. Written back exactly as
  // it arrived, because saving a font must not take things out of it.
  for (const element of g.kept) lines.push(element);

  lines.push("</glyph>", "");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// the package
// ---------------------------------------------------------------------------

/**
 * Every file a UFO contains, as a path-to-text map.
 *
 * Separated from the zipping so the structure can be asserted on directly. What
 * goes wrong in a format like this is a missing index or a filename that
 * disagrees with `contents.plist`, and neither is visible through a zip.
 */

/**
 * Every key of `fontinfo.plist`, in the order a reader expects to find them.
 *
 * The modelled ones first, then whatever the font arrived carrying that this
 * editor has no field for. A key the model has always wins: if a font came in
 * with an `openTypeOS2WeightClass` and somebody has since changed the weight,
 * what they changed it to is the answer, not what the file used to say.
 *
 * Empty strings are left out. UFO's own convention is that an absent key means
 * "not stated", and writing `<string></string>` for every name the designer has
 * not filled in says something different — it says they stated nothing on
 * purpose, and some tools will show it.
 */
function fontInfoPairs(document: FontDocument): Array<readonly [string, string]> {
  const { info } = document;
  const pairs: Array<readonly [string, string]> = [];

  const text = (key: string, value: string): void => {
    if (value !== "") pairs.push([key, str(value)]);
  };
  const number = (key: string, value: number): void => {
    pairs.push([key, int(value)]);
  };

  text("familyName", info.familyName);
  text("styleName", info.styleName);
  number("unitsPerEm", info.unitsPerEm);
  number("ascender", info.ascender);
  number("descender", -Math.abs(info.descender));
  number("xHeight", info.xHeight);
  number("capHeight", info.capHeight);

  number("versionMajor", info.versionMajor);
  number("versionMinor", info.versionMinor);
  if (info.italicAngle !== 0) pairs.push(["italicAngle", real(info.italicAngle)]);

  text("copyright", info.copyright);
  text("trademark", info.trademark);

  text("openTypeNameDesigner", info.openTypeNameDesigner);
  text("openTypeNameDesignerURL", info.openTypeNameDesignerURL);
  text("openTypeNameManufacturer", info.openTypeNameManufacturer);
  text("openTypeNameManufacturerURL", info.openTypeNameManufacturerURL);
  text("openTypeNameLicense", info.openTypeNameLicense);
  text("openTypeNameLicenseURL", info.openTypeNameLicenseURL);
  text("openTypeNameDescription", info.openTypeNameDescription);

  text("openTypeOS2VendorID", info.openTypeOS2VendorID);
  number("openTypeOS2WeightClass", info.openTypeOS2WeightClass);
  number("openTypeOS2WidthClass", info.openTypeOS2WidthClass);

  text("openTypeNamePreferredFamilyName", info.openTypeNamePreferredFamilyName);
  text("openTypeNamePreferredSubfamilyName", info.openTypeNamePreferredSubfamilyName);

  text("styleMapFamilyName", info.styleMapFamilyName);
  pairs.push(["styleMapStyleName", str(info.styleMapStyleName)]);

  const mine = new Set(pairs.map(([key]) => key));
  for (const [key, value] of Object.entries(document.kept.fontInfo)) {
    if (mine.has(key)) continue;
    const written = plistValue(value);
    if (written !== null) pairs.push([key, written]);
  }

  return pairs;
}

/**
 * A value of any shape a plist can hold, written back out.
 *
 * For what was kept rather than modelled, so it has to write whatever it is
 * handed rather than a known field. `null` for what a plist cannot express —
 * which, since these values came out of a plist, means only the values our own
 * reader gave up on and stored as null.
 */
function plistValue(value: PlainValue): string | null {
  if (typeof value === "string") return str(value);
  if (typeof value === "boolean") return value ? "<true/>" : "<false/>";
  if (typeof value === "number") return Number.isInteger(value) ? int(value) : real(value);
  if (Array.isArray(value)) {
    const items = value.map(plistValue).filter((v): v is string => v !== null);
    return array(items);
  }
  if (value !== null && typeof value === "object") {
    const pairs: Array<readonly [string, string]> = [];
    for (const [key, inner] of Object.entries(value as Record<string, PlainValue>)) {
      const written = plistValue(inner);
      if (written !== null) pairs.push([key, written]);
    }
    return dict(pairs);
  }
  return null;
}

/** A number that is not a whole one. Plists distinguish the two. */
function real(value: number): string {
  return `<real>${String(value)}</real>`;
}

export function ufoFiles(document: FontDocument): ZipEntry[] {
  const entries: ZipEntry[] = [
    {
      path: "metainfo.plist",
      text: plist(
        dict([
          ["creator", str(CREATOR)],
          ["formatVersion", int(3)],
        ]),
      ),
    },
    {
      path: "layercontents.plist",
      text: plist(
        [
          "<array>",
          "\t<array>",
          `\t\t${str("public.default")}`,
          `\t\t${str("glyphs")}`,
          "\t</array>",
          "</array>",
        ].join("\n"),
      ),
    },
  ];

  entries.push({ path: "fontinfo.plist", text: plist(dict(fontInfoPairs(document))) });

  // One filename per glyph, and the same rule the working store uses — which is
  // UFO's own, because that is where it was borrowed from.
  const taken = new Set<string>();
  const contents: Array<readonly [string, string]> = [];

  for (const name of document.glyphOrder) {
    const g = document.glyphs[name];
    if (g === undefined) continue;

    let file = glyphFileName(g.name, ".glif");
    // The mangling is thorough but not injective at the length limit; a suffix
    // keeps two glyphs from sharing a file, which would silently lose one.
    let n = 2;
    while (taken.has(file.toLowerCase())) {
      file = glyphFileName(`${g.name}.${String(n)}`, ".glif");
      n++;
    }
    taken.add(file.toLowerCase());

    contents.push([g.name, file]);
    entries.push({ path: `glyphs/${file}`, text: glif(g) });
  }

  // Kerning, in UFO's own arrangement: groups in one file with the side written
  // into the name, values in another that refers to them by that name.
  const { kerning } = document;
  const groupEntries: Array<readonly [string, string]> = [];
  for (const [name, glyphs] of Object.entries(kerning.firstGroups)) {
    groupEntries.push([`public.kern1.${name}`, array(glyphs.map(str))]);
  }
  for (const [name, glyphs] of Object.entries(kerning.secondGroups)) {
    groupEntries.push([`public.kern2.${name}`, array(glyphs.map(str))]);
  }
  if (groupEntries.length > 0) {
    entries.push({ path: "groups.plist", text: plist(dict(groupEntries)) });
  }

  const kernRows: Array<readonly [string, string]> = [];
  for (const [first, row] of Object.entries(kerning.pairs)) {
    const seconds = Object.entries(row).map(
      ([second, value]) => [ufoSide(second, "second"), int(value)] as const,
    );
    if (seconds.length > 0) kernRows.push([ufoSide(first, "first"), dict(seconds)]);
  }
  if (kernRows.length > 0) {
    entries.push({ path: "kerning.plist", text: plist(dict(kernRows)) });
  }

  // Written as its own file, which is where the format keeps it and where every
  // other tool looks. Omitted when empty rather than written blank.
  if (document.features.trim() !== "") {
    entries.push({ path: "features.fea", text: document.features });
  }

  entries.push({
    path: "glyphs/contents.plist",
    text: plist(dict(contents.map(([name, file]) => [name, str(file)] as const))),
  });

  // The order the glyphs are in. `contents.plist` is a dictionary, and a
  // dictionary has no order the format promises to keep — so a reader that took
  // its order from there would be reading ours by luck. `public.glyphOrder` is
  // where the format actually writes it down, and where every other tool looks.
  const lib: Array<readonly [string, string]> = [];
  if (contents.length > 0) {
    lib.push(["public.glyphOrder", array(contents.map(([name]) => str(name)))]);
  }
  // Everything else somebody put in the lib, back where they put it. A lib is
  // where every tool keeps what the format has no field for, so it is the one
  // file where writing only what we understand does the most damage.
  for (const [key, value] of Object.entries(document.kept.lib)) {
    if (key === "public.glyphOrder") continue;
    const written = plistValue(value);
    if (written !== null) lib.push([key, written]);
  }
  if (lib.length > 0) entries.push({ path: "lib.plist", text: plist(dict(lib)) });

  return entries;
}

export type UfoExport = {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly files: number;
};

export function exportUfo(document: FontDocument): UfoExport {
  const clean = (s: string): string => s.replace(/[^A-Za-z0-9]/g, "");
  const family = clean(document.info.familyName) || "Untitled";
  const style = clean(document.info.styleName) || "Regular";
  const root = `${family}-${style}.ufo`;

  // Everything sits inside a folder named for the font, so unzipping produces a
  // `.ufo` directory rather than scattering plists into wherever you unzipped.
  const files = ufoFiles(document).map((entry) => ({
    path: `${root}/${entry.path}`,
    text: entry.text,
  }));

  return { bytes: zip(files), fileName: `${root}.zip`, files: files.length };
}
