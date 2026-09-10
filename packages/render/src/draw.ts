import { type Vec2, handleIntersection } from "@typewright/geometry";
import {
  type Guide,
  guideDirection,
  type Contour,
  type Glyph,
  type Node,
  type Segment,
  segmentCubic,
  filledContours,
  segmentTunniPoint,
  segmentTunniStatus,
  segments,
} from "@typewright/font-model";
import {
  type HandleVisibility,
  type SegmentRef,
  type ViewTransform,
  BOX_ANCHORS,
  BOX_STEM_PIXELS,
  boxHandlePoint,
  boxRotatePoint,
  handleIsVisible,
  sameSegment,
  screenTolerance,
  selectedKeys,
  selectionKey,
  toScreen,
} from "@typewright/view";

import type { Canvas2D } from "./context.js";
import type { RenderPalette } from "./palette.js";
import type { Scene } from "./scene.js";

const TAU = Math.PI * 2;

/**
 * Draw one frame.
 *
 * Layer order is the whole of the design, and it is not arbitrary: the filled
 * body goes down before the outline so the outline reads as an edge; controls go
 * on top of both so they are never buried under the fill; and on-curve nodes go
 * last of all, because they are what the eye needs to find first.
 */
export function drawScene(ctx: Canvas2D, s: Scene): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  clearBackground(ctx, s);
  // Under everything, because it is what everything else is drawn against.
  drawTracingImage(ctx, s);
  drawMetricLines(ctx, s);
  drawDesignGuides(ctx, s);
  // Neighbours and margins sit under the glyph being edited: they are context,
  // and context that draws over your work is a distraction rather than a help.
  drawNeighbours(ctx, s);
  if (s.options.margins) drawMargins(ctx, s);
  drawComponents(ctx, s);
  // Under the drawing: the instance is what the design says happens at another
  // weight, and the thing being edited has to stay on top of it.
  drawInstance(ctx, s);
  if (s.options.showFilledPreview) drawFilledPreview(ctx, s);
  drawOutline(ctx, s);

  // Under the controls and over the outline: it is a reading of the shape, and
  // it must not hide the points that change it.
  drawCurvatureComb(ctx, s);

  if (s.options.showControls) {
    // Under the controls, so a node is never hidden by the guide pointing at it
    // — and the ring is wider than a node, so it reads as a halo rather than a
    // thing in its own right.
    drawSnapGuides(ctx, s);
    drawTunniControls(ctx, s);
    drawHandles(ctx, s);
    drawNodes(ctx, s);
    drawAnchors(ctx, s);
    drawPenPreview(ctx, s);
    drawShapePreview(ctx, s);
    drawKnifeStroke(ctx, s);
    drawMeasurement(ctx, s);
    drawSection(ctx, s);
    drawTransformBox(ctx, s);
    drawMarquee(ctx, s);
  }

  ctx.restore();
}

export function clearBackground(ctx: Canvas2D, s: Scene): void {
  ctx.clearRect(0, 0, s.viewport.width, s.viewport.height);
  ctx.fillStyle = s.palette.background;
  ctx.beginPath();
  ctx.rect(0, 0, s.viewport.width, s.viewport.height);
  ctx.fill();
}

/** How near two labels may come, in pixels, before the lower one is dropped. */
const LABEL_CLEARANCE = 16;

export function drawMetricLines(ctx: Canvas2D, s: Scene): void {
  ctx.lineWidth = 1;
  const drawn: number[] = [];

  for (const guide of s.metricLines) {
    // Half-pixel offset so a one-pixel line lands on a pixel rather than
    // straddling two and rendering as a soft two-pixel smear.
    const y = Math.round(toScreen(s.view, { x: 0, y: guide.y }).y) + 0.5;
    ctx.strokeStyle = guide.emphasis === true ? s.palette.guideEmphasis : s.palette.guide;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(s.viewport.width, y);
    ctx.stroke();

    if (guide.label === undefined) continue;

    // Two lines at the same height — a cap height set to the ascender, a
    // zoomed-out view where everything is within a few pixels — would print
    // their names on top of each other, which is less legible than one name.
    // The first one wins, and `metricLines` puts the baseline first.
    if (drawn.some((at) => Math.abs(at - y) < LABEL_CLEARANCE)) continue;
    drawn.push(y);

    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = s.palette.guideLabel;
    // Above the line and inset from the left edge, where the drawing is not:
    // a name sitting on the outline would be one more thing to read past.
    ctx.fillText(guide.label, 6, y - 3);
  }
}

/**
 * A weight nobody drew, worked out between the masters.
 *
 * Filled faintly rather than stroked. An outline drawn in a second colour reads
 * as another shape to edit — there are already handles, controls and a comb on
 * this canvas — where a wash of colour reads as what it is: where the letter
 * goes at a weight you are not drawing.
 */
export function drawInstance(ctx: Canvas2D, s: Scene): void {
  if (s.instance.length === 0) return;

  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = s.palette.instance;
  ctx.beginPath();
  for (const c of s.instance.filter((c) => c.closed && c.nodes.length >= 2)) {
    traceContour(ctx, s.view, c);
  }
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

/**
 * The picture the glyph is being traced from.
 *
 * The transform is composed rather than the corners being projected, because a
 * placement may shear and a sheared rectangle is not a rectangle — projecting
 * its corners and drawing into the box they bound would quietly straighten the
 * picture. So the canvas is given the whole transform and asked to draw the
 * image at its natural size into it.
 *
 * Three transforms in a row, which is why this is worth writing out. Image
 * pixels have their origin at the bottom left and y running up; the canvas has
 * it at the top left with y running down; and between them sits the placement
 * the designer chose and the camera the editor is looking through.
 */
export function drawTracingImage(ctx: Canvas2D, s: Scene): void {
  const image = s.image;
  if (image === null || image.opacity <= 0) return;

  const t = image.transform;
  const view = s.view;

  ctx.save();
  ctx.globalAlpha = image.opacity;

  // The camera: design units to screen pixels, with y flipped.
  const origin = toScreen(view, { x: 0, y: 0 });
  ctx.translate(origin.x, origin.y);
  ctx.transform(view.scale, 0, 0, -view.scale, 0, 0);

  // The placement, in design units.
  ctx.transform(t.xScale, t.xyScale, t.yxScale, t.yScale, t.xOffset, t.yOffset);

  // And the picture's own flip: its rows run down from the top, where
  // everything above this runs up from the bottom.
  ctx.transform(1, 0, 0, -1, 0, image.height);
  ctx.drawImage(image.bitmap, 0, 0, image.width, image.height);

  ctx.restore();
  ctx.globalAlpha = 1;
}

/**
 * The lines the designer put there.
 *
 * Drawn after the metric lines and before the outline: they belong to the same
 * layer of the picture — things to draw against rather than things drawn — and
 * they must never be mistaken for ink.
 *
 * A guide is infinite, so what is drawn is where it crosses the viewport. The
 * arithmetic is the same for every angle, which is why an angle is stored
 * rather than a kind: a vertical guide is not a special case here.
 */
export function drawDesignGuides(ctx: Canvas2D, s: Scene): void {
  if (s.guides.length === 0) return;

  for (const { guide, scope } of s.guides) {
    const span = acrossViewport(s, guide);
    if (span === null) continue;

    const selected = guide.id === s.selectedGuide;
    const hovered = guide.id === s.hoveredGuide;
    ctx.strokeStyle = selected || hovered ? s.palette.designGuideSelected : s.palette.designGuide;
    ctx.lineWidth = selected ? 1.5 : 1;

    // A font's guide is dashed and a glyph's is solid: the font's are in every
    // glyph, so they are the background of the work rather than part of it.
    ctx.setLineDash(scope === "font" ? [6, 4] : []);
    ctx.beginPath();
    ctx.moveTo(span[0].x, span[0].y);
    ctx.lineTo(span[1].x, span[1].y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (guide.name === "") continue;
    label(ctx, s, guide, span);
  }
}

/** The name, laid along the line at the end it leaves the viewport by. */
function label(ctx: Canvas2D, s: Scene, guide: Guide, span: readonly [Vec2, Vec2]): void {
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = s.palette.guideLabel;
  ctx.textBaseline = "alphabetic";

  // Along the line, reading left to right whichever way the line runs: a name
  // upside down is a name nobody reads.
  const [from, to] = span[0].x <= span[1].x ? span : [span[1], span[0]];
  const angle = Math.atan2(to.y - from.y, to.x - from.x);

  ctx.save();
  ctx.translate(from.x, from.y);
  ctx.rotate(angle);
  ctx.textAlign = "left";
  ctx.fillText(guide.name, 8, -4);
  ctx.restore();
}

/**
 * Where a guide crosses the viewport, or `null` when it does not.
 *
 * Both edges rather than a long segment through the middle: a line drawn from
 * far outside the viewport to far outside it is the same picture and much more
 * arithmetic for the canvas to clip.
 */
function acrossViewport(s: Scene, guide: Guide): readonly [Vec2, Vec2] | null {
  const on = toScreen(s.view, guide.pt);
  const d = guideDirection(guide);
  // Screen y runs the other way from design y, so the direction flips with it.
  const dir = { x: d.x, y: -d.y };

  const { width, height } = s.viewport;
  const hits: Vec2[] = [];

  if (Math.abs(dir.x) > 1e-9) {
    for (const x of [0, width]) {
      const t = (x - on.x) / dir.x;
      const y = on.y + dir.y * t;
      if (y >= -1 && y <= height + 1) hits.push({ x, y });
    }
  }
  if (Math.abs(dir.y) > 1e-9) {
    for (const y of [0, height]) {
      const t = (y - on.y) / dir.y;
      const x = on.x + dir.x * t;
      if (x >= -1 && x <= width + 1) hits.push({ x, y });
    }
  }

  if (hits.length < 2) return null;
  const [one, two] = hits;
  return one === undefined || two === undefined ? null : [one, two];
}

/**
 * The lines the drag in progress is caught on.
 *
 * Dashed, where the metric lines are solid: over a metric line the dashes read
 * as that line being live, and away from one they read as a line that exists
 * only for as long as the drag does. A ring marks the point that produced it,
 * which is the half a bare rule cannot say — a coordinate on its own tells you
 * the drag caught something, not what.
 */
export function drawSnapGuides(ctx: Canvas2D, s: Scene): void {
  if (s.snapGuides.length === 0) return;

  ctx.save();
  ctx.strokeStyle = s.palette.snapGuide;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  for (const guide of s.snapGuides) {
    ctx.beginPath();
    if (guide.axis === "x") {
      // Half-pixel offset, as the metric lines take, so a one-pixel line lands
      // on a pixel instead of smearing across two.
      const x = Math.round(toScreen(s.view, { x: guide.at, y: 0 }).x) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, s.viewport.height);
    } else {
      const y = Math.round(toScreen(s.view, { x: 0, y: guide.at }).y) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(s.viewport.width, y);
    }
    ctx.stroke();
  }

  ctx.setLineDash([]);
  for (const guide of s.snapGuides) {
    if (guide.from === null) continue;
    const p = toScreen(s.view, guide.from);
    ctx.beginPath();
    ctx.arc(p.x, p.y, s.metrics.nodeRadius + 3, 0, TAU);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * The translucent glyph body.
 *
 * Only closed contours are filled. An open contour has no interior, and the
 * canvas would invent one by joining its ends — which is exactly the kind of
 * confident nonsense a designer should never have to second-guess.
 */
export function drawFilledPreview(ctx: Canvas2D, s: Scene): void {
  const closed = s.filled.filter((c) => c.closed && c.nodes.length >= 2);
  if (closed.length === 0) return;

  ctx.beginPath();
  for (const c of closed) traceContour(ctx, s.view, c);
  ctx.fillStyle = s.palette.fill;
  ctx.fill();
}

export function drawOutline(ctx: Canvas2D, s: Scene): void {
  const drawable = s.glyph.contours.filter((c) => c.nodes.length >= 2);
  if (drawable.length === 0) return;

  ctx.beginPath();
  for (const c of drawable) traceContour(ctx, s.view, c);
  ctx.strokeStyle = s.palette.outline;
  ctx.lineWidth = s.metrics.outlineWidth;
  ctx.stroke();
}

/**
 * Tunni line and Tunni point, for every segment currently showing them.
 *
 * Usually one, sometimes two: the segment under the cursor and the segment being
 * worked on. Keeping the focused one visible is what stops a control from being
 * confiscated the moment the cursor drifts nearer to something else — dragging a
 * counter's Tunni point out over the outer contour, for instance.
 *
 * The line shows for anything but a flat or degenerate segment, including a
 * crossed one — dragging it there is refused by the kernel, which is better than
 * having the target vanish from under the cursor. The point shows only when it
 * is well defined, and when it is not it is simply absent: no dimmed ghost, no
 * explanation.
 */
export function drawTunniControls(ctx: Canvas2D, s: Scene): void {
  const drawn: SegmentRef[] = [];
  for (const ref of s.tunniSegments) {
    // The hovered and focused segments are often the same one; drawing it twice
    // would double the Tunni line's alpha and make it look selected.
    if (drawn.some((already) => sameSegment(already, ref))) continue;
    drawn.push(ref);
    drawTunniControlsFor(ctx, s, ref);
  }
}

function drawTunniControlsFor(ctx: Canvas2D, s: Scene, ref: SegmentRef): void {
  const c = s.glyph.contours.find((candidate) => candidate.id === ref.contourId);
  if (c === undefined) return;

  const found = segments(c).find((seg) => seg.index === ref.segmentIndex);
  if (found === undefined || found.kind === "line") return;

  const status = segmentTunniStatus(c, ref.segmentIndex);
  if (status === null) return;

  if (s.options.showHandleIntersection) {
    drawHandleIntersection(ctx, s, found);
  }

  if (status !== "flat" && status !== "degenerate" && found.out !== null && found.in !== null) {
    const from = toScreen(s.view, found.out);
    const to = toScreen(s.view, found.in);
    ctx.strokeStyle = s.palette.tunniLine;
    ctx.lineWidth = s.metrics.tunniLineWidth;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (status === "ok") {
    const tunni = segmentTunniPoint(c, ref.segmentIndex);
    if (tunni !== null) {
      const p = toScreen(s.view, tunni);
      haloedDisc(ctx, s, p, s.metrics.tunniPointRadius, s.palette.tunniPoint);
    }
  }
}

function drawHandleIntersection(ctx: Canvas2D, s: Scene, segment: Segment): void {
  const cubic = segmentCubic(segment);
  const intersection = handleIntersection(cubic);
  if (intersection === null) return;

  const a = toScreen(s.view, cubic.a);
  const b = toScreen(s.view, cubic.b);
  const is = toScreen(s.view, intersection);

  ctx.strokeStyle = s.palette.intersection;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(is.x, is.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = s.palette.intersection;
  ctx.beginPath();
  ctx.arc(is.x, is.y, 2.5, 0, TAU);
  ctx.fill();
}

/**
 * Handles, and the hairlines tethering them to their anchors.
 *
 * Every handle in the glyph, not just the awake segment's — a handle is how you
 * shape a curve directly, and hiding them behind a hover would make ordinary
 * drawing feel furtive. Only the Tunni controls come and go.
 */
/** What the scene's options and awake set mean for handle visibility. */
export function handleVisibility(s: Scene): HandleVisibility {
  return {
    autoHide: s.options.autoHideHandles,
    awake: s.tunniSegments,
    selection: s.selection,
  };
}

export function drawHandles(ctx: Canvas2D, s: Scene): void {
  const chosen = selectedKeys(s.selection);
  const visibility = handleVisibility(s);

  for (const c of s.glyph.contours) {
    for (const [nodeIndex, n] of c.nodes.entries()) {
      const anchor = toScreen(s.view, n.pt);
      for (const part of ["in", "out"] as const) {
        const handle = part === "in" ? n.in : n.out;
        if (handle === null) continue;
        if (!handleIsVisible(c, nodeIndex, part, visibility)) continue;
        const p = toScreen(s.view, handle);
        const isChosen = chosen.has(selectionKey({ contourId: c.id, nodeId: n.id, part }));

        ctx.strokeStyle = s.palette.handleLine;
        ctx.lineWidth = s.metrics.handleLineWidth;
        ctx.beginPath();
        ctx.moveTo(anchor.x, anchor.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();

        // A handle stays hollow whether or not it is selected; selection shows
        // as a heavier ring in the selected colour. Keeping fill to mean
        // "on-curve" is worth more than using it to mean "selected" — a filled
        // handle would be indistinguishable from a selected smooth node, which
        // is also a filled circle of nearly the same size.
        ctx.beginPath();
        ctx.arc(p.x, p.y, s.metrics.handleRadius, 0, TAU);
        ctx.fillStyle = s.palette.halo;
        ctx.fill();
        ctx.strokeStyle = isChosen ? s.palette.handleSelected : s.palette.handle;
        ctx.lineWidth = s.metrics.handleLineWidth + (isChosen ? 1.6 : 0.4);
        ctx.stroke();

        if (n.hvLock[part]) drawLockBar(ctx, s, anchor, p);
      }
    }
  }
}

/**
 * The mark on a handle that is held to an axis.
 *
 * A short bar through the handle, running along the axis it is locked to: the
 * line the handle may slide on, drawn as a line. The half towards the anchor
 * lies over the tether and adds nothing; the half beyond the handle is the mark,
 * and reads as the axis carrying on past where the handle happens to sit.
 *
 * Drawn in the handle's own colour, so a locked handle that is also selected
 * still reads as selected.
 */
function drawLockBar(ctx: Canvas2D, s: Scene, anchor: Vec2, handle: Vec2): void {
  const dx = handle.x - anchor.x;
  const dy = handle.y - anchor.y;
  const reach = Math.hypot(dx, dy);
  // A handle sitting on its anchor has no direction to run along.
  if (reach < 0.001) return;

  const arm = s.metrics.handleRadius * 1.8;
  const ax = (dx / reach) * arm;
  const ay = (dy / reach) * arm;

  ctx.beginPath();
  ctx.moveTo(handle.x - ax, handle.y - ay);
  ctx.lineTo(handle.x + ax, handle.y + ay);
  ctx.stroke();
}

/**
 * The shape a drag would make, dashed for the reason the pen's band is: it is a
 * proposal, and until the button comes up there is nothing in the glyph.
 */
export function drawShapePreview(ctx: Canvas2D, s: Scene): void {
  const preview = s.shapePreview;
  if (preview === null || preview.nodes.length < 2) return;

  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = s.palette.marqueeStroke;
  ctx.lineWidth = s.metrics.outlineWidth - 0.5;
  ctx.beginPath();
  traceContour(ctx, s.view, preview);
  ctx.stroke();
  ctx.restore();
}

/**
 * The measurement: the span, a tick at each end, and the number beside it.
 *
 * Ticks rather than arrowheads, and square to the span, because what is being
 * shown is where the two edges are — an arrow would say "this direction", and
 * the direction is not the point. The number sits clear of the line on the side
 * the span leans away from, so it never lies along what it is labelling.
 */
export function drawMeasurement(ctx: Canvas2D, s: Scene): void {
  const m = s.measurement;
  if (m === null) return;

  const a = toScreen(s.view, m.from);
  const b = toScreen(s.view, m.to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const reach = Math.hypot(dx, dy);
  if (reach < 0.5) return;

  const ux = dx / reach;
  const uy = dy / reach;
  const tick = 5;

  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = s.palette.nodeSelected;
  ctx.lineWidth = m.pinned ? 1.5 : 1;

  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  // A tick across each end, square to the span.
  ctx.moveTo(a.x - uy * tick, a.y + ux * tick);
  ctx.lineTo(a.x + uy * tick, a.y - ux * tick);
  ctx.moveTo(b.x - uy * tick, b.y + ux * tick);
  ctx.lineTo(b.x + uy * tick, b.y - ux * tick);
  ctx.stroke();

  const label = String(Math.round(m.distance * 10) / 10);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // Clear of the line rather than on it, on whichever side keeps it upright.
  const off = 10;
  const nx = -uy * (uy > 0 ? -1 : 1);
  const ny = ux * (uy > 0 ? -1 : 1);

  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = s.palette.halo;
  // A halo behind it, so a number over a filled shape stays readable.
  ctx.lineWidth = 3;
  ctx.strokeStyle = s.palette.halo;
  ctx.strokeText(label, mid.x + nx * off, mid.y + ny * off);
  ctx.fillStyle = s.palette.nodeSelected;
  ctx.fillText(label, mid.x + nx * off, mid.y + ny * off);

  ctx.restore();
}

/**
 * The knife's stroke.
 *
 * Solid where the other previews are dashed, and in the selection accent. A
 * dashed line reads as a proposal, which is right for a shape that will become
 * outline; this one never becomes anything. It is a cut, and what it leaves
 * behind is on both sides of it.
 */
export function drawKnifeStroke(ctx: Canvas2D, s: Scene): void {
  const stroke = s.knifeStroke;
  if (stroke === null) return;

  const a = toScreen(s.view, stroke[0]);
  const b = toScreen(s.view, stroke[1]);

  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = s.palette.nodeSelected;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

/**
 * The pen's rubber band, dashed so it never reads as part of the outline —
 * it is a proposal, not geometry that exists yet.
 */
export function drawPenPreview(ctx: Canvas2D, s: Scene): void {
  const preview = s.penPreview;
  if (preview === null) return;

  const a = toScreen(s.view, preview.a);
  const c1 = toScreen(s.view, preview.c1);
  const c2 = toScreen(s.view, preview.c2);
  const b = toScreen(s.view, preview.b);

  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = s.palette.preview;
  ctx.lineWidth = s.metrics.outlineWidth - 0.5;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * The marquee, drawn last of all so it sits over everything it is selecting.
 * Absent unless a marquee gesture is in progress.
 */
export function drawMarquee(ctx: Canvas2D, s: Scene): void {
  if (s.marquee === null) return;
  const a = toScreen(s.view, { x: s.marquee.minX, y: s.marquee.minY });
  const b = toScreen(s.view, { x: s.marquee.maxX, y: s.marquee.maxY });
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(b.x - a.x);
  const height = Math.abs(b.y - a.y);

  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.fillStyle = s.palette.marqueeFill;
  ctx.fill();
  ctx.strokeStyle = s.palette.marqueeStroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * On-curve points, in the geometric vocabulary: square for a corner, circle for
 * smooth, triangle for tangent.
 *
 * Shape carries the meaning rather than colour or weight, so it survives
 * greyscale, colour blindness and a bad monitor — and it matches the RoboFont
 * and UFO convention, so the muscle memory transfers.
 */
export function drawNodes(ctx: Canvas2D, s: Scene): void {
  const chosen = selectedKeys(s.selection);
  for (const c of s.glyph.contours) {
    for (const n of c.nodes) {
      const p = toScreen(s.view, n.pt);
      const isChosen = chosen.has(selectionKey({ contourId: c.id, nodeId: n.id, part: "point" }));
      const colour = isChosen ? s.palette.nodeSelected : s.palette.node;
      traceNodeShape(ctx, n, p, s.metrics.nodeRadius, tangentAngle(n, s.view));
      ctx.strokeStyle = s.palette.halo;
      ctx.lineWidth = s.metrics.haloWidth;
      ctx.stroke();
      ctx.fillStyle = colour;
      ctx.fill();
    }
  }
}

function traceNodeShape(ctx: Canvas2D, n: Node, p: Vec2, r: number, angle: number): void {
  ctx.beginPath();
  if (n.type === "corner") {
    ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
    return;
  }
  if (n.type === "tangent") {
    // Turned to point along the tangent, which is the one thing the shape has
    // to say: a tangent node is where the curve leaves along the straight side,
    // and a triangle that always pointed up said nothing about which way.
    const forward = { x: Math.cos(angle), y: Math.sin(angle) };
    const across = { x: -forward.y, y: forward.x };
    const tip = { x: p.x + forward.x * r * 1.25, y: p.y + forward.y * r * 1.25 };
    const back = { x: p.x - forward.x * r * 0.9, y: p.y - forward.y * r * 0.9 };

    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(back.x + across.x * r * 1.1, back.y + across.y * r * 1.1);
    ctx.lineTo(back.x - across.x * r * 1.1, back.y - across.y * r * 1.1);
    ctx.closePath();
    return;
  }
  ctx.arc(p.x, p.y, r, 0, TAU);
}

/**
 * Which way a tangent node's triangle points, in screen coordinates.
 *
 * Along the handle: a tangent node has exactly one, it lies on the straight
 * segment's line by definition, and it points the way the curve goes — so the
 * triangle points into the curve and its base sits against the straight side.
 *
 * Screen coordinates, which is why this is not simply the design-space
 * direction: y grows downward there and upward here, so a tangent pointing at
 * the sky would otherwise be drawn pointing at the floor.
 *
 * Zero for anything else, and for a tangent node whose handle has been retracted
 * onto it — there is no direction to be had, and up is as good as anything.
 */
function tangentAngle(n: Node, view: ViewTransform): number {
  if (n.type !== "tangent") return 0;

  const handle = n.out ?? n.in;
  if (handle === null) return 0;

  const from = toScreen(view, n.pt);
  const to = toScreen(view, handle);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx);
}

function haloedDisc(ctx: Canvas2D, s: Scene, p: Vec2, r: number, colour: string): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, TAU);
  ctx.strokeStyle = s.palette.halo;
  ctx.lineWidth = s.metrics.haloWidth;
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.fill();
}

/**
 * Add one contour to the current path.
 *
 * A straight segment is drawn with `lineTo`, not as a cubic with fabricated
 * handles. The difference is invisible on screen and matters anyway: the path
 * the renderer traces should be the path the model describes.
 */
export function traceContour(ctx: Canvas2D, view: ViewTransform, c: Contour): void {
  const first = c.nodes[0];
  if (first === undefined) return;

  const start = toScreen(view, first.pt);
  ctx.moveTo(start.x, start.y);

  for (const segment of segments(c)) {
    const end = toScreen(view, segment.b);
    if (segment.kind === "line") {
      ctx.lineTo(end.x, end.y);
      continue;
    }
    const cubic = segmentCubic(segment);
    const c1 = toScreen(view, cubic.c1);
    const c2 = toScreen(view, cubic.c2);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
  }

  if (c.closed) ctx.closePath();
}

/**
 * Draw a glyph small, fitted to a box, with no controls.
 *
 * Its own entry point rather than a `Scene` with everything switched off: a
 * thumbnail wants a different view transform per cell and none of the scene's
 * apparatus, and threading a whole scene through to draw one filled outline
 * would be ceremony without benefit.
 *
 * Fits by the em rather than by the glyph's own bounds, so a row of thumbnails
 * shares a baseline and a scale — an `l` and an `o` look like they belong to the
 * same font, which is the entire point of seeing them side by side.
 */
export function drawGlyphThumbnail(
  ctx: Canvas2D,
  glyph: Glyph,
  box: { x: number; y: number; width: number; height: number },
  palette: RenderPalette,
  metrics: { unitsPerEm: number; ascender: number; descender: number },
  padding = 4,
): void {
  const span = metrics.ascender - metrics.descender;
  if (span <= 0) return;

  const usable = box.height - padding * 2;
  if (usable <= 0) return;

  const scale = usable / span;
  const view: ViewTransform = {
    scale,
    tx: box.x + box.width / 2 - (glyph.advance / 2) * scale,
    ty: box.y + padding + metrics.ascender * scale,
  };

  // The corrected contours, so a counter is a hole in the browser and the strip
  // exactly as it will be in the font.
  const drawable = filledContours(glyph).filter((c) => c.nodes.length >= 2);
  if (drawable.length === 0) return;

  ctx.beginPath();
  for (const c of drawable) traceContour(ctx, view, c);
  ctx.fillStyle = palette.outline;
  ctx.fill();
}

/**
 * What a browser cell needs to know beyond the glyph itself.
 *
 * Named rather than passed as loose booleans because the two states read
 * differently and are easy to transpose: `current` is the glyph open in the
 * editor, `focused` is the one the keyboard is on. They are frequently not the
 * same cell.
 */
export type GlyphCellState = {
  readonly name: string;
  readonly codePoint: number | null;
  readonly focused: boolean;
  readonly current: boolean;
};

/** Room reserved under the artwork for the name and code point. */
const CELL_LABEL_HEIGHT = 26;

/**
 * One cell of the glyph browser: the glyph, its name, and its code point.
 *
 * A glyph with no outline still gets a cell, drawn empty. Most of a font in
 * progress is glyphs you have not made yet, and showing where the gaps are is
 * most of what the browser is for — so an undrawn glyph is a labelled empty box
 * rather than something omitted.
 */
export function drawGlyphCell(
  ctx: Canvas2D,
  glyph: Glyph | null,
  box: { x: number; y: number; width: number; height: number },
  palette: RenderPalette,
  metrics: { unitsPerEm: number; ascender: number; descender: number },
  state: GlyphCellState,
): void {
  if (state.current || state.focused) {
    ctx.fillStyle = state.current ? palette.cellCurrent : palette.cellFocus;
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.fill();
  }

  // Half-pixel inset so a one-pixel border lands on a pixel rather than
  // straddling two and rendering as a soft two-pixel line.
  ctx.strokeStyle = state.focused ? palette.marqueeStroke : palette.cellRule;
  ctx.lineWidth = state.focused ? 2 : 1;
  ctx.beginPath();
  ctx.rect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);
  ctx.stroke();

  if (glyph !== null) {
    drawGlyphThumbnail(
      ctx,
      glyph,
      { x: box.x, y: box.y, width: box.width, height: box.height - CELL_LABEL_HEIGHT },
      palette,
      metrics,
      6,
    );
  }

  ctx.fillStyle = palette.cellLabel;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const centre = box.x + box.width / 2;
  const inset = box.width - 8;

  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(state.name, centre, box.y + box.height - 14, inset);

  if (state.codePoint !== null) {
    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(formatCodePoint(state.codePoint), centre, box.y + box.height - 4, inset);
  }
}

/** `U+0041`, padded to at least four digits as the standard writes them. */
export function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * The origin and advance lines, which bound the glyph's advance width.
 *
 * Drawn full height rather than only beside the outline, because what they mark
 * is where the *next* glyph starts — a fact about the line of text, not about
 * this glyph's bounding box.
 */
export function drawMargins(ctx: Canvas2D, s: Scene): void {
  const lines = [0, s.glyph.advance];

  ctx.save();
  ctx.strokeStyle = s.palette.margin;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  for (const x of lines) {
    // Half a pixel keeps a one-pixel line on one pixel instead of across two.
    const screenX = Math.round(toScreen(s.view, { x, y: 0 }).x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(screenX, 0);
    ctx.lineTo(screenX, s.viewport.height);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The glyphs either side, filled flat and dimmed.
 *
 * Filled rather than outlined: at a glance you are judging areas of black
 * against areas of white, and an outline reads as a shape to edit rather than as
 * a mass to weigh against.
 */
export function drawNeighbours(ctx: Canvas2D, s: Scene): void {
  if (s.neighbours.length === 0) return;

  ctx.save();
  ctx.fillStyle = s.palette.neighbour;

  for (const neighbour of s.neighbours) {
    const drawable = neighbour.glyph.contours.filter((c) => c.nodes.length >= 2);
    if (drawable.length === 0) continue;

    // Shifting the view rather than the glyph: the outline is model data and
    // has no business being copied and moved to draw a preview of it.
    const shifted: ViewTransform = {
      ...s.view,
      tx: s.view.tx + neighbour.x * s.view.scale,
    };

    ctx.beginPath();
    for (const c of drawable) traceContour(ctx, shifted, c);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The outlines this glyph's components contribute.
 *
 * Filled, and a little lighter than the glyph's own outline. They are part of
 * the letter and have to read as part of it, but they belong to another glyph
 * and cannot be edited here, so drawing them identically would invite dragging
 * at points that are not there.
 */
export function drawComponents(ctx: Canvas2D, s: Scene): void {
  const drawable = s.componentOutlines.filter((c) => c.nodes.length >= 2);
  const held = s.selectedComponentOutlines.filter((c) => c.nodes.length >= 2);
  if (drawable.length === 0 && held.length === 0) return;

  ctx.save();
  if (drawable.length > 0) {
    ctx.fillStyle = s.palette.component;
    ctx.beginPath();
    for (const c of drawable) traceContour(ctx, s.view, c);
    ctx.fill();
  }

  // The one being worked on is filled like the rest and outlined on top, so a
  // drag says what it has hold of without the shape itself changing weight.
  if (held.length > 0) {
    ctx.beginPath();
    for (const c of held) traceContour(ctx, s.view, c);
    ctx.fillStyle = s.palette.component;
    ctx.fill();
    ctx.strokeStyle = s.palette.componentSelected;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The box round the selection, and the eight handles that transform it.
 *
 * Drawn after the outline and its points, because it is a control surface laid
 * over the drawing rather than part of it. The handles are squares in screen
 * pixels, not design units — they are things to grab, and a thing to grab is the
 * same size however far you have zoomed in.
 */
export function drawTransformBox(ctx: Canvas2D, s: Scene): void {
  const frame = s.transformBox;
  if (frame === null) return;

  // Traced corner to corner rather than as a rectangle, because the box can be
  // held at an angle and a rectangle in screen coordinates cannot be.
  const corner = (at: "topLeft" | "topRight" | "bottomRight" | "bottomLeft") =>
    toScreen(s.view, boxHandlePoint(frame, at));
  const outline = [
    corner("topLeft"),
    corner("topRight"),
    corner("bottomRight"),
    corner("bottomLeft"),
  ];

  // Dashed, so it is never mistaken for something the font contains.
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = s.palette.marqueeStroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  outline.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.stroke();

  // The knob's stem, drawn under the handles and dashed with the box it belongs
  // to. It runs from the top edge, which is the one place on the box where
  // nothing else is going on.
  const top = toScreen(s.view, boxHandlePoint(frame, "top"));
  const knob = toScreen(s.view, boxRotatePoint(frame, screenTolerance(s.view, BOX_STEM_PIXELS)));
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(knob.x, knob.y);
  ctx.stroke();
  ctx.restore();

  const size = 3;
  // Filled with the canvas ground rather than left hollow, so a handle over a
  // dark outline is still a handle.
  ctx.fillStyle = s.palette.background;
  ctx.strokeStyle = s.palette.marqueeStroke;
  ctx.lineWidth = 1;
  for (const at of BOX_ANCHORS) {
    const p = toScreen(s.view, boxHandlePoint(frame, at));
    ctx.beginPath();
    ctx.rect(Math.round(p.x) - size + 0.5, Math.round(p.y) - size + 0.5, size * 2, size * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Round, where the eight are square: it turns rather than resizes, and the
  // shape is the only thing saying so before you take hold of it.
  ctx.beginPath();
  ctx.arc(Math.round(knob.x) + 0.5, Math.round(knob.y) + 0.5, size + 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/**
 * The anchors of the glyph being edited: a small cross each, named on hover.
 *
 * A cross rather than a dot, and in its own colour, because an anchor is not
 * part of the outline. Anything drawn as a filled point reads as something to
 * pull a handle off, and an anchor has no handles, no curve, and no business
 * being mistaken for a node.
 *
 * The name appears only under the pointer. A letter carries `top` and `bottom`
 * where accents go — over the drawing and under it — so a label that were always
 * on would sit across the very shape it belongs to.
 */
export function drawAnchors(ctx: Canvas2D, s: Scene): void {
  if (!s.options.showAnchors || s.glyph.anchors.length === 0) return;

  const arm = s.metrics.nodeRadius + 1.5;
  ctx.save();
  ctx.lineCap = "butt";

  for (const a of s.glyph.anchors) {
    const p = toScreen(s.view, a.pt);
    const chosen = a.id === s.selectedAnchor;

    ctx.beginPath();
    ctx.moveTo(p.x - arm, p.y);
    ctx.lineTo(p.x + arm, p.y);
    ctx.moveTo(p.x, p.y - arm);
    ctx.lineTo(p.x, p.y + arm);

    // Haloed like a node, for the same reason: the cross has to stay legible
    // where it crosses the filled preview.
    ctx.strokeStyle = s.palette.halo;
    ctx.lineWidth = s.metrics.haloWidth + 1.5;
    ctx.stroke();
    ctx.strokeStyle = chosen ? s.palette.anchorSelected : s.palette.anchor;
    ctx.lineWidth = chosen ? 2 : 1.5;
    ctx.stroke();

    if (a.id !== s.hoveredAnchor || a.name === "") continue;

    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    // Written over its own halo rather than a box: a panel behind five
    // characters would hide more of the drawing than the characters do.
    ctx.strokeStyle = s.palette.halo;
    ctx.lineWidth = 3;
    ctx.strokeText(a.name, p.x + arm + 4, p.y);
    ctx.fillStyle = chosen ? s.palette.anchorSelected : s.palette.anchor;
    ctx.fillText(a.name, p.x + arm + 4, p.y);
  }

  ctx.restore();
}

/**
 * The section ruler: the line, where it crosses the outline, and every width
 * along it.
 *
 * The line itself is faint and the numbers are not, because the line is only
 * where the question was asked. Each stretch is labelled at its middle, with the
 * ink ones in the live colour: an `n` cut across the waist reads stem, counter,
 * stem, which is the rhythm the letter is judged by.
 */
export function drawSection(ctx: Canvas2D, s: Scene): void {
  const line = s.section;
  if (line === null) return;

  const from = toScreen(s.view, line.from);
  const to = toScreen(s.view, line.to);

  ctx.save();
  ctx.strokeStyle = s.palette.section;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // A tick at every crossing, square to the line: the numbers are between them,
  // and a number is only as trustworthy as the two ends it was taken from.
  const along = Math.hypot(to.x - from.x, to.y - from.y);
  const across =
    along === 0 ? { x: 0, y: 0 } : { x: -(to.y - from.y) / along, y: (to.x - from.x) / along };

  ctx.beginPath();
  for (const crossing of line.crossings) {
    const p = toScreen(s.view, crossing);
    ctx.moveTo(p.x - across.x * 5, p.y - across.y * 5);
    ctx.lineTo(p.x + across.x * 5, p.y + across.y * 5);
  }
  ctx.stroke();

  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const span of line.spans) {
    const a = toScreen(s.view, span.from);
    const b = toScreen(s.view, span.to);
    // Skipped where there is no room for the number rather than drawn on top of
    // the ticks either side of it, which is what a run of hairline gaps would do.
    if (Math.hypot(b.x - a.x, b.y - a.y) < 26) continue;

    const middle = { x: (a.x + b.x) / 2 + across.x * 11, y: (a.y + b.y) / 2 + across.y * 11 };
    const text = String(Math.round(span.distance));

    ctx.strokeStyle = s.palette.halo;
    ctx.lineWidth = 3;
    ctx.strokeText(text, middle.x, middle.y);
    ctx.fillStyle = span.ink ? s.palette.sectionInk : s.palette.section;
    ctx.fillText(text, middle.x, middle.y);
  }

  ctx.restore();
}

/**
 * The curvature comb: a hair square to the outline every few pixels, as long as
 * the curvature there, with the tips joined.
 *
 * The hairs are signed, so the comb stands on one side of the curve and crosses
 * to the other at an inflection — which is exactly where a designer wants to be
 * told there is one. The envelope is drawn per contour and broken between them,
 * since joining the last hair of one shape to the first of the next would draw a
 * line across the letter that means nothing.
 */
/**
 * How long a hair has to be, in screen pixels, before it is worth drawing.
 *
 * Below this the outline is straight as far as anyone can see, and the comb
 * should say so by not being there.
 */
const STRAIGHT_PIXELS = 0.75;

export function drawCurvatureComb(ctx: Canvas2D, s: Scene): void {
  if (!s.options.showCurvature) return;

  ctx.save();

  for (const comb of s.comb) {
    // The runs come already broken wherever the outline stops curving — see
    // `Comb` in the view package. Drawn as one line instead, the envelope leaps
    // those gaps and lays a straight line alongside the straight edges.
    const runs = comb.runs
      .map((run) =>
        run
          .filter((hair) => hair.reach * s.view.scale >= STRAIGHT_PIXELS)
          .map((hair) => ({
            foot: toScreen(s.view, hair.at),
            tip: toScreen(s.view, {
              x: hair.at.x + hair.normal.x * hair.reach,
              y: hair.at.y + hair.normal.y * hair.reach,
            }),
          })),
      )
      .filter((run) => run.length > 1);
    if (runs.length === 0) continue;

    ctx.strokeStyle = s.palette.comb;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const each of runs) {
      for (const { foot, tip } of each) {
        ctx.moveTo(foot.x, foot.y);
        ctx.lineTo(tip.x, tip.y);
      }
    }
    ctx.stroke();

    // One envelope per run, so it is never drawn across the straight stretch
    // between two curved ones.
    ctx.strokeStyle = s.palette.combEdge;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (const each of runs) {
      for (const [i, { tip }] of each.entries()) {
        if (i === 0) ctx.moveTo(tip.x, tip.y);
        else ctx.lineTo(tip.x, tip.y);
      }
    }
    ctx.stroke();
  }

  ctx.restore();
}
