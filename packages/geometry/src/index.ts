/**
 * @fonteditor/geometry
 *
 * Pure 2D geometry and the Tunni-line kernel.
 *
 * Nothing in this package touches the DOM, reads a global, or keeps state. Every
 * function is total: given finite input it either returns a value or returns
 * `null`, and it never returns `NaN` dressed up as a coordinate. That is what
 * makes it testable without a browser, runnable inside a Worker, and safe to
 * call sixty times a second from a drag handler.
 */

export {
  COINCIDENT_EPS,
  COLLINEAR_EPS,
  FLATTEN_TOLERANCE,
  PARALLEL_EPS,
  approxEqual,
  isNegligible,
} from "./epsilon.js";

export type { Rect, Vec2 } from "./vec2.js";
export {
  ORIGIN,
  add,
  addScaled,
  angleBetween,
  boundsOf,
  coincident,
  cross,
  distance,
  distanceSq,
  dot,
  equals,
  isFinitePoint,
  length,
  lengthSq,
  lerp,
  midpoint,
  negate,
  normalize,
  perpendicular,
  rotate,
  scale,
  stretchToLength,
  sub,
  vec,
} from "./vec2.js";

export type { Side } from "./line.js";
export {
  distanceToLine,
  distanceToSegment,
  intersectLines,
  projectOntoLine,
  sameSide,
  sideOf,
} from "./line.js";

export type { Cubic, Projection, Quadratic } from "./cubic.js";
export {
  arcLength,
  bounds,
  controlPoints,
  cubic,
  derivative,
  evaluate,
  evaluateQuadratic,
  extrema,
  flatten,
  isFiniteCubic,
  isFlat,
  lineAsCubic,
  project,
  quadraticToCubic,
  reverse,
  split,
  subcurve,
  tangent,
} from "./cubic.js";

export type { HandleScales, TunniLine, TunniStatus } from "./tunni.js";
export {
  balance,
  cubicFromLambdas,
  handleIntersection,
  moveTunniLine,
  setTunniPoint,
  tunniLambdas,
  tunniLine,
  tunniPoint,
  tunniStatus,
} from "./tunni.js";
