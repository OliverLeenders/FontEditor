import { type Vec2, handleIntersection } from "@fonteditor/geometry";
import {
  type Contour,
  type Node,
  type Segment,
  segmentCubic,
  segmentTunniPoint,
  segmentTunniStatus,
  segments,
} from "@fonteditor/font-model";
import {
  type SegmentRef,
  type ViewTransform,
  sameSegment,
  selectionKey,
  toScreen,
} from "@fonteditor/view";

import type { Canvas2D } from "./context.js";
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
  drawGuides(ctx, s);
  if (s.options.showFilledPreview) drawFilledPreview(ctx, s);
  drawOutline(ctx, s);

  if (s.options.showControls) {
    drawTunniControls(ctx, s);
    drawHandles(ctx, s);
    drawNodes(ctx, s);
    drawPenPreview(ctx, s);
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

export function drawGuides(ctx: Canvas2D, s: Scene): void {
  ctx.lineWidth = 1;
  for (const guide of s.guides) {
    // Half-pixel offset so a one-pixel line lands on a pixel rather than
    // straddling two and rendering as a soft two-pixel smear.
    const y = Math.round(toScreen(s.view, { x: 0, y: guide.y }).y) + 0.5;
    ctx.strokeStyle = guide.emphasis === true ? s.palette.guideEmphasis : s.palette.guide;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(s.viewport.width, y);
    ctx.stroke();
  }
}

/**
 * The translucent glyph body.
 *
 * Only closed contours are filled. An open contour has no interior, and the
 * canvas would invent one by joining its ends — which is exactly the kind of
 * confident nonsense a designer should never have to second-guess.
 */
export function drawFilledPreview(ctx: Canvas2D, s: Scene): void {
  const closed = s.glyph.contours.filter((c) => c.closed && c.nodes.length >= 2);
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
export function drawHandles(ctx: Canvas2D, s: Scene): void {
  const chosen = new Set(s.selection.map(selectionKey));

  for (const c of s.glyph.contours) {
    for (const n of c.nodes) {
      const anchor = toScreen(s.view, n.pt);
      for (const part of ["in", "out"] as const) {
        const handle = part === "in" ? n.in : n.out;
        if (handle === null) continue;
        const p = toScreen(s.view, handle);
        const isChosen = chosen.has(
          selectionKey({ contourId: c.id, nodeId: n.id, part }),
        );

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
      }
    }
  }
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
  const chosen = new Set(s.selection.map(selectionKey));
  for (const c of s.glyph.contours) {
    for (const n of c.nodes) {
      const p = toScreen(s.view, n.pt);
      const isChosen = chosen.has(selectionKey({ contourId: c.id, nodeId: n.id, part: "point" }));
      const colour = isChosen ? s.palette.nodeSelected : s.palette.node;
      traceNodeShape(ctx, n, p, s.metrics.nodeRadius);
      ctx.strokeStyle = s.palette.halo;
      ctx.lineWidth = s.metrics.haloWidth;
      ctx.stroke();
      ctx.fillStyle = colour;
      ctx.fill();
    }
  }
}

function traceNodeShape(ctx: Canvas2D, n: Node, p: Vec2, r: number): void {
  ctx.beginPath();
  if (n.type === "corner") {
    ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
    return;
  }
  if (n.type === "tangent") {
    ctx.moveTo(p.x, p.y - r * 1.25);
    ctx.lineTo(p.x + r * 1.1, p.y + r * 0.9);
    ctx.lineTo(p.x - r * 1.1, p.y + r * 0.9);
    ctx.closePath();
    return;
  }
  ctx.arc(p.x, p.y, r, 0, TAU);
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
function traceContour(ctx: Canvas2D, view: ViewTransform, c: Contour): void {
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

/** True when `ref` is one of the segments showing its Tunni controls. */
export function isActive(s: Scene, ref: SegmentRef): boolean {
  return s.tunniSegments.some((candidate) => sameSegment(candidate, ref));
}
