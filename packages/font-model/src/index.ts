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

export { glyphFileName, glyphNameForCodePoint } from "./names.js";

export type { Anchor } from "./anchor.js";
export { anchor, isMarkAnchor, movedAnchor, pairedName, renamedAnchor } from "./anchor.js";

export type { AnchorId, ComponentId, ContourId, IdFactory, NodeId } from "./ids.js";
export { counterIds, randomIds } from "./ids.js";

export type { HandleLock, Node, NodeInit, NodeType } from "./node.js";
export {
  BOTH_LOCKED,
  NO_LOCK,
  anyLocked,
  applyHvLock,
  handleLock,
  enforceSmooth,
  handleOf,
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
  attachmentOffset,
  movedComponent,
  placedComponent,
  transformedComponent,
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
  extendHandle,
  extendSegmentHandles,
  isHalfHandled,
  insertNodeOnSegment,
  makeSegmentCurve,
  makeSegmentLine,
  moveSegmentTunniLine,
  nodeById,
  nodeIndex,
  removeNode,
  reverseContour,
  canBeTangent,
  enforceTangents,
  segmentAt,
  segmentCount,
  segmentCubic,
  segmentIndexForHandle,
  segmentLambdas,
  segmentTunniPoint,
  segmentTunniStatus,
  segments,
  setClosed,
  setHandle,
  setHvLock,
  setNodePoint,
  setNodeType,
  setSegmentCubic,
  setSegmentLambdas,
  setSegmentTunniPoint,
  translateNodeBy,
  translateNodes,
  unionRect,
} from "./contour.js";

export { contourWinding, correctDirections, filledContours } from "./direction.js";

export type { MetricLine, Sidebearings } from "./metrics.js";
export {
  centreGlyph,
  metricLines,
  setLeftSidebearing,
  setRightSidebearing,
  sidebearings,
  translateGlyph,
} from "./metrics.js";

export type { KernIndex, KernMatch, Kerning } from "./kerning.js";
export {
  EMPTY_KERNING,
  GROUP_PREFIX,
  addToKernGroup,
  clearKern,
  groupKey,
  groupNameOf,
  isGroupKey,
  kernGroupOf,
  kernGroupPairCount,
  kernIndex,
  kernMatch,
  renameGlyphInKerning,
  kernPairCount,
  kernPairs,
  kernValue,
  removeFromKernGroup,
  removeKernGroup,
  renameKernGroup,
  setKern,
  setKernException,
  setKernGroup,
} from "./kerning.js";

export type { FontDocument, FontInfo, GlyphName, RenameProblem } from "./document.js";
export {
  DEFAULT_FONT_INFO,
  fontDocument,
  glyphCount,
  glyphForCodePoint,
  glyphNamed,
  glyphsForString,
  orderedGlyphs,
  putGlyph,
  removeGlyph,
  NOTDEF,
  deleteProblem,
  renameGlyph,
  renameProblem,
  setFontInfo,
  setGlyphOrder,
  setFeatures,
  setKerning,
  updateGlyph,
} from "./document.js";

export type { Glyph, GlyphInit } from "./glyph.js";
export {
  addContour,
  addAnchor,
  addGlyphComponent,
  decomposedGlyph,
  anchorById,
  anchorNamed,
  isComposite,
  moveAnchorBy,
  moveAnchorTo,
  removeAnchor,
  renameAnchor,
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

export { UNIT_GRID, roundFont, roundGlyph, unroundedGlyphs } from "./round.js";

export { KAPPA, ellipseContour, rectContour } from "./shapes.js";

export type { KnifeCut } from "./knife.js";
export { cutGlyph } from "./knife.js";

export type { StrokeCrossing } from "./crossings.js";
export { byContour, samePoint, strokeCrossings } from "./crossings.js";

export type { Measurement } from "./measure.js";
export { measureAngle, measureNormal } from "./measure.js";

export type { OverlapResult } from "./overlap.js";
export { removeOverlap } from "./overlap.js";
