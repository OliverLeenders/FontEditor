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

export { glyphFileName } from "./names.js";

export type { ComponentId, ContourId, IdFactory, NodeId } from "./ids.js";
export { counterIds, randomIds } from "./ids.js";

export type { Node, NodeInit, NodeType } from "./node.js";
export {
  applyHvLock,
  enforceSmooth,
  handleOf,
  hasHandles,
  moveNodeTo,
  node,
  snapToAxis,
  translateNode,
  withHandleRaw,
} from "./node.js";

export type { Component, ComponentSource } from "./component.js";
export {
  MAX_COMPONENT_DEPTH,
  component,
  movedComponent,
  resolveComponent,
  resolveGlyphComponents,
  wouldRecurse,
} from "./component.js";

export type { Contour, Segment, SegmentKind } from "./contour.js";
export {
  appendNode,
  balanceSegment,
  contour,
  contourBounds,
  insertNodeOnSegment,
  makeSegmentCurve,
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

export type { Sidebearings } from "./metrics.js";
export {
  centreGlyph,
  setLeftSidebearing,
  setRightSidebearing,
  sidebearings,
  translateGlyph,
} from "./metrics.js";

export type { FontDocument, FontInfo, GlyphName } from "./document.js";
export {
  DEFAULT_FONT_INFO,
  fontDocument,
  glyphCount,
  glyphForCharacter,
  glyphNamed,
  glyphsForString,
  orderedGlyphs,
  putGlyph,
  removeGlyph,
  setFontInfo,
  setGlyphOrder,
  updateGlyph,
} from "./document.js";

export type { Glyph, GlyphInit } from "./glyph.js";
export {
  addContour,
  addGlyphComponent,
  isComposite,
  removeGlyphComponent,
  updateGlyphComponent,
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
