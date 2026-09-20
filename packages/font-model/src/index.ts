/**
 * @typewright/font-model
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

export type { AnchorId, ComponentId, ContourId, GuideId, IdFactory, NodeId } from "./ids.js";
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

export type { Component, ComponentSource, FlipAxis } from "./component.js";
export {
  MAX_COMPONENT_DEPTH,
  component,
  attachmentOffset,
  flippedComponent,
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
  curvatureAround,
  harmoniseNode,
  segmentsAround,
  contourBounds,
  extendHandle,
  extendSegmentHandles,
  isHalfHandled,
  insertNodeOnSegment,
  insertNodesOnSegment,
  makeSegmentCurve,
  makeSegmentLine,
  moveSegmentTunniLine,
  nodeById,
  nodeIndex,
  removeNode,
  removeNodeFitted,
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
  setStartNode,
  setNodePoint,
  setNodeType,
  setSegmentCubic,
  setSegmentLambdas,
  setSegmentTunniPoint,
  translateNodeBy,
  translateNodes,
  unionRect,
} from "./contour.js";

export {
  contourWinding,
  correctDirections,
  filledContours,
  glyphPolygons,
  insideGlyph,
} from "./direction.js";

export type { TextToken } from "./text.js";
export { codePointFromName, textTokens } from "./text.js";

export type { MetricKeyReference } from "./metric-key-text.js";
export { parseMetricKey, renamedMetricKey } from "./metric-key-text.js";

export type { MetricKeyProblem, ResolvedMetrics } from "./metric-keys.js";
export { resolvedMetrics, withResolvedMetrics } from "./metric-keys.js";

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

export type {
  FontDocument,
  FontInfo,
  GlyphName,
  Kept,
  PlainValue,
  RenameProblem,
  StyleMapStyle,
} from "./document.js";
export {
  DEFAULT_FONT_INFO,
  NOTHING_KEPT,
  STYLE_MAP_STYLES,
  fontDocument,
  glyphCount,
  glyphForCodePoint,
  glyphForToken,
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
  setGuides,
  setKept,
  setKerning,
  updateGlyph,
} from "./document.js";

export type { Glyph, GlyphInit, MetricKeys } from "./glyph.js";
export type { LayerDrawing, LayerInfo, LayerProblem } from "./layers.js";
export {
  BACKGROUND,
  addLayer,
  clearLayer,
  copyToLayer,
  drawingOf,
  hasLayer,
  inLayer,
  layerInfo,
  layerLabel,
  layerProblem,
  layerProblemSays,
  removeLayer,
  setLayers,
  swapWithLayer,
  updateGlyphInLayer,
  withLayer,
} from "./layers.js";
export {
  addContour,
  addAnchor,
  addGuide,
  setGlyphImage,
  addGlyphComponent,
  decomposedGlyph,
  anchorById,
  anchorNamed,
  isComposite,
  moveAnchorBy,
  moveAnchorTo,
  removeAnchor,
  removeGuide,
  guideNamed,
  updateGuide,
  renameAnchor,
  removeGlyphComponent,
  updateGlyphComponent,
  allSegments,
  contourById,
  contourIndex,
  glyph,
  glyphBounds,
  nodeCount,
  moveContourTo,
  removeContour,
  replaceContour,
  setAdvance,
  updateContour,
  NO_METRIC_KEYS,
  hasMetricKeys,
} from "./glyph.js";

export { UNIT_GRID, roundFont, roundGlyph, unroundedGlyphs } from "./round.js";

export { KAPPA, ellipseContour, rectContour } from "./shapes.js";

export type { KnifeCut } from "./knife.js";
export { cutGlyph } from "./knife.js";

export type { StrokeCrossing } from "./crossings.js";
export { byContour, samePoint, strokeCrossings } from "./crossings.js";

export type { Measurement, PlacedGlyph, Section, SectionSpan } from "./measure.js";
export { measureAngle, measureGap, measureNormal, sectionAcross } from "./measure.js";

export type { OverlapResult } from "./overlap.js";
export { removeOverlap } from "./overlap.js";

export type { Guide } from "./guide.js";
export {
  distanceToGuide,
  guide,
  guideDirection,
  horizontalGuide,
  isHorizontal,
  isVertical,
  movedGuide,
  nearestOnGuide,
  normalAngle,
  renamedGuide,
  turnedGuide,
  verticalGuide,
} from "./guide.js";

export type { ImageRef } from "./image.js";
export { imagePoint, imageRef, invertAffine, placeCrop, shownCrop } from "./image.js";

export type {
  Axis,
  AxisMap,
  Instance,
  InstanceId,
  KeptXml,
  Location,
  Master,
  MasterId,
  SparseSource,
} from "./designspace.js";
export {
  WEIGHT,
  axis,
  defaultLocation,
  describeLocation,
  inAxisOrder,
  avarSegments,
  instance,
  isDiscrete,
  isSparse,
  master,
  normalised,
  sameLocation,
  settledLocation,
  toDesign,
  toUser,
  userLocation,
  userRange,
} from "./designspace.js";

export type { Rule, RuleCondition, RuleId, RulesProcessing } from "./rules.js";
export { conditionHolds, rule, ruleApplies, swapsAt } from "./rules.js";

export type { FontProject, InstanceProblem, MasterProblem } from "./project.js";
export {
  FIRST_MASTER,
  addInstance,
  addMaster,
  addRule,
  currentMaster,
  currentSource,
  hasMasters,
  instanceById,
  instanceProblemSays,
  isProject,
  masterById,
  masterProblemSays,
  moveInstance,
  moveMaster,
  orderedInstances,
  orderedMasters,
  project,
  removeInstance,
  removeMaster,
  removeRule,
  renameInstance,
  renameMaster,
  replaceRule,
  setAxes,
  setInstanceFamily,
  setInstances,
  setRulesProcessing,
  sourceOf,
  sparseFlags,
  switchTo,
  withCurrentSource,
  withSource,
} from "./project.js";

export type { Incompatibility } from "./compatible.js";
export { glyphCompatible, glyphIncompatibilities, incompatibilities } from "./compatible.js";

export type { Region, Support } from "./variation.js";
export {
  masterWeights,
  supportScalar,
  supportsFor,
  variationModel,
  weightsAmong,
} from "./variation.js";

export { glyphPresence, interpolateFont, interpolateGlyph } from "./interpolate.js";

export type { VerticalMetrics } from "./vertical-metrics.js";
export {
  USE_TYPO_METRICS_BIT,
  derivedVerticalMetrics,
  verticalMetrics,
} from "./vertical-metrics.js";

export type { CompositeBuild, CompositeProblem, GlyphLookup } from "./composites.js";
export { attachComponents, buildComposite, compositePlan, compositeParts } from "./composites.js";

export type { SectionStop } from "./measure.js";

export { drawableGlyph } from "./drawable.js";

export { componentLanding } from "./composites.js";

export type { MarkColor } from "./mark-color.js";
export { MARK_COLORS, parseMarkColor, sameMarkColor } from "./mark-color.js";
