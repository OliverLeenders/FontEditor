import { type Vec2, about, add, keepsAxes, rotation, sub } from "@typewright/geometry";
import {
  type GuideId,
  isHorizontal,
  isVertical,
  type AnchorId,
  type ComponentId,
  type Contour,
  type ContourId,
  type Node,
  type Glyph,
  type NodeId,
  contourById,
  metricLines,
  movedComponent,
  moveAnchorTo,
  moveSegmentTunniLine,
  NO_METRIC_KEYS,
  nodeById,
  segmentAt,
  segments,
  segmentIndexForHandle,
  setHandle,
  setLeftSidebearing,
  setSegmentTunniPoint,
  sidebearings,
  translateNodes,
  updateContour,
  updateGlyphComponent,
  updateGlyphInLayer,
} from "@typewright/font-model";
import {
  type BoxFrame,
  type BoxHandle,
  type HitTarget,
  type SegmentRef,
  type Selection,
  type SelectionItem,
  type SnapLine,
  type SnapRay,
  type Snapping,
  NO_HOLD,
  NO_SNAPPING,
  SNAP_PIXELS,
  SNAP_STAY_PIXELS,
  SNAP_STICKINESS,
  addItems,
  alignmentLines,
  hasItem,
  itemForTarget,
  itemsInRect,
  metricLine,
  screenTolerance,
  selectionPoints,
  snapDelta,
  snapPoint,
  toGrid,
  toggleItem,
  boxPivot,
  boxScale,
  boxScaleTransform,
  boxTurn,
} from "@typewright/view";

import { type ToolResult, begin, result } from "./effects.js";
import type { PointerInput } from "./input.js";
import { movedGuideIn } from "./commands/guides.js";
import { keyHolds } from "./commands/spacing.js";
import { type EditorState, type Gesture, currentGlyph, glyphIn } from "./state.js";
import { transformedDocument } from "./transform.js";

/**
 * Beginning and continuing a drag.
 *
 * Split from the tool's entry points because a gesture used to be described in
 * two places — where it started, and a branch of a switch far below that carried
 * it on — and the two drifted. Here each kind is one entry in one table, and the
 * table's type makes a missing half a compile error rather than a gesture that
 * begins and then does nothing.
 */

/** Stands in when the current glyph name does not resolve, so reads stay total. */
export const EMPTY_GLYPH: Glyph = {
  name: "",
  unicodes: [],
  advance: 0,
  contours: [],
  components: [],
  anchors: [],
  guides: [],
  image: null,
  kept: [],
  metricKeys: NO_METRIC_KEYS,
  markColor: null,
  layers: {},
};

// ---------------------------------------------------------------------------
// starting
// ---------------------------------------------------------------------------

/**
 * Shift extends or removes; a plain click replaces — unless the thing clicked is
 * already selected, in which case the selection is left alone so a multi-item
 * drag is not destroyed by grabbing one of its members.
 */
function nextSelection(selection: Selection, item: SelectionItem, extend: boolean): Selection {
  if (extend) return toggleItem(selection, item);
  if (hasItem(selection, item)) return selection;
  return [item];
}

function handleSegment(state: EditorState, item: SelectionItem): SegmentRef | null {
  if (item.part === "point") return null;
  const c = contourById(currentGlyph(state) ?? EMPTY_GLYPH, item.contourId);
  if (c === null) return null;
  const segmentIndex = segmentIndexForHandle(c, item.nodeId, item.part);
  return segmentIndex === null ? null : { contourId: item.contourId, segmentIndex };
}

export function startMarquee(state: EditorState, input: PointerInput): ToolResult {
  const additive = input.modifiers.shift;
  // Clicking empty canvas means "nothing in particular", so it drops focus as
  // well as selection — otherwise a focused segment's controls would linger with
  // no way to dismiss them.
  return result({
    ...state,
    selection: additive ? state.selection : [],
    focusedSegment: additive ? state.focusedSegment : null,
    gesture: {
      kind: "marquee",
      origin: input.point,
      current: input.point,
      additive,
      before: state.selection,
      moved: false,
    },
  });
}

/**
 * Begin dragging everything that is selected, from inside the box round it.
 *
 * The box is how a selection says where it is, so taking hold of it there is
 * what anyone would try — and until now the inside of it belonged to the
 * marquee, which meant a drag begun on the shape you had just selected threw
 * the selection away and started a new one.
 *
 * Nothing is selected or deselected by it: what moves is exactly what was
 * already chosen, which is the difference between this and dragging a node.
 */
export function startSelectionDrag(state: EditorState, input: PointerInput): ToolResult {
  return result(
    {
      ...state,
      gesture: {
        kind: "dragSelection",
        origin: input.point,
        items: state.selection,
        before: state.document,
        moved: false,
        snapped: NO_HOLD,
      },
    },
    [begin("Move selection")],
  );
}

export function startItemDrag(
  state: EditorState,
  input: PointerInput,
  target: HitTarget,
): ToolResult {
  const item = itemForTarget(target);
  if (item === null) return result(state);

  const selection = nextSelection(state.selection, item, input.modifiers.shift);

  // Shift-clicking to deselect should not then drag the thing just removed.
  if (!hasItem(selection, item)) return result({ ...state, selection });

  const isHandle = item.part !== "point";
  const label = isHandle ? "Move handle" : "Move node";

  // A handle shapes exactly one segment, so touching it says unambiguously which
  // segment is being worked on. A node sits between two and names neither, so
  // dragging one leaves focus where it was rather than guessing.
  const focusedSegment = isHandle
    ? (handleSegment(state, item) ?? state.focusedSegment)
    : state.focusedSegment;

  const gesture: Gesture =
    isHandle && selection.length === 1
      ? {
          kind: "dragHandle",
          origin: input.point,
          contourId: item.contourId,
          nodeId: item.nodeId,
          part: item.part === "in" ? "in" : "out",
          breakSmooth: input.modifiers.alt,
          before: state.document,
          moved: false,
          snapped: NO_HOLD,
        }
      : {
          kind: "dragSelection",
          origin: input.point,
          items: selection,
          before: state.document,
          moved: false,
          snapped: NO_HOLD,
        };

  return result({ ...state, selection, focusedSegment, gesture }, [begin(label)]);
}

/**
 * Begin dragging one handle of the box round the selection.
 *
 * The selection is left exactly as it is: the box is a way of moving what is
 * already chosen, and a grab that changed the choice would move something other
 * than what the box was drawn around.
 */
export function startBoxTransform(
  state: EditorState,
  input: PointerInput,
  handle: BoxHandle,
  box: BoxFrame,
): ToolResult {
  return result(
    {
      ...state,
      gesture: {
        kind: "transformBox",
        origin: input.point,
        handle,
        box,
        items: state.selection,
        before: state.document,
        moved: false,
      },
    },
    [begin(handle.action === "rotate" ? "Rotate" : "Scale", false)],
  );
}

/**
 * Begin dragging a component.
 *
 * The point selection goes, as it does for an anchor: what is being moved is a
 * placed glyph, and a box round points that are staying put would say otherwise.
 */
export function startComponentDrag(
  state: EditorState,
  input: PointerInput,
  componentId: ComponentId,
): ToolResult {
  return result(
    {
      ...state,
      selection: [],
      selectedAnchor: null,
      selectedComponent: componentId,
      gesture: {
        kind: "dragComponent",
        origin: input.point,
        componentId,
        before: state.document,
        moved: false,
        snapped: NO_HOLD,
      },
    },
    [begin("Move component")],
  );
}

/**
 * Begin dragging an anchor.
 *
 * Selecting it as well, so the panel shows what is being moved — and clearing
 * the point selection, because a box round points that are not moving while an
 * anchor is would say something untrue about what the drag does.
 */
export function startAnchorDrag(
  state: EditorState,
  input: PointerInput,
  anchorId: AnchorId,
): ToolResult {
  return result(
    {
      ...state,
      selection: [],
      selectedAnchor: anchorId,
      gesture: {
        kind: "dragAnchor",
        origin: input.point,
        anchorId,
        before: state.document,
        moved: false,
        snapped: NO_HOLD,
      },
    },
    [begin("Move anchor")],
  );
}

/**
 * Pick a guide up.
 *
 * The point selection goes, as it does for an anchor: only one of the two can
 * be what the next arrow key or Backspace means.
 */
export function startGuideDrag(
  state: EditorState,
  input: PointerInput,
  guideId: GuideId,
): ToolResult {
  return result(
    {
      ...state,
      selection: [],
      selectedAnchor: null,
      selectedGuide: guideId,
      gesture: {
        kind: "dragGuide",
        origin: input.point,
        guideId,
        before: state.document,
        moved: false,
        snapped: NO_HOLD,
      },
    },
    [begin("Move guide")],
  );
}

export function startTunniDrag(
  state: EditorState,
  input: PointerInput,
  kind: "dragTunniPoint" | "dragTunniLine",
  segmentIndex: number,
  contourId: string,
): ToolResult {
  const label = kind === "dragTunniPoint" ? "Move Tunni point" : "Move Tunni line";
  const segment = { contourId, segmentIndex };
  return result(
    {
      ...state,
      focusedSegment: segment,
      gesture: { kind, origin: input.point, segment, before: state.document, moved: false },
    },
    [begin(label)],
  );
}

/**
 * Begin dragging a margin line.
 *
 * The selection is cleared first. These lines belong to the glyph as a whole, and
 * leaving points selected would make the next arrow-key nudge move them rather
 * than doing what the spacing gesture just implied.
 */
export function startMarginDrag(
  state: EditorState,
  input: PointerInput,
  side: "origin" | "advance",
): ToolResult {
  const glyph = currentGlyph(state);
  if (glyph === null) return result(state);
  // A measurement a key speaks for is put back by the settle at the end of the
  // step, so the drag would be a drag that springs back. The line simply does
  // not take hold, the way the field for it is grey.
  if (keyHolds(state.document, state.currentGlyph, side === "origin" ? "left" : "advance")) {
    return result(state);
  }

  return result(
    {
      ...state,
      selection: [],
      gesture: {
        kind: "dragMargin",
        origin: input.point,
        side,
        startAdvance: glyph.advance,
        startLeft: sidebearings(glyph, state.document)?.left ?? null,
        before: state.document,
        moved: false,
      },
    },
    [begin(side === "origin" ? "Move glyph" : "Set advance", false)],
  );
}

/**
 * Clicking a segment selects the on-curve points at each end, so the whole span
 * can then be nudged or dragged as a unit.
 */
export function selectSegmentEnds(
  state: EditorState,
  input: PointerInput,
  target: Extract<HitTarget, { kind: "segment" }>,
): ToolResult {
  const c = contourById(currentGlyph(state) ?? EMPTY_GLYPH, target.contourId);
  const segment = c === null ? null : segmentAt(c, target.segmentIndex);
  if (segment === null) return result(state);

  const ends: Selection = [
    { contourId: target.contourId, nodeId: segment.fromId, part: "point" },
    { contourId: target.contourId, nodeId: segment.toId, part: "point" },
  ];
  const selection = input.modifiers.shift ? addItems(state.selection, ends) : ends;

  return result(
    {
      ...state,
      selection,
      focusedSegment: { contourId: target.contourId, segmentIndex: target.segmentIndex },
      gesture: {
        kind: "dragSelection",
        origin: input.point,
        items: selection,
        before: state.document,
        moved: false,
        snapped: NO_HOLD,
      },
    },
    [begin("Move segment")],
  );
}

// ---------------------------------------------------------------------------
// continuing
// ---------------------------------------------------------------------------

/**
 * Offset every selected item, resolving the overlaps a mixed selection creates.
 *
 * Three cases, and the order matters:
 *
 *  - A selected on-curve point moves with both its handles, so any handle of
 *    that node is skipped — moving it again would double its offset.
 *  - Exactly one handle of a node selected: move it through `setHandle`, which
 *    keeps a smooth node smooth by swinging the other side.
 *  - Both handles selected and not the point: move each without enforcing
 *    smoothness, because enforcing it twice makes each handle fight the other
 *    and the result depends on which was processed first.
 */
export function translateSelection(g: Glyph, selection: Selection, delta: Vec2): Glyph {
  if (delta.x === 0 && delta.y === 0) return g;

  const pointsMoved = new Set<string>();
  const handleCount = new Map<string, number>();
  for (const item of selection) {
    const key = `${item.contourId} ${item.nodeId}`;
    if (item.part === "point") pointsMoved.add(key);
    else handleCount.set(key, (handleCount.get(key) ?? 0) + 1);
  }

  // Grouped by contour, so each is rewritten once however many of its points
  // are selected. One `updateContour` per point copies the node list and settles
  // the tangents every time, which is quadratic in a selection that can now be a
  // whole contour in one gesture.
  const byContour = new Map<ContourId, Set<NodeId>>();
  for (const item of selection) {
    if (item.part !== "point") continue;
    const ids = byContour.get(item.contourId) ?? new Set<NodeId>();
    ids.add(item.nodeId);
    byContour.set(item.contourId, ids);
  }

  let next = g;

  for (const [contourId, ids] of byContour) {
    next = updateContour(next, contourId, (c) => translateNodes(c, ids, delta)) ?? next;
  }

  for (const item of selection) {
    // Bound to a const so the narrowing survives into the closure below —
    // TypeScript discards a narrowing on `item.part` there, since the object
    // could in principle be mutated in between.
    const part = item.part;
    if (part === "point") continue;

    const key = `${item.contourId} ${item.nodeId}`;
    if (pointsMoved.has(key)) continue;

    // Read from the original glyph: a sibling handle's move must not shift the
    // origin this one is offset from.
    const source = contourById(g, item.contourId);
    const original = source === null ? null : nodeById(source, item.nodeId);
    if (original === null) continue;
    const handle = part === "in" ? original.in : original.out;
    if (handle === null) continue;

    const breakSmooth = (handleCount.get(key) ?? 0) > 1;
    next =
      updateContour(next, item.contourId, (c) =>
        setHandle(c, item.nodeId, part, add(handle, delta), breakSmooth),
      ) ?? next;
  }

  return next;
}

function rectOf(a: Vec2, b: Vec2) {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/**
 * Where drags are allowed to land, for the glyph being edited.
 *
 * The metric lines are exactly the ones the canvas already draws — the five of
 * them, the origin and the advance — and that is the rule this follows: a drag
 * may only catch on something visible. A pull towards an invisible line is
 * indistinguishable from a bug.
 *
 * Which is why the alignment lines are off unless a caller asks for them, and
 * why the line a drag is caught on is drawn while it holds: a stem edge is not
 * on the canvas the way the baseline is, so the guide is what makes the catch
 * visible. See `drawSnapGuides` in the renderer.
 *
 * The tolerances are converted from screen pixels, so the catch feels the same
 * at every zoom instead of covering half the em at a distance. Holding ctrl
 * turns the whole thing off, including the rounding, for the times when a
 * coordinate has to be exactly what the cursor says.
 */
export function snappingFor(
  state: EditorState,
  input: PointerInput,
  options: GestureOptions,
  started: Glyph,
  moving: Selection,
  exceptGuide: GuideId | null = null,
): Snapping {
  if (options.snap === false || input.modifiers.ctrl) return NO_SNAPPING;

  const glyph = currentGlyph(state);
  const alignment = alignmentLines(started, moving, { points: options.snapPoints ?? false });

  // The lines the designer put there, font's and glyph's together. The upright
  // and level ones are coordinates on an axis; the rest are rays, which the
  // machinery understands now — an italic guide used to be drawn and measured
  // against by eye.
  const upright: SnapLine[] = [];
  const level: SnapLine[] = [];
  const rays: SnapRay[] = [];
  for (const g of [...state.document.guides, ...(glyph?.guides ?? [])]) {
    // Never the one being dragged. These lines are rebuilt from the document
    // every frame, so a dragged guide's own line sits exactly under the pointer
    // and catches it: the guide then holds still until the pointer has pulled a
    // whole `stay` away, jumps to it, and catches itself again at the new place.
    // That is a guide moving in steps of ten screen pixels rather than one
    // following the hand, and it is why guides could only be aligned by zooming
    // in until ten pixels was worth less than a unit.
    if (g.id === exceptGuide) continue;
    if (isVertical(g)) upright.push(metricLine(g.pt.x, "guide"));
    else if (isHorizontal(g)) level.push(metricLine(g.pt.y, "guide"));
    else rays.push({ through: g.pt, direction: alongDegrees(g.angle), source: "guide" });
  }

  if (options.snapPoints === true && glyph !== null) {
    rays.push(...outlineRays(state, glyph, moving));
  }

  const pixels = options.snapPixels ?? SNAP_PIXELS;
  return {
    // Font lines first: where a stem edge happens to sit exactly on the cap
    // height, catching "the cap height" is the more useful account of what
    // happened, and `catchLine` breaks a tie by the order it was given.
    xs: [
      metricLine(0, "origin"),
      ...(glyph === null ? [] : [metricLine(glyph.advance, "advance")]),
      ...upright,
      ...alignment.xs,
    ],
    ys: [
      ...metricLines(state.document.info).map((line) => metricLine(line.y)),
      ...level,
      ...alignment.ys,
    ],
    rays,
    enter: screenTolerance(state.view, pixels),
    stay: screenTolerance(state.view, options.snapStayPixels ?? SNAP_STAY_PIXELS),
    stickiness: options.snapStickiness ?? SNAP_STICKINESS,
    grid: 1,
  };
}

/** A unit vector at an angle, counter-clockwise from the x axis. */
function alongDegrees(degrees: number): Vec2 {
  const radians = (degrees * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/**
 * The angled lines a drawing offers a drag, through the points that are
 * standing still.
 *
 * Three kinds, and each answers something the axes cannot on a slanted design.
 * **Square to a segment**: through a neighbour that is staying put, at a right
 * angle to the segment on its far side — which is how a stem is cut square to
 * the one it meets, whatever angle they are at. **Parallel to it**: the same
 * line turned to run alongside, which is how the other side of a stem is kept
 * at the angle the first side has. And **the italic angle** through the same
 * points, which is upright for a design that leans.
 *
 * The direction of that segment is the direction it *leaves the neighbour by* —
 * its handle where it has one, and the chord to the next node where it is
 * straight. Not the chord in both cases, which is what this did at first: on a
 * curve the chord is a line between two points the outline only touches, so
 * squaring to it squares to nothing the drawing contains. What a right angle at
 * a corner means is a right angle with the tangent there.
 *
 * Only through neighbours of what is moving, and only the segments beyond them:
 * every point in the glyph offering two rays would be hundreds of lines at every
 * angle, and something would always be within reach.
 *
 * A dragged *handle* is offered lines of its own, through the node it belongs
 * to — see {@link handleRays}. A handle is a direction rather than a place, and
 * the directions worth having are about the node it leaves.
 */
function outlineRays(state: EditorState, glyph: Glyph, moving: Selection): SnapRay[] {
  const out: SnapRay[] = [];
  const held = new Set(moving.map((item) => `${item.contourId} ${item.nodeId}`));
  const lean = state.document.info.italicAngle;

  for (const item of moving) {
    const c = contourById(glyph, item.contourId);
    if (c === null) continue;

    const index = c.nodes.findIndex((n) => n.id === item.nodeId);
    if (index < 0) continue;

    if (item.part !== "point") {
      out.push(...handleRays(c, index, item.part, lean));
      continue;
    }

    for (const step of [-1, 1] as const) {
      const neighbour = stepAround(c, index, step);
      if (neighbour === null || held.has(`${c.id} ${neighbour.id}`)) continue;

      // The segment on the far side of the neighbour: the one the drag is not
      // holding, and so the one worth being square or parallel to.
      const beyond = stepAround(c, c.nodes.indexOf(neighbour), step);
      if (beyond !== null) {
        const along = leavingBy(neighbour, beyond, step);
        const reach = Math.hypot(along.x, along.y);
        if (reach > 0) {
          const unit = { x: along.x / reach, y: along.y / reach };
          out.push({
            through: neighbour.pt,
            direction: { x: -unit.y, y: unit.x },
            source: "extreme",
          });
          out.push({ through: neighbour.pt, direction: unit, source: "extreme" });
        }
      }

      if (lean !== 0) {
        out.push({
          through: neighbour.pt,
          direction: alongDegrees(90 + lean),
          source: "neighbour",
        });
      }
    }
  }

  return out;
}

/**
 * The lines a dragged handle is offered, through the node it belongs to.
 *
 * A handle is a direction: where it lands says how the curve leaves the node,
 * and the questions worth asking are about that angle rather than about where
 * the point sits. So the lines all pass through the node itself, and landing on
 * one sets the angle exactly however far out the handle is pulled.
 *
 * **Square to the other side** is the right angle a corner is built from: the
 * curve leaves at ninety degrees to whatever the node's other segment does,
 * which is how a bowl meets a stem. **Along it** is the same line turned, which
 * is what makes a corner smooth by hand. And the **italic angle** with its
 * perpendicular, which on a leaning design are what upright and level are on an
 * upright one.
 *
 * The node's own x and y are already offered as a neighbour line, so a handle
 * has always been able to land exactly upright or exactly level. These are the
 * angles between.
 */
function handleRays(c: Contour, index: number, part: "in" | "out", lean: number): SnapRay[] {
  const n = c.nodes[index];
  if (n === undefined) return [];

  const out: SnapRay[] = [];
  // The segment on the node's *other* side: the one the drag is not holding.
  const step = part === "out" ? -1 : 1;
  const beyond = stepAround(c, index, step);
  if (beyond !== null) {
    const along = leavingBy(n, beyond, step);
    const reach = Math.hypot(along.x, along.y);
    if (reach > 0) {
      const unit = { x: along.x / reach, y: along.y / reach };
      out.push({ through: n.pt, direction: { x: -unit.y, y: unit.x }, source: "extreme" });
      out.push({ through: n.pt, direction: unit, source: "extreme" });
    }
  }

  if (lean !== 0) {
    const leaning = alongDegrees(90 + lean);
    out.push({ through: n.pt, direction: leaning, source: "neighbour" });
    out.push({
      through: n.pt,
      direction: { x: -leaning.y, y: leaning.x },
      source: "neighbour",
    });
  }

  return out;
}

/**
 * The direction a segment leaves `from` by, on its way to `to`.
 *
 * The handle that shapes it, where there is one: a curve leaves its node along
 * its handle, and that is the direction a right angle at that node is a right
 * angle to. The chord otherwise, which is exactly the direction of a straight
 * segment and the best available guess for a curve whose handle is retracted
 * onto its own node.
 *
 * Which handle depends on which way round the contour the segment runs: going
 * forwards it leaves by `out`, and backwards by `in`.
 */
function leavingBy(from: Node, to: Node, step: -1 | 1): Vec2 {
  const handle = step === 1 ? from.out : from.in;
  const at = handle ?? to.pt;
  return { x: at.x - from.pt.x, y: at.y - from.pt.y };
}

/** The node one step around a contour, or `null` past the end of an open one. */
function stepAround(c: Contour, index: number, step: -1 | 1): Node | null {
  const next = index + step;
  if (next >= 0 && next < c.nodes.length) return c.nodes[next] ?? null;
  if (!c.closed) return null;
  return (step === 1 ? c.nodes[0] : c.nodes[c.nodes.length - 1]) ?? null;
}

export type GestureOptions = {
  /**
   * Land drags on the drawn lines, and on whole units otherwise. On by default:
   * a font is written in whole units, and an editor that quietly produced
   * fractional ones would be lying about what it is making.
   */
  readonly snap?: boolean;
  /** Catch radius in screen pixels. */
  readonly snapPixels?: number;
  /** How far a caught line may stray before it lets go, in screen pixels. */
  readonly snapStayPixels?: number;
  /** How much nearer a rival line must be to take a caught one's place. */
  readonly snapStickiness?: number;
  /**
   * Also catch on the glyph's own points, each on both of its axes: the nearest
   * coordinate wins, whichever point it belongs to.
   *
   * Off until these lines are drawn. See {@link snappingFor}.
   */
  readonly snapPoints?: boolean;
};

/**
 * How each gesture follows the pointer.
 *
 * A mapped type over the gesture union, so a new kind cannot be added without
 * one — which is exactly the drift this replaces. Each is handed the state with
 * the cursor already updated and the offset from where the drag began.
 */
type Continuations = {
  [K in Gesture["kind"]]: (
    state: EditorState,
    gesture: Extract<Gesture, { kind: K }>,
    input: PointerInput,
    delta: Vec2,
    options: GestureOptions,
  ) => EditorState;
};

/** Whether the pointer has actually gone anywhere since the press. */
const budged = (delta: Vec2): boolean => delta.x !== 0 || delta.y !== 0;

/**
 * The directions a held drag may be projected onto.
 *
 * Upright and level always, because they are what a drawing is measured
 * against. The font's italic angle and its perpendicular, because on a slanted
 * design those *are* upright and level: a stem runs along one and its ends are
 * cut along the other, and holding a drag to the page's axes is no help at all.
 * And the straight segment under the drag, both along it and across it, which
 * is what a stem asks for: slide the point along the line it is on, or move the
 * whole line sideways by its own thickness.
 *
 * Each direction is a line rather than an arrow: the projection keeps the sign
 * the cursor gave it, so one entry serves both ways along it.
 */
function heldDirections(state: EditorState, started: Glyph, moving: Selection): Vec2[] {
  const out: Vec2[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];

  const lean = state.document.info.italicAngle;
  if (lean !== 0) {
    // Counter-clockwise from upright, so an italic's stems lean the way the
    // angle says and the cut across them is perpendicular to that.
    const radians = (lean * Math.PI) / 180;
    const along = { x: -Math.sin(radians), y: Math.cos(radians) };
    out.push(along, { x: along.y, y: -along.x });
  }

  for (const line of straightSides(started, moving)) {
    const reach = Math.hypot(line.x, line.y);
    if (reach === 0) continue;
    const unit = { x: line.x / reach, y: line.y / reach };
    out.push(unit, { x: -unit.y, y: unit.x });
  }

  return out;
}

/**
 * The straight segments the drag is holding on to, as directions.
 *
 * A whole segment being moved — both its ends — gives the segment itself; a
 * single point gives every straight side it has, so a stem's corner can be slid
 * along either of the lines meeting there. A curve gives nothing: "along the
 * curve" is not a direction, it is a path.
 */
function straightSides(g: Glyph, moving: Selection): Vec2[] {
  const points = moving.filter((item) => item.part === "point");
  if (points.length === 0 || points.length > 2) return [];

  const out: Vec2[] = [];
  for (const c of g.contours) {
    const here = points.filter((item) => item.contourId === c.id);
    if (here.length === 0) continue;

    for (const segment of segments(c)) {
      if (segment.kind !== "line") continue;
      const ends = [segment.fromId, segment.toId];
      const held = here.filter((item) => ends.includes(item.nodeId)).length;
      // One end held: the point slides along the line. Both: the line moves as
      // a body, and along itself is as useful as across it.
      if (held === 0) continue;
      if (points.length === 2 && held === 1) continue;
      out.push({ x: segment.b.x - segment.a.x, y: segment.b.y - segment.a.y });
    }
  }
  return out;
}

/** The offset, held to whichever of `directions` keeps most of it. */
function heldTo(delta: Vec2, directions: readonly Vec2[], grid: number): Vec2 {
  let best: Vec2 | null = null;
  let kept = -1;

  for (const d of directions) {
    const along = delta.x * d.x + delta.y * d.y;
    if (Math.abs(along) <= kept) continue;
    kept = Math.abs(along);
    // Quantised along the direction rather than per axis: a diagonal held to
    // whole units in x and y is not whole units along itself.
    const length = grid > 0 ? Math.round(along / grid) * grid : along;
    best = { x: d.x * length, y: d.y * length };
  }

  return best ?? { x: 0, y: 0 };
}

const CONTINUE: Continuations = {
  dragSelection: (state, gesture, input, delta, options) => {
    // Measured against the glyph as it was when the drag began: the offsets are
    // from those positions, so snapping has to ask where they started rather
    // than where the last frame left them — and the lines to catch on have to be
    // where they started too, or the drag would tow its own candidates along.
    const started = glyphIn(gesture.before, state) ?? EMPTY_GLYPH;
    const snapping = snappingFor(state, input, options, started, gesture.items);

    // Shift holds the drag to a direction, and the direction wins: a point held
    // along a stem must stay on it, and a line it happened to pass near is not
    // a better answer than the one being asked for. The grid still applies,
    // measured along the direction rather than per axis.
    const snapped = input.modifiers.shift
      ? {
          delta: heldTo(delta, heldDirections(state, started, gesture.items), snapping.grid),
          hold: NO_HOLD,
        }
      : snapDelta(selectionPoints(started, gesture.items), delta, snapping, gesture.snapped);

    const document = updateGlyphInLayer(gesture.before, state.currentGlyph, state.layer, (g) =>
      translateSelection(g, gesture.items, snapped.delta),
    );
    return {
      ...state,
      document: document ?? gesture.before,
      gesture: { ...gesture, moved: gesture.moved || budged(delta), snapped: snapped.hold },
    };
  },

  dragHandle: (state, gesture, input, delta, options) => {
    const started = glyphIn(gesture.before, state) ?? EMPTY_GLYPH;
    const moving: Selection = [
      { contourId: gesture.contourId, nodeId: gesture.nodeId, part: gesture.part },
    ];
    const snapping = snappingFor(state, input, options, started, moving);

    // A handle is placed at the cursor rather than offset from where it was, so
    // it is the position that snaps. A smooth node then swings its other handle
    // to match, which is the point: the snapped side is the one being aimed.
    const snapped = snapPoint(input.point, snapping, gesture.snapped);
    const document = updateGlyphInLayer(gesture.before, state.currentGlyph, state.layer, (g) =>
      updateContour(g, gesture.contourId, (c) =>
        setHandle(c, gesture.nodeId, gesture.part, snapped.point, gesture.breakSmooth),
      ),
    );
    return {
      ...state,
      document: document ?? gesture.before,
      gesture: { ...gesture, moved: gesture.moved || budged(delta), snapped: snapped.hold },
    };
  },

  dragComponent: (state, gesture, input, delta, options) => {
    // Only the grid and the font's own lines: the outlines a component draws
    // belong to another glyph, so there is nothing of *this* drawing for them
    // to line up with except the metrics — and an accent lining itself up with
    // the letter under it is what anchors are for.
    const started = glyphIn(gesture.before, state) ?? EMPTY_GLYPH;
    const snapping = snappingFor(state, input, options, started, []);
    const snapped = snapDelta([gesture.origin], delta, snapping, gesture.snapped);

    const document = updateGlyphInLayer(gesture.before, state.currentGlyph, state.layer, (g) =>
      updateGlyphComponent(g, gesture.componentId, (c) =>
        movedComponent(c, snapped.delta.x, snapped.delta.y),
      ),
    );
    return {
      ...state,
      document: document ?? gesture.before,
      gesture: { ...gesture, moved: gesture.moved || budged(delta), snapped: snapped.hold },
    };
  },

  dragAnchor: (state, gesture, input, delta, options) => {
    // Snapped like a node, and against the same lines: an anchor is placed
    // relative to the drawing — the middle of a letter, the height its accents
    // sit at — so the stem edges and metric lines are exactly what it wants.
    const started = glyphIn(gesture.before, state) ?? EMPTY_GLYPH;
    const snapping = snappingFor(state, input, options, started, []);
    const snapped = snapPoint(input.point, snapping, gesture.snapped);

    const document = updateGlyphInLayer(gesture.before, state.currentGlyph, state.layer, (g) =>
      moveAnchorTo(g, gesture.anchorId, snapped.point),
    );
    return {
      ...state,
      document: document ?? gesture.before,
      gesture: { ...gesture, moved: gesture.moved || budged(delta), snapped: snapped.hold },
    };
  },

  dragGuide: (state, gesture, input, delta, options) => {
    // Snapped like an anchor and against the same lines. A guide is placed
    // against the drawing — level with an overshoot, up the edge of a stem —
    // which is exactly what those lines are.
    const started = glyphIn(gesture.before, state) ?? EMPTY_GLYPH;
    const snapping = snappingFor(state, input, options, started, [], gesture.guideId);
    const snapped = snapPoint(input.point, snapping, gesture.snapped);

    const moved = movedGuideIn(
      { ...state, document: gesture.before },
      gesture.guideId,
      snapped.point,
    );

    return {
      ...state,
      document: moved ?? gesture.before,
      gesture: { ...gesture, moved: gesture.moved || budged(delta), snapped: snapped.hold },
    };
  },

  dragTunniPoint: (state, gesture, input, delta) =>
    continueTunni(state, gesture, input, delta, setSegmentTunniPoint),

  dragTunniLine: (state, gesture, input, delta) =>
    continueTunni(state, gesture, input, delta, moveSegmentTunniLine),

  dragMargin: (state, gesture, input, delta, options) => {
    // Only the grid applies: an advance is a measurement, not a position, and
    // there is nothing on that axis for it to line up with yet.
    const snapping = snappingFor(state, input, options, EMPTY_GLYPH, []);

    // The origin line cannot itself move — it *is* x = 0. Dragging it means
    // "put this much space before the glyph", so the outline follows the cursor
    // and the advance grows with it, holding the right sidebearing. The advance
    // line does move, and changes the advance alone.
    const document =
      gesture.side === "advance"
        ? updateGlyphInLayer(gesture.before, state.currentGlyph, state.layer, (g) => ({
            ...g,
            // The measurement itself is rounded, not the offset: an advance is a
            // number someone will read in a field, and it should be whole even
            // when the one it started from was not.
            advance: Math.max(0, toGrid(gesture.startAdvance + delta.x, snapping)),
          }))
        : gesture.startLeft === null
          ? null
          : updateGlyphInLayer(gesture.before, state.currentGlyph, state.layer, (g) =>
              setLeftSidebearing(
                g,
                toGrid((gesture.startLeft ?? 0) + delta.x, snapping),
                gesture.before,
              ),
            );

    return {
      ...state,
      document: document ?? gesture.before,
      gesture: { ...gesture, moved: gesture.moved || budged(delta) },
    };
  },

  transformBox: (state, gesture, input, delta) => {
    const { shift, alt } = input.modifiers;
    const pivot = boxPivot(gesture.box, gesture.handle, alt);

    // Shift means "hold the shape" on a scale and "hold the angle" on a turn,
    // which are the same instruction read against what is being changed.
    let transform;
    let boxFrame = state.boxFrame;
    if (gesture.handle.action === "rotate") {
      const turned = boxTurn(gesture.box, gesture.handle, pivot, input.point, shift);
      transform = rotation(turned);
      // Measured from the angle the box was at when the drag began, for the same
      // reason the points are: a running total would drift over a long turn.
      boxFrame = { angle: gesture.box.angle + turned, of: gesture.items };
    } else {
      const by = boxScale(gesture.box, gesture.handle, pivot, input.point, shift);
      if (!Number.isFinite(by.x) || !Number.isFinite(by.y)) return state;
      // Along the box's own axes rather than the plane's, so a handle on a
      // turned box pulls the way it points.
      transform = boxScaleTransform(gesture.box, by);
    }

    // From the document as it was when the drag began, so the answer depends on
    // where the pointer is rather than on the path it took to get there.
    const document = transformedDocument(
      gesture.before,
      state.currentGlyph,
      gesture.items,
      about(transform, pivot),
      !keepsAxes(transform),
      state.layer,
    );

    return {
      ...state,
      document: document ?? gesture.before,
      boxFrame,
      gesture: { ...gesture, moved: gesture.moved || budged(delta) },
    };
  },

  marquee: (state, gesture, input) => {
    const inside = itemsInRect(
      currentGlyph(state) ?? EMPTY_GLYPH,
      rectOf(gesture.origin, input.point),
    );
    return {
      ...state,
      selection: gesture.additive ? addItems(gesture.before, inside) : inside,
      gesture: { ...gesture, current: input.point, moved: true },
    };
  },
};

/**
 * The two Tunni drags, which differ only in which kernel function they call.
 *
 * The kernel refuses a move that would pull a handle through its anchor. Holding
 * the last good geometry is the right answer: the drag continues, and the curve
 * simply stops following until the cursor comes back.
 */
function continueTunni(
  state: EditorState,
  gesture: Extract<Gesture, { kind: "dragTunniPoint" | "dragTunniLine" }>,
  input: PointerInput,
  delta: Vec2,
  apply: (c: Parameters<typeof setSegmentTunniPoint>[0], index: number, p: Vec2) => unknown,
): EditorState {
  const next = updateGlyphInLayer(gesture.before, state.currentGlyph, state.layer, (g) =>
    updateContour(
      g,
      gesture.segment.contourId,
      (c) =>
        apply(c, gesture.segment.segmentIndex, input.point) as ReturnType<
          typeof setSegmentTunniPoint
        >,
    ),
  );
  return {
    ...state,
    document: next ?? state.document,
    gesture: { ...gesture, moved: gesture.moved || (next !== null && budged(delta)) },
  };
}

/** Carry a gesture on, whichever it is. */
export function continueGesture(
  state: EditorState,
  gesture: Gesture,
  input: PointerInput,
  options: GestureOptions = {},
): EditorState {
  const delta = sub(input.point, gesture.origin);
  // One cast, in one place: TypeScript cannot see that the key and the gesture
  // narrow together, though the table's type guarantees they do.
  const carry = CONTINUE[gesture.kind] as (
    s: EditorState,
    g: Gesture,
    i: PointerInput,
    d: Vec2,
    o: GestureOptions,
  ) => EditorState;
  return carry({ ...state, cursor: input.point }, gesture, input, delta, options);
}
