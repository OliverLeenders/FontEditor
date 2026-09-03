import { vec } from "@fonteditor/geometry";

import { type Contour, contour } from "../src/contour.js";
import { counterIds } from "../src/ids.js";
import { node } from "../src/node.js";

/**
 * A closed square-ish loop of four curve nodes, roughly an `o`.
 *
 * Handles are placed so every segment is a well-formed curve — same side of its
 * chord, pointing towards each other — so `tunniStatus` reports `ok` on all four
 * and the Tunni bridge has something real to work on.
 */
export function ringContour(): Contour {
  const ids = counterIds();
  const k = 140;
  return contour(
    ids.contour(),
    [
      node(ids.node(), vec(0, 250), { type: "smooth", in: vec(-k, 250), out: vec(k, 250) }),
      node(ids.node(), vec(250, 0), { type: "smooth", in: vec(250, k), out: vec(250, -k) }),
      node(ids.node(), vec(0, -250), { type: "smooth", in: vec(k, -250), out: vec(-k, -250) }),
      node(ids.node(), vec(-250, 0), { type: "smooth", in: vec(-250, -k), out: vec(-250, k) }),
    ],
    true,
  );
}

/** An open contour of three nodes: a line, then a curve. */
export function openContour(): Contour {
  const ids = counterIds("o");
  return contour(
    ids.contour(),
    [
      node(ids.node(), vec(0, 0)),
      node(ids.node(), vec(100, 0), { out: vec(140, 0) }),
      node(ids.node(), vec(200, 100), { in: vec(200, 60) }),
    ],
    false,
  );
}

/** A closed triangle with no handles at all — three straight lines. */
export function triangleContour(): Contour {
  const ids = counterIds("t");
  return contour(
    ids.contour(),
    [node(ids.node(), vec(0, 0)), node(ids.node(), vec(100, 0)), node(ids.node(), vec(50, 90))],
    true,
  );
}
