/**
 * One-shot edits, as opposed to gestures.
 *
 * A tool spreads a transaction across many events — press, move, release. These
 * happen all at once, so each opens and closes its own in a single call. They are
 * what a context menu, a keyboard shortcut or an inspector button invokes, and
 * putting them here rather than in the interface keeps them testable and keeps
 * three call sites from growing three slightly different versions of the same
 * edit.
 *
 * Every one returns the state unchanged when it cannot do anything, so a caller
 * never has to check first.
 *
 * They are grouped by what they act on rather than kept in one file. That file
 * reached eleven hundred lines and a dozen unrelated subjects — points, kerning,
 * font metrics, overlap, naming — which is a directory pretending to be a
 * module. This barrel is the whole of the seam: nothing outside the package
 * names a file below it.
 */

export {
  addComponent,
  attachComponent,
  attachmentFor,
  componentSource,
  decomposeCurrentGlyph,
  decomposeGlyphAt,
  deleteSelectedComponent,
  flipComponent,
  moveComponentTo,
  removeComponent,
} from "./components.js";

export {
  addAnchorAt,
  deleteSelectedAnchor,
  freeAnchorName,
  moveAnchorToPoint,
  removeAnchorAt,
  renameAnchorTo,
} from "./anchors.js";

export type { GuideScope } from "./guides.js";

export {
  currentImage,
  fitImageToGlyph,
  glyphBox,
  imagePlacement,
  moveImageBy,
  moveImageTo,
  placeImageByCrop,
  scaleImageTo,
  shownImageCrop,
} from "./images.js";
export {
  addGuideAt,
  deleteSelectedGuide,
  guideById,
  guidesInForce,
  moveGuideBy,
  moveGuideTo,
  moveGuideToScope,
  movedGuideIn,
  pickGuide,
  removeGuideAt,
  renameGuideTo,
  turnGuideTo,
} from "./guides.js";

export {
  balanceSegmentAt,
  convertSegment,
  focusedSegmentScales,
  focusedSegmentStatus,
  holdSegmentTension,
  insertPointOnSegment,
  reverseContourAt,
  reverseSelectedContour,
  setSegmentTension,
} from "./contours.js";

export { infoProblem, setInfo } from "./font.js";

export type { NewGlyph } from "./glyphs.js";
export {
  createGlyphs,
  deleteGlyph,
  deleteRefusal,
  renameCurrentGlyph,
  renameRefusal,
} from "./glyphs.js";

export type { KernSide } from "./kerning.js";
export {
  addKernGroup,
  breakOutKern,
  deleteKernGroup,
  kernGroupHolding,
  kernGroupPairs,
  kernGroupProblem,
  kerningFor,
  nudgeKern,
  putGlyphInKernGroup,
  renameKernGroupTo,
  takeGlyphFromKernGroup,
} from "./kerning.js";

export type { OverlapOutcome } from "./overlap.js";
export { overlapAt, removeOverlapAt, selectedContourIds } from "./overlap.js";

export {
  deleteSelectedPoints,
  extractHandles,
  extractSegmentHandles,
  harmoniseSelection,
  nodeCanBeTangent,
  nodeCanHarmonise,
  nodeHasMissingHandle,
  nodeHvLocked,
  retractHandle,
  segmentHasMissingHandle,
  selectedCanBeTangent,
  selectedCurvature,
  selectedNode,
  setNodeHvLock,
  setPointType,
} from "./points.js";

export {
  roundCoordinates,
  roundGlyphAt,
  roundSelection,
  unroundedCount,
  unroundedSelected,
} from "./rounding.js";

export {
  clearSelection,
  moveCoordinateTo,
  segmentParameterAt,
  selectAllPoints,
  selectContour,
  selectedCoordinate,
} from "./selection.js";

export { centreCurrentGlyph, nudgeSidebearing, setMetricKey } from "./spacing.js";

export type { TransformOrigin } from "./transform.js";
export { BOX_CENTRE, transformOriginPoint, transformSelection } from "./transform.js";
