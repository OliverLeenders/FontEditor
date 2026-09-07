import type { ComponentSource, Contour, FontDocument, Glyph, Node } from "@fonteditor/font-model";
import { isMarkAnchor, wouldRecurse } from "@fonteditor/font-model";

import { type Finding, finding } from "./finding.js";

/**
 * What can be found by looking at one glyph.
 *
 * Everything here needs the glyph and, at most, the names of the others — so
 * the checks stay cheap and can be run on the glyph being drawn as readily as
 * on the whole font.
 */

/** How close two points have to be to count as the same one, in units. */
const SAME_PLACE = 1e-6;

export function glyphFindings(document: FontDocument, g: Glyph): Finding[] {
  return [
    ...nameFindings(g),
    ...advanceFindings(g),
    ...contourFindings(g),
    ...componentFindings(document, g),
    ...anchorFindings(g),
  ];
}

/**
 * Whether a compiled font can carry the name.
 *
 * The rule is the format's, not this editor's: up to 63 characters of `A-Z`,
 * `a-z`, `0-9`, full stop and underscore, not starting with a digit, and only
 * starting with a full stop for the handful of names that are spelt that way.
 * A name outside it is refused at compile time — long after the point where it
 * could have been renamed without disturbing anything.
 */
function nameFindings(g: Glyph): Finding[] {
  const out: Finding[] = [];
  const name = g.name;

  if (name === "") {
    out.push(finding("glyph-name", name, "A glyph with no name."));
    return out;
  }

  const illegal = [...name].filter((c) => !/[A-Za-z0-9._]/.test(c));
  if (illegal.length > 0) {
    const shown = [...new Set(illegal)].join(" ");
    out.push(finding("glyph-name", name, `The name has characters a font cannot carry: ${shown}`));
  }
  if (/^[0-9]/.test(name)) {
    out.push(finding("glyph-name", name, "The name starts with a digit, which a font may not."));
  }
  if (name.startsWith(".") && name !== ".notdef" && name !== ".null") {
    out.push(
      finding(
        "glyph-name",
        name,
        `Only .notdef and .null may start with a full stop, not ${name}.`,
      ),
    );
  }
  if (name.length > 63) {
    out.push(
      finding("glyph-name", name, `The name is ${String(name.length)} characters; 63 is the most.`),
    );
  }

  return out;
}

function advanceFindings(g: Glyph): Finding[] {
  if (g.advance >= 0) return [];
  return [finding("negative-advance", g.name, `The advance is ${String(g.advance)}.`)];
}

function contourFindings(g: Glyph): Finding[] {
  const out: Finding[] = [];

  for (const c of g.contours) {
    if (c.nodes.length === 0) {
      out.push(finding("empty-contour", g.name, "A contour with no points.", where(c, null)));
      continue;
    }
    if (c.nodes.length === 1) {
      out.push(
        finding(
          "stray-point",
          g.name,
          "A contour of a single point.",
          where(c, c.nodes[0] ?? null),
        ),
      );
      continue;
    }
    if (!c.closed) {
      out.push(
        finding(
          "open-contour",
          g.name,
          "A contour that does not close.",
          where(c, c.nodes[0] ?? null),
        ),
      );
    }

    out.push(...duplicatePoints(g, c));
    out.push(...offGrid(g, c));
  }

  return out;
}

/**
 * Points on top of one another, which are segments that draw nothing.
 *
 * Only consecutive ones. Two points of a figure eight meeting at the waist are
 * in the same place on purpose and are not a mistake; two *in a row* are one
 * click that landed twice.
 */
function duplicatePoints(g: Glyph, c: Contour): Finding[] {
  const out: Finding[] = [];
  const last = c.closed ? c.nodes.length : c.nodes.length - 1;

  for (let i = 0; i < last; i++) {
    const one = c.nodes[i];
    const two = c.nodes[(i + 1) % c.nodes.length];
    if (one === undefined || two === undefined) continue;
    if (Math.abs(one.pt.x - two.pt.x) > SAME_PLACE) continue;
    if (Math.abs(one.pt.y - two.pt.y) > SAME_PLACE) continue;

    out.push(
      finding(
        "duplicate-point",
        g.name,
        `Two points at ${round(one.pt.x)}, ${round(one.pt.y)}.`,
        where(c, two),
      ),
    );
  }

  return out;
}

/**
 * Coordinates that are not whole units.
 *
 * One finding per contour rather than per point: a shape that was scaled has
 * every point off the grid, and forty lines saying so is not forty facts.
 */
function offGrid(g: Glyph, c: Contour): Finding[] {
  const off = c.nodes.filter((n) => !whole(n.pt.x) || !whole(n.pt.y));
  if (off.length === 0) return [];

  const count = off.length === 1 ? "A point" : `${String(off.length)} points`;
  return [finding("off-grid", g.name, `${count} between units.`, where(c, off[0] ?? null))];
}

function componentFindings(document: FontDocument, g: Glyph): Finding[] {
  const out: Finding[] = [];
  const source: ComponentSource = { glyphOf: (name) => document.glyphs[name] ?? null };

  for (const c of g.components) {
    if (!(c.base in document.glyphs)) {
      out.push(finding("missing-base", g.name, `It places ${c.base}, which is not in the font.`));
      continue;
    }
    if (wouldRecurse(source, g.name, c.base)) {
      out.push(
        finding(
          "recursive-component",
          g.name,
          c.base === g.name
            ? "It places itself."
            : `It places ${c.base}, which places this glyph again.`,
        ),
      );
    }
  }

  return out;
}

function anchorFindings(g: Glyph): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();

  for (const a of g.anchors) {
    if (a.name === "") {
      out.push(finding("unnamed-anchor", g.name, "An anchor with no name."));
      continue;
    }
    if (seen.has(a.name)) {
      out.push(finding("duplicate-anchor", g.name, `Two anchors named ${a.name}.`));
    }
    seen.add(a.name);
  }

  const attaching = g.anchors.filter(isMarkAnchor).map((a) => a.name);
  if (attaching.length > 1) {
    out.push(finding("two-mark-anchors", g.name, `It attaches by ${attaching.join(" and ")}.`));
  }

  return out;
}

const where = (c: Contour, n: Node | null): Finding["where"] => ({
  contourId: c.id,
  nodeId: n === null ? null : n.id,
});

const whole = (n: number): boolean => Number.isInteger(n);

/** Coordinates as somebody reads them: two places, and no trailing zeroes. */
const round = (n: number): string => String(Math.round(n * 100) / 100);
