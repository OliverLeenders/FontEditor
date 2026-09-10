import type { Rect, Vec2 } from "@typewright/geometry";

import { type Contour, contour } from "./contour.js";
import type { IdFactory } from "./ids.js";
import { node } from "./node.js";

/**
 * The primitives a shape tool draws.
 *
 * Both are built counter-clockwise, which is the direction the outer contours of
 * this model's own glyphs run and what a PostScript outline expects of one. A
 * shape drawn the other way would fill as a hole the moment it overlapped
 * anything, which looks like a rendering bug and is not.
 */

/**
 * How far along the tangent a circle's handles reach, as a fraction of the
 * radius.
 *
 * The usual constant. Four cubics with handles this long are within about
 * 0.02% of a true circle — far inside a design unit at any em size anyone uses,
 * and the reason nobody draws circles with more than four points.
 */
export const KAPPA = 0.5522847498307936;

const at = (x: number, y: number): Vec2 => ({ x, y });

/** A rectangle as four corners, counter-clockwise from the bottom left. */
export function rectContour(ids: IdFactory, box: Rect): Contour {
  return contour(
    ids.contour(),
    [
      node(ids.node(), at(box.minX, box.minY)),
      node(ids.node(), at(box.maxX, box.minY)),
      node(ids.node(), at(box.maxX, box.maxY)),
      node(ids.node(), at(box.minX, box.maxY)),
    ],
    true,
  );
}

/**
 * An ellipse inscribed in a box, as four smooth nodes at its extremes.
 *
 * At the extremes rather than at the corners, because that is where an outline
 * wants its points: the top of a bowl is the place a designer reaches for, it is
 * what the export needs for a tight bounding box, and it is what makes the
 * shape's own points useful to align other things to.
 */
export function ellipseContour(ids: IdFactory, box: Rect): Contour {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const rx = (box.maxX - box.minX) / 2;
  const ry = (box.maxY - box.minY) / 2;
  const hx = rx * KAPPA;
  const hy = ry * KAPPA;

  return contour(
    ids.contour(),
    [
      // Right, top, left, bottom: counter-clockwise, each handle tangent to the
      // curve and so square to the radius at that point.
      node(ids.node(), at(box.maxX, cy), {
        type: "smooth",
        in: at(box.maxX, cy - hy),
        out: at(box.maxX, cy + hy),
      }),
      node(ids.node(), at(cx, box.maxY), {
        type: "smooth",
        in: at(cx + hx, box.maxY),
        out: at(cx - hx, box.maxY),
      }),
      node(ids.node(), at(box.minX, cy), {
        type: "smooth",
        in: at(box.minX, cy + hy),
        out: at(box.minX, cy - hy),
      }),
      node(ids.node(), at(cx, box.minY), {
        type: "smooth",
        in: at(cx - hx, box.minY),
        out: at(cx + hx, box.minY),
      }),
    ],
    true,
  );
}
