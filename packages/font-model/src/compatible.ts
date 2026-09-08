import { contourWinding } from "./direction.js";
import type { FontDocument, GlyphName } from "./document.js";
import type { Glyph } from "./glyph.js";
import type { Contour } from "./contour.js";

/**
 * Whether two drawings of a glyph can be worked out in between.
 *
 * Interpolation is arithmetic on corresponding points: the first point of the
 * first contour of one master is averaged with the first point of the first
 * contour of the other, and so on to the end. Nothing anywhere checks that the
 * two lists describe the same shape, so a glyph with an extra point in the bold
 * does not fail — it produces a letter with a spike in it at every weight
 * between, and the first anybody knows of it is a proof.
 *
 * Which is why this exists and why it is worth being fussy. Every rule here is
 * something that silently ruins an instance rather than something that stops a
 * build.
 */

/** What is different about a glyph between two masters. */
export type Incompatibility = {
  readonly glyph: GlyphName;
  /** What differs, in a word, so a list can be grouped. */
  readonly kind:
    "missing" | "contours" | "points" | "closed" | "handles" | "direction" | "components";
  /** Said to somebody who has to go and fix it. */
  readonly says: string;
  /** Which contour it is about, where it is about one. */
  readonly contour: number | null;
};

/**
 * Compare one glyph in two masters.
 *
 * The first difference per contour rather than every difference: a contour with
 * two points where the other has nine differs in every particular, and nine
 * lines saying so is one fact told nine times.
 */
export function glyphIncompatibilities(
  name: GlyphName,
  one: Glyph | null,
  two: Glyph | null,
): Incompatibility[] {
  if (one === null || two === null) {
    // A glyph in one master and not the other cannot interpolate at all, and
    // the instance simply will not have it.
    return one === two
      ? []
      : [
          {
            glyph: name,
            kind: "missing",
            says: "It is only in one of the masters.",
            contour: null,
          },
        ];
  }

  const out: Incompatibility[] = [];

  if (one.contours.length !== two.contours.length) {
    out.push({
      glyph: name,
      kind: "contours",
      says: `One master has ${count(one.contours.length, "contour")} and the other ${String(two.contours.length)}.`,
      contour: null,
    });
    // Nothing below this can be compared meaningfully once the shapes disagree
    // about how many pieces they are in.
    return [...out, ...componentIncompatibilities(name, one, two)];
  }

  for (const [i, a] of one.contours.entries()) {
    const b = two.contours[i];
    if (b === undefined) continue;

    const found = contourIncompatibility(name, i, a, b);
    if (found !== null) out.push(found);
  }

  return [...out, ...componentIncompatibilities(name, one, two)];
}

/** The first thing that differs about a pair of contours, or `null`. */
function contourIncompatibility(
  glyph: GlyphName,
  index: number,
  one: Contour,
  two: Contour,
): Incompatibility | null {
  const at = (says: string, kind: Incompatibility["kind"]): Incompatibility => ({
    glyph,
    kind,
    says,
    contour: index,
  });

  if (one.nodes.length !== two.nodes.length) {
    return at(
      `Contour ${String(index + 1)} has ${count(one.nodes.length, "point")} in one master and ${String(two.nodes.length)} in the other.`,
      "points",
    );
  }

  if (one.closed !== two.closed) {
    return at(
      `Contour ${String(index + 1)} is closed in one master and open in the other.`,
      "closed",
    );
  }

  // Which handles are there, point by point. A segment that is a line in one
  // master and a curve in the other has no sensible middle: the curve's
  // controls interpolate from a point on the line, and the shape swells out of
  // the straight edge on the way.
  for (const [i, a] of one.nodes.entries()) {
    const b = two.nodes[i];
    if (b === undefined) continue;
    if ((a.in === null) !== (b.in === null) || (a.out === null) !== (b.out === null)) {
      return at(
        `Point ${String(i + 1)} of contour ${String(index + 1)} has handles in one master and not the other.`,
        "handles",
      );
    }
  }

  // Which way round they run. Two contours that agree in every other particular
  // and run opposite ways turn inside out on the way between, which is the
  // strangest-looking of all of these and the hardest to see the cause of.
  if (one.closed && two.closed) {
    const a = contourWinding(one);
    const b = contourWinding(two);
    if (a !== 0 && b !== 0 && Math.sign(a) !== Math.sign(b)) {
      return at(
        `Contour ${String(index + 1)} runs the other way round in one master.`,
        "direction",
      );
    }
  }

  return null;
}

/**
 * The glyphs placed inside, which have to be the same ones in the same order.
 *
 * A component interpolates as a placement — the same glyph, moved — so a
 * different glyph in the same position is not a shape being worked out but two
 * unrelated letters being averaged.
 */
function componentIncompatibilities(glyph: GlyphName, one: Glyph, two: Glyph): Incompatibility[] {
  if (one.components.length !== two.components.length) {
    return [
      {
        glyph,
        kind: "components",
        says: `One master places ${count(one.components.length, "component")} and the other ${String(two.components.length)}.`,
        contour: null,
      },
    ];
  }

  for (const [i, a] of one.components.entries()) {
    const b = two.components[i];
    if (b === undefined || a.base === b.base) continue;
    return [
      {
        glyph,
        kind: "components",
        says: `Component ${String(i + 1)} is ${a.base} in one master and ${b.base} in the other.`,
        contour: null,
      },
    ];
  }

  return [];
}

/**
 * Every glyph that differs between two whole masters.
 *
 * In the order the font is in, because that is the order somebody walks it.
 * Glyphs are compared by name: a glyph that has been renamed in one master and
 * not the other reads as two glyphs each missing from the other, which is
 * exactly what has happened.
 */
export function incompatibilities(one: FontDocument, two: FontDocument): Incompatibility[] {
  const names = [...one.glyphOrder];
  for (const name of two.glyphOrder) if (!names.includes(name)) names.push(name);

  const out: Incompatibility[] = [];
  for (const name of names) {
    out.push(...glyphIncompatibilities(name, one.glyphs[name] ?? null, two.glyphs[name] ?? null));
  }
  return out;
}

/** Whether one glyph can be interpolated between two masters. */
export function glyphCompatible(name: GlyphName, one: Glyph | null, two: Glyph | null): boolean {
  return glyphIncompatibilities(name, one, two).length === 0;
}

const count = (n: number, thing: string): string => `${String(n)} ${thing}${n === 1 ? "" : "s"}`;
