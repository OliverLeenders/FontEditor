import {
  type Contour,
  type FontDocument,
  type Glyph,
  glyphFileName,
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
    const curve = segment.kind === "curve" && segment.out !== null && segment.in !== null;
    if (curve) {
      points.push({ x: round(segment.out!.x), y: round(segment.out!.y) });
      points.push({ x: round(segment.in!.x), y: round(segment.in!.y) });
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
    if (closing !== undefined && closing.kind === "curve" && closing.out !== null && closing.in !== null) {
      points.push({ x: round(closing.out.x), y: round(closing.out.y) });
      points.push({ x: round(closing.in.x), y: round(closing.in.y) });
    }
  }

  return points;
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
  if (drawable.length === 0) {
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
    lines.push("\t</outline>");
  }

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
export function ufoFiles(document: FontDocument): ZipEntry[] {
  const entries: ZipEntry[] = [
    {
      path: "metainfo.plist",
      text: plist(dict([["creator", str(CREATOR)], ["formatVersion", int(3)]])),
    },
    {
      path: "layercontents.plist",
      text: plist(
        ["<array>", "\t<array>", `\t\t${str("public.default")}`, `\t\t${str("glyphs")}`, "\t</array>", "</array>"].join("\n"),
      ),
    },
  ];

  const { info } = document;
  entries.push({
    path: "fontinfo.plist",
    text: plist(
      dict([
        ["familyName", str(info.familyName)],
        ["styleName", str(info.styleName)],
        ["unitsPerEm", int(info.unitsPerEm)],
        ["ascender", int(info.ascender)],
        ["descender", int(-Math.abs(info.descender))],
        ["xHeight", int(info.xHeight)],
        ["capHeight", int(info.capHeight)],
      ]),
    ),
  });

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

  entries.push({
    path: "glyphs/contents.plist",
    text: plist(dict(contents.map(([name, file]) => [name, str(file)] as const))),
  });

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
