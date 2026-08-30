/**
 * @fonteditor/font-model
 *
 * The document model. Plain, serializable, structurally-shareable data — no
 * class instances, no DOM references, no live view objects. It must survive
 * `structuredClone`, a JSON round-trip, and a trip through a Worker unchanged,
 * because that is what lets the history layer snapshot and patch it without
 * special cases.
 *
 * Every editing function here is pure: it returns a new value, or `null` when
 * the request identifies nothing or the operation is not defined. Transactions,
 * patches and undo live in `edit-core`; nothing in this package knows they
 * exist.
 */

export type { ContourId, IdFactory, NodeId } from "./ids.js";
export { counterIds, randomIds } from "./ids.js";

export type { Node, NodeInit, NodeType } from "./node.js";
export {
  applyHvLock,
  enforceSmooth,
  handleOf,
  hasHandles,
  moveNodeTo,
  node,
  translateNode,
  withHandleRaw,
} from "./node.js";

export type { Contour, Segment, SegmentKind } from "./contour.js";
export {
  appendNode,
  balanceSegment,
  contour,
  contourBounds,
  insertNodeOnSegment,
  makeSegmentLine,
  moveSegmentTunniLine,
  nodeById,
  nodeIndex,
  removeNode,
  reverseContour,
  segmentAt,
  segmentChord,
  segmentCount,
  segmentCubic,
  segmentIndexForHandle,
  segmentTunniPoint,
  segmentTunniStatus,
  segments,
  setClosed,
  setHandle,
  setHvLock,
  setNodePoint,
  setNodeType,
  setSegmentCubic,
  setSegmentTunniPoint,
  translateNodeBy,
  unionRect,
} from "./contour.js";

export type { FontDocument } from "./document.js";
export { fontDocument, withGlyph } from "./document.js";

export type { Glyph, GlyphInit } from "./glyph.js";
export {
  addContour,
  allSegments,
  contourById,
  contourIndex,
  glyph,
  glyphBounds,
  nodeCount,
  removeContour,
  replaceContour,
  setAdvance,
  updateContour,
} from "./glyph.js";
