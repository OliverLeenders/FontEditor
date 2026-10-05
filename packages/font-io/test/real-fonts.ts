import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Contour } from "@typewright/font-model";
import { Buffer, Feature, type Font, Variation, shape } from "harfbuzzjs";

import type { ZipFile } from "../src/unzip.js";

/**
 * The real fonts the tests are run on, and what is asked of each: see
 * `fixtures/fonts/README.md` for what they are and where they came from.
 */

const ROOT = fileURLToPath(new URL("../../../fixtures/fonts/", import.meta.url));

/** A font file of the corpus, as the bytes a browser would hand over. */
export function fontBytes(path: string): ArrayBuffer {
  const bytes = readFileSync(join(ROOT, path));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Every file under a folder of the corpus, as an archive of it would hold them. */
export function filesUnder(folder: string, prefix = ""): ZipFile[] {
  const out: ZipFile[] = [];
  for (const name of readdirSync(join(ROOT, folder, prefix))) {
    const path = prefix === "" ? name : `${prefix}/${name}`;
    if (statSync(join(ROOT, folder, path)).isDirectory()) out.push(...filesUnder(folder, path));
    else out.push({ path, bytes: new Uint8Array(readFileSync(join(ROOT, folder, path))) });
  }
  return out;
}

/** One glyph as HarfBuzz set it: which, how far it advances, and where it was moved to. */
export type Placed = {
  readonly name: string;
  readonly advance: number;
  readonly x: number;
  readonly y: number;
};

/** Text as HarfBuzz sets it in a font, with these features on and at this place in its designspace. */
export function set(
  font: Font,
  text: string,
  features: readonly string[] = [],
  at: Readonly<Record<string, number>> | null = null,
): Placed[] {
  if (at !== null) {
    font.setVariations(Object.entries(at).map(([tag, value]) => new Variation(tag, value)));
  }
  const buffer = new Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  shape(
    font,
    buffer,
    features.map((f) => Feature.fromString(f)!),
  );
  return buffer.getGlyphInfosAndPositions().map((p) => ({
    name: font.glyphName(p.codepoint),
    advance: p.xAdvance ?? 0,
    x: p.xOffset ?? 0,
    y: p.yOffset ?? 0,
  }));
}

/** Whether two settings of a line are the same glyphs in the same places, to a unit. */
export function sameSetting(a: readonly Placed[], b: readonly Placed[]): boolean {
  return (
    a.length === b.length &&
    a.every((g, i) => {
      const h = b[i]!;
      return (
        g.name === h.name &&
        Math.abs(g.advance - h.advance) <= 1 &&
        Math.abs(g.x - h.x) <= 1 &&
        Math.abs(g.y - h.y) <= 1
      );
    })
  );
}

/** A setting in a line, for saying what was expected and what came. */
export const said = (a: readonly Placed[]): string =>
  a.map((g) => `${g.name}+${String(g.advance)}@${String(g.x)},${String(g.y)}`).join(" ");

/**
 * The texts of a list that two fonts set differently, each with both settings:
 * empty where the second font is the first as far as these go.
 */
export function setDifferently(
  before: Font,
  after: Font,
  texts: readonly string[],
  features: readonly string[] = [],
): string[] {
  const out: string[] = [];
  for (const text of texts) {
    const a = set(before, text, features);
    const b = set(after, text, features);
    if (sameSetting(a, b)) continue;
    const codes = [...text].map((c) => c.codePointAt(0)!.toString(16)).join(" ");
    out.push(`[${codes}] ${said(a)}  IS  ${said(b)}`);
  }
  return out;
}

type Point = { readonly x: number; readonly y: number };

/** A closed contour as a polygon, each curve in sixteen straight pieces. */
function polygonOf(c: Contour): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < c.nodes.length; i++) {
    const from = c.nodes[i]!;
    const to = c.nodes[(i + 1) % c.nodes.length]!;
    if (from.out === null && to.in === null) {
      out.push(from.pt);
      continue;
    }
    const c1 = from.out ?? from.pt;
    const c2 = to.in ?? to.pt;
    for (let k = 0; k < 16; k++) {
      const t = k / 16;
      const m = 1 - t;
      out.push({
        x:
          m * m * m * from.pt.x + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t * t * t * to.pt.x,
        y:
          m * m * m * from.pt.y + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t * t * t * to.pt.y,
      });
    }
  }
  return out;
}

function inked(polygons: readonly (readonly Point[])[], x: number, y: number): boolean {
  let winding = 0;
  for (const poly of polygons) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const side = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y);
      if (a.y <= y) {
        if (b.y > y && side > 0) winding += 1;
      } else if (b.y <= y && side < 0) winding -= 1;
    }
  }
  return winding !== 0;
}

/**
 * How much of one drawing's ink another does not share, as a part of it: none
 * where the two are one shape, and one where they have nothing in common.
 *
 * By the non-zero rule, at a grid of places across both. Of area, which is
 * what a reader sees: an outline moved half a unit onto a font file's grid is
 * a different outline and the same letter.
 */
export function inkApart(a: readonly Contour[], b: readonly Contour[]): number {
  const one = a.filter((c) => c.closed).map(polygonOf);
  const other = b.filter((c) => c.closed).map(polygonOf);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of [...one, ...other]) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!(maxX > minX) || !(maxY > minY)) return one.length === other.length ? 0 : 1;

  const STEPS = 60;
  let ink = 0;
  let differ = 0;
  for (let i = 0; i < STEPS; i++) {
    for (let j = 0; j < STEPS; j++) {
      // Off the grid a font is drawn on, so that no place asked about is on an edge.
      const x = minX + ((i + 0.37) / STEPS) * (maxX - minX);
      const y = minY + ((j + 0.61) / STEPS) * (maxY - minY);
      const first = inked(one, x, y);
      const second = inked(other, x, y);
      if (first || second) ink += 1;
      if (first !== second) differ += 1;
    }
  }
  return ink === 0 ? 0 : differ / ink;
}
