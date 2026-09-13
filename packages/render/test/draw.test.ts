import { vec } from "@typewright/geometry";
import {
  type Contour,
  addAnchor,
  addContour,
  anchor,
  contour,
  counterIds,
  glyph,
  node,
  segmentTunniPoint,
  setHandle,
} from "@typewright/font-model";
import { type ViewTransform, combFor, toScreen } from "@typewright/view";
import { describe, expect, it } from "vitest";

import { drawScene } from "../src/draw.js";
import { LIGHT_PALETTE } from "../src/palette.js";
import { DEFAULT_METRICS } from "../src/scene.js";
import { scene } from "../src/scene.js";
import { RecordingContext } from "./recording-context.js";

const VIEW: ViewTransform = { scale: 0.5, tx: 200, ty: 400 };
const VIEWPORT = { width: 800, height: 600 };

/** Four smooth curve nodes in a ring; every segment is a well-formed curve. */
function ring(): Contour {
  const ids = counterIds();
  const k = 140;
  return contour(
    ids.contour(),
    [
      node(ids.node(), vec(0, 250), { type: "smooth", in: vec(-k, 250), out: vec(k, 250) }),
      node(ids.node(), vec(250, 0), { type: "smooth", in: vec(250, k), out: vec(250, -k) }),
      node(ids.node(), vec(0, -250), { type: "smooth", in: vec(k, -250), out: vec(-k, -250) }),
      node(ids.node(), vec(-250, 0), { type: "smooth", in: vec(-250, -k), out: vec(-250, k) }),
    ],
    true,
  );
}

/** A closed triangle of straight lines, all corner nodes. */
function triangle(): Contour {
  const ids = counterIds("t");
  return contour(
    ids.contour(),
    [node(ids.node(), vec(0, 0)), node(ids.node(), vec(300, 0)), node(ids.node(), vec(150, 260))],
    true,
  );
}

function render(init: Parameters<typeof scene>[0]): RecordingContext {
  const ctx = new RecordingContext();
  drawScene(ctx, scene(init));
  return ctx;
}

const base = (c: Contour) => ({
  glyph: addContour(glyph("test", { advance: 600 }), c),
  view: VIEW,
  viewport: VIEWPORT,
  palette: LIGHT_PALETTE,
});

describe("layer order", () => {
  // Order is the design: the fill goes down first so the outline reads as an
  // edge, and the nodes go last so they are never buried under either.
  it("draws the fill, then the outline, then the nodes", () => {
    const ctx = render({ ...base(ring()) });

    const fill = ctx.indexWhere((o) => o.op === "fill" && o.fillStyle === LIGHT_PALETTE.fill);
    const outline = ctx.indexWhere(
      (o) => o.op === "stroke" && o.strokeStyle === LIGHT_PALETTE.outline,
    );
    const nodes = ctx.indexWhere((o) => o.op === "fill" && o.fillStyle === LIGHT_PALETTE.node);

    expect(fill).toBeGreaterThanOrEqual(0);
    expect(outline).toBeGreaterThan(fill);
    expect(nodes).toBeGreaterThan(outline);
  });

  it("draws the Tunni line before the nodes that sit near it", () => {
    const c = ring();
    const ctx = render({
      ...base(c),
      tunniSegments: [{ contourId: c.id, segmentIndex: 0 }],
    });

    const tunniLine = ctx.indexWhere(
      (o) => o.op === "stroke" && o.strokeStyle === LIGHT_PALETTE.tunniLine,
    );
    const nodes = ctx.indexWhere((o) => o.op === "fill" && o.fillStyle === LIGHT_PALETTE.node);
    expect(tunniLine).toBeGreaterThanOrEqual(0);
    expect(nodes).toBeGreaterThan(tunniLine);
  });
});

describe("the outline path", () => {
  it("traces one bezier per curve segment", () => {
    const ctx = render({ ...base(ring()), options: { showFilledPreview: false } });
    // Four segments, traced once for the outline.
    expect(ctx.all("bezierCurveTo")).toHaveLength(4);
  });

  // A straight segment's cubic has handles at the thirds, but those are a
  // materialisation for geometry queries — not something to draw.
  it("traces a straight segment with lineTo, not a fabricated bezier", () => {
    const ctx = render({ ...base(triangle()), options: { showFilledPreview: false } });
    expect(ctx.all("bezierCurveTo")).toHaveLength(0);
    expect(ctx.all("lineTo").length).toBeGreaterThanOrEqual(3);
  });

  it("starts at the first node and closes a closed contour", () => {
    // Margins off so the outline is the only path in the recording; this is
    // about where the outline starts, not about what else the scene draws.
    const ctx = render({
      ...base(ring()),
      options: { showFilledPreview: false, margins: false },
    });
    const start = toScreen(VIEW, vec(0, 250));
    const moves = ctx.all("moveTo");
    expect(moves[0]!.args).toEqual([start.x, start.y]);
    expect(ctx.all("closePath").length).toBeGreaterThanOrEqual(1);
  });

  it("draws nothing for an empty glyph", () => {
    const ctx = render({
      glyph: glyph("space", { advance: 250 }),
      view: VIEW,
      viewport: VIEWPORT,
      palette: LIGHT_PALETTE,
    });
    expect(ctx.all("bezierCurveTo")).toHaveLength(0);
    expect(ctx.all("arc")).toHaveLength(0);
  });
});

describe("the filled preview", () => {
  it("fills when asked", () => {
    const ctx = render({ ...base(ring()), options: { showFilledPreview: true } });
    expect(ctx.filledIn(LIGHT_PALETTE.fill).length).toBeGreaterThan(0);
  });

  it("does not fill when switched off", () => {
    const ctx = render({ ...base(ring()), options: { showFilledPreview: false } });
    expect(ctx.filledIn(LIGHT_PALETTE.fill)).toHaveLength(0);
  });

  // An open contour has no interior, and letting the canvas invent one by
  // joining the ends would be confident nonsense.
  it("skips open contours", () => {
    const ids = counterIds("o");
    const open = contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0), { out: vec(60, 100) }),
        node(ids.node(), vec(200, 0), { in: vec(140, 100) }),
      ],
      false,
    );
    const ctx = render({ ...base(open), options: { showFilledPreview: true } });
    expect(ctx.filledIn(LIGHT_PALETTE.fill)).toHaveLength(0);
    // …but the outline is still stroked.
    expect(ctx.strokedIn(LIGHT_PALETTE.outline).length).toBeGreaterThan(0);
  });
});

describe("Tunni controls", () => {
  it("draws nothing when no segment is awake", () => {
    const ctx = render({ ...base(ring()), tunniSegments: [] });
    expect(ctx.strokedIn(LIGHT_PALETTE.tunniLine)).toHaveLength(0);
    expect(ctx.filledIn(LIGHT_PALETTE.tunniPoint)).toHaveLength(0);
  });

  it("draws the line and the point for the awake segment", () => {
    const c = ring();
    const ctx = render({ ...base(c), tunniSegments: [{ contourId: c.id, segmentIndex: 0 }] });
    expect(ctx.strokedIn(LIGHT_PALETTE.tunniLine).length).toBe(1);
    expect(ctx.filledIn(LIGHT_PALETTE.tunniPoint).length).toBe(1);
  });

  it("puts the Tunni point exactly where the model says it is", () => {
    const c = ring();
    const expected = toScreen(VIEW, segmentTunniPoint(c, 0)!);
    const ctx = render({ ...base(c), tunniSegments: [{ contourId: c.id, segmentIndex: 0 }] });
    expect(ctx.arcsAt(expected.x, expected.y).length).toBeGreaterThan(0);
  });

  it("draws controls for two segments when two are showing", () => {
    const c = ring();
    const ctx = render({
      ...base(c),
      tunniSegments: [
        { contourId: c.id, segmentIndex: 0 },
        { contourId: c.id, segmentIndex: 2 },
      ],
    });
    expect(ctx.strokedIn(LIGHT_PALETTE.tunniLine).length).toBe(2);
    expect(ctx.filledIn(LIGHT_PALETTE.tunniPoint).length).toBe(2);
  });

  // Hover and focus are usually the same segment. Drawing it twice would double
  // the Tunni line's alpha and make it read as emphasised.
  it("draws a repeated segment only once", () => {
    const c = ring();
    const ref = { contourId: c.id, segmentIndex: 0 };
    const ctx = render({ ...base(c), tunniSegments: [ref, ref] });
    expect(ctx.strokedIn(LIGHT_PALETTE.tunniLine).length).toBe(1);
    expect(ctx.filledIn(LIGHT_PALETTE.tunniPoint).length).toBe(1);
  });

  it("draws controls for one segment only, never its neighbours", () => {
    const c = ring();
    const ctx = render({ ...base(c), tunniSegments: [{ contourId: c.id, segmentIndex: 2 }] });
    const expected = toScreen(VIEW, segmentTunniPoint(c, 2)!);
    const wrong = toScreen(VIEW, segmentTunniPoint(c, 0)!);
    expect(ctx.arcsAt(expected.x, expected.y).length).toBeGreaterThan(0);
    expect(ctx.arcsAt(wrong.x, wrong.y)).toHaveLength(0);
  });

  // The decided behaviour: an invalid Tunni point is simply absent. No dimmed
  // ghost, no tooltip. The line stays, because having a drag target vanish from
  // under the cursor is worse than having the drag refused.
  it("hides the point but keeps the line when the handles cross", () => {
    const c = ring();
    const crossed = setHandle(c, c.nodes[0]!.id, "out", vec(140, -400))!;
    const ctx = render({
      ...base(crossed),
      tunniSegments: [{ contourId: crossed.id, segmentIndex: 0 }],
    });
    expect(ctx.filledIn(LIGHT_PALETTE.tunniPoint)).toHaveLength(0);
    expect(ctx.strokedIn(LIGHT_PALETTE.tunniLine).length).toBe(1);
  });

  it("draws nothing for a straight segment", () => {
    const c = triangle();
    const ctx = render({ ...base(c), tunniSegments: [{ contourId: c.id, segmentIndex: 0 }] });
    expect(ctx.strokedIn(LIGHT_PALETTE.tunniLine)).toHaveLength(0);
    expect(ctx.filledIn(LIGHT_PALETTE.tunniPoint)).toHaveLength(0);
  });

  it("ignores an active segment naming a contour that is not there", () => {
    const c = ring();
    const ctx = render({ ...base(c), tunniSegments: [{ contourId: "gone", segmentIndex: 0 }] });
    expect(ctx.filledIn(LIGHT_PALETTE.tunniPoint)).toHaveLength(0);
  });

  it("adds the handle intersection only when asked", () => {
    const c = ring();
    const active = [{ contourId: c.id, segmentIndex: 0 }];
    const off = render({ ...base(c), tunniSegments: active });
    const on = render({
      ...base(c),
      tunniSegments: active,
      options: { showHandleIntersection: true },
    });
    expect(off.all("setLineDash").filter((o) => o.args.length > 0)).toHaveLength(0);
    expect(on.all("setLineDash").filter((o) => o.args.length > 0).length).toBeGreaterThan(0);
  });
});

describe("nodes and handles", () => {
  it("uses a square for a corner and a circle for a smooth node", () => {
    const ids = counterIds("m");
    const mixed = contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0), { type: "corner", out: vec(60, 90) }),
        node(ids.node(), vec(300, 0), { type: "smooth", in: vec(240, 90), out: vec(360, -90) }),
      ],
      false,
    );
    const ctx = render({ ...base(mixed) });

    const corner = toScreen(VIEW, vec(0, 0));
    const smooth = toScreen(VIEW, vec(300, 0));

    const squares = ctx
      .all("rect")
      .filter((o) => Math.abs((o.args[0] ?? NaN) + 5.5 - corner.x) < 0.5);
    expect(squares.length).toBeGreaterThan(0);
    expect(ctx.arcsAt(smooth.x, smooth.y).length).toBeGreaterThan(0);
  });

  it("draws a handle for every handle in the glyph, awake or not", () => {
    // Handles are how a curve is shaped directly; only the Tunni controls hide.
    const ctx = render({ ...base(ring()), tunniSegments: [] });
    for (const p of [vec(140, 250), vec(-140, 250), vec(250, 140), vec(250, -140)]) {
      const s = toScreen(VIEW, p);
      expect(ctx.arcsAt(s.x, s.y).length).toBeGreaterThan(0);
    }
  });

  it("colours a selected node differently", () => {
    const c = ring();
    const ctx = render({
      ...base(c),
      selection: [{ contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" }],
    });
    expect(ctx.filledIn(LIGHT_PALETTE.nodeSelected).length).toBe(1);
    expect(ctx.filledIn(LIGHT_PALETTE.node).length).toBe(3);
  });

  // Handles are selectable in their own right, so a selected handle has to read
  // as selected without its node being selected too.
  it("rings a selected handle without filling it", () => {
    const c = ring();
    const ctx = render({
      ...base(c),
      selection: [{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "out" }],
    });
    expect(ctx.strokedIn(LIGHT_PALETTE.handleSelected).length).toBe(1);
    expect(ctx.strokedIn(LIGHT_PALETTE.handle).length).toBe(7);
    // The node itself is untouched.
    expect(ctx.filledIn(LIGHT_PALETTE.nodeSelected)).toHaveLength(0);
    expect(ctx.filledIn(LIGHT_PALETTE.node).length).toBe(4);
  });

  // Fill means on-curve, ring means off-curve, at every selection state. A
  // filled handle would be indistinguishable from a selected smooth node.
  it("never fills a handle in a colour an on-curve node uses", () => {
    const c = ring();
    const ctx = render({
      ...base(c),
      selection: [
        { contourId: c.id, nodeId: c.nodes[0]!.id, part: "out" },
        { contourId: c.id, nodeId: c.nodes[1]!.id, part: "point" },
      ],
    });
    expect(ctx.filledIn(LIGHT_PALETTE.nodeSelected).length).toBe(1);
  });
});

describe("showControls", () => {
  // What holding space does: keep the shape, drop every control.
  it("leaves the fill and outline but removes all controls", () => {
    const c = ring();
    const ctx = render({
      ...base(c),
      tunniSegments: [{ contourId: c.id, segmentIndex: 0 }],
      selection: [{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" }],
      options: { showControls: false },
    });

    expect(ctx.filledIn(LIGHT_PALETTE.fill).length).toBeGreaterThan(0);
    expect(ctx.strokedIn(LIGHT_PALETTE.outline).length).toBeGreaterThan(0);
    expect(ctx.filledIn(LIGHT_PALETTE.node)).toHaveLength(0);
    expect(ctx.filledIn(LIGHT_PALETTE.nodeSelected)).toHaveLength(0);
    expect(ctx.strokedIn(LIGHT_PALETTE.tunniLine)).toHaveLength(0);
    expect(ctx.filledIn(LIGHT_PALETTE.tunniPoint)).toHaveLength(0);
  });
});

describe("guides", () => {
  it("draws one line per guide, spanning the viewport", () => {
    const ctx = render({
      ...base(ring()),
      metricLines: [{ y: 0, emphasis: true }, { y: 500 }],
    });
    const emphasised = ctx.strokedIn(LIGHT_PALETTE.guideEmphasis);
    const plain = ctx.strokedIn(LIGHT_PALETTE.guide);
    expect(emphasised).toHaveLength(1);
    expect(plain).toHaveLength(1);

    const spans = ctx.all("lineTo").filter((o) => o.args[0] === VIEWPORT.width);
    expect(spans.length).toBeGreaterThanOrEqual(2);
  });

  it("puts a guide at the right height", () => {
    const ctx = render({ ...base(ring()), metricLines: [{ y: 500 }] });
    const expected = Math.round(toScreen(VIEW, vec(0, 500)).y) + 0.5;
    const move = ctx.all("moveTo").find((o) => o.args[0] === 0 && o.args[1] === expected);
    expect(move).toBeDefined();
  });

  it("writes the name of a line that has one", () => {
    const ctx = render({
      ...base(ring()),
      metricLines: [
        { y: 0, emphasis: true, label: "baseline" },
        { y: 500, label: "x-height" },
      ],
    });
    expect(ctx.texts()).toEqual(["baseline", "x-height"]);
  });

  it("says nothing about a guide with no name", () => {
    const ctx = render({ ...base(ring()), metricLines: [{ y: 500 }] });
    expect(ctx.texts()).toEqual([]);
  });

  it("drops the second of two names that would land on each other", () => {
    // A font whose cap height is its ascender draws two rules in the same place,
    // and two names on top of one another read as neither.
    const ctx = render({
      ...base(ring()),
      metricLines: [
        { y: 700, label: "cap height" },
        { y: 700, label: "ascender" },
      ],
    });
    expect(ctx.texts()).toEqual(["cap height"]);
  });

  it("keeps both when they are far enough apart", () => {
    const ctx = render({
      ...base(ring()),
      metricLines: [
        { y: 700, label: "cap height" },
        { y: 0, label: "baseline" },
      ],
    });
    expect(ctx.texts()).toEqual(["cap height", "baseline"]);
  });

  it("writes the name above its line, not on it", () => {
    const ctx = render({ ...base(ring()), metricLines: [{ y: 500, label: "x-height" }] });
    const line = Math.round(toScreen(VIEW, vec(0, 500)).y) + 0.5;
    const text = ctx.all("fillText")[0];
    expect(text?.args[1]).toBeLessThan(line);
  });
});

describe("state hygiene", () => {
  // The context is shared with whatever else draws on the canvas, so a frame
  // must not leak alpha or a dash pattern into the next one.
  it("balances save and restore, and leaves alpha at 1", () => {
    const c = ring();
    const ctx = render({
      ...base(c),
      tunniSegments: [{ contourId: c.id, segmentIndex: 0 }],
      options: { showHandleIntersection: true },
    });
    // Balance is the property that matters, not the count: each drawing pass
    // that needs its own state saves and restores, so the number grows as the
    // scene gains parts while the invariant stays the same.
    expect(ctx.all("save").length).toBe(ctx.all("restore").length);
    expect(ctx.all("save").length).toBeGreaterThan(0);
    expect(ctx.globalAlpha).toBe(1);
    expect(ctx.ops[ctx.ops.length - 1]!.op).toBe("restore");
  });

  it("clears the dash pattern after the intersection guides", () => {
    const c = ring();
    const ctx = render({
      ...base(c),
      tunniSegments: [{ contourId: c.id, segmentIndex: 0 }],
      options: { showHandleIntersection: true },
    });
    const dashed = ctx.all("setLineDash");
    expect(dashed[dashed.length - 1]!.args).toEqual([]);
  });
});

describe("snap guides", () => {
  const caught = (from: { x: number; y: number } | null) => ({
    ...base(ring()),
    snapGuides: [{ axis: "y" as const, at: 250, from }],
  });

  it("draws nothing when nothing is caught", () => {
    const ctx = render(base(ring()));
    expect(ctx.all("setLineDash").some((o) => (o.args as unknown[]).length > 0)).toBe(false);
  });

  it("draws the caught line dashed, where the metric lines are solid", () => {
    const ctx = render(caught(null));
    const dashes = ctx.all("setLineDash").map((o) => JSON.stringify(o.args));
    expect(dashes).toContain(JSON.stringify([4, 4]));
  });

  it("puts the line at the coordinate it caught", () => {
    const ctx = render(caught(null));
    const y = toScreen(VIEW, { x: 0, y: 250 }).y;
    // Half-pixel offset, as the metric lines take.
    expect(
      ctx.all("moveTo").some((o) => Math.abs((o.args[1] ?? NaN) - (Math.round(y) + 0.5)) < 0.01),
    ).toBe(true);
  });

  it("rings the point that produced it", () => {
    const from = { x: 250, y: 250 };
    const ctx = render(caught(from));
    const p = toScreen(VIEW, from);
    // Wider than a node, so it haloes the node rather than hiding under it.
    expect(ctx.arcsAt(p.x, p.y).some((o) => (o.args[2] ?? 0) > DEFAULT_METRICS.nodeRadius)).toBe(
      true,
    );
  });

  it("rings nothing for a line the font defines", () => {
    // The baseline and the advance already span the canvas and are already
    // drawn. There is no point to indicate, only a line to mark as live.
    const withRing = render(caught({ x: 250, y: 250 })).all("arc").length;
    const without = render(caught(null)).all("arc").length;
    expect(without).toBe(withRing - 1);
  });

  it("leaves the dash off for everything drawn afterwards", () => {
    // The guides run inside the controls, and a stray dash would put every
    // handle and node after them on a dotted stroke.
    const ctx = render(caught({ x: 250, y: 250 }));
    const restores = ctx.all("restore").length;
    expect(restores).toBeGreaterThan(1);
  });
});

describe("the mark on a locked handle", () => {
  const ids = counterIds("lockdraw");
  const withLock = (lock: { in?: boolean; out?: boolean }) =>
    contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0), {
          type: "corner",
          in: vec(-120, 0),
          out: vec(0, 120),
          hvLock: lock,
        }),
        node(ids.node(), vec(300, 0), { type: "corner", in: vec(240, 40) }),
      ],
      false,
    );

  const strokesNear = (ctx: ReturnType<typeof render>, x: number, y: number) =>
    ctx
      .all("moveTo")
      .filter(
        (o) => Math.abs((o.args[0] ?? NaN) - x) < 12 && Math.abs((o.args[1] ?? NaN) - y) < 12,
      );

  it("marks nothing when no handle is locked", () => {
    const free = render(base(withLock({})));
    const locked = render(base(withLock({ out: true })));
    expect(locked.all("moveTo").length).toBe(free.all("moveTo").length + 1);
  });

  it("marks only the handle that is locked", () => {
    const one = render(base(withLock({ out: true })));
    const both = render(base(withLock({ in: true, out: true })));
    expect(both.all("moveTo").length).toBe(one.all("moveTo").length + 1);
  });

  it("puts the bar across the handle it belongs to", () => {
    const ctx = render(base(withLock({ out: true })));
    const p = toScreen(VIEW, { x: 0, y: 120 });
    expect(strokesNear(ctx, p.x, p.y).length).toBeGreaterThan(0);
  });

  it("draws the bar along the axis the handle is locked to", () => {
    // The line the handle may slide on, drawn as a line. The out handle runs
    // vertically, so its bar is upright: the two ends share an x.
    const ctx = render(base(withLock({ out: true })));
    const p = toScreen(VIEW, { x: 0, y: 120 });
    const at = ctx.indexWhere(
      (o) =>
        o.op === "moveTo" &&
        Math.abs((o.args[0] ?? NaN) - p.x) < 12 &&
        Math.abs((o.args[1] ?? NaN) - p.y) < 12,
    );
    expect(at).toBeGreaterThan(-1);

    const from = ctx.ops[at];
    const to = ctx.ops[at + 1];
    expect(to?.op).toBe("lineTo");
    expect(Math.abs((to?.args[0] ?? NaN) - (from?.args[0] ?? NaN))).toBeLessThan(0.01);
    expect(Math.abs((to?.args[1] ?? NaN) - (from?.args[1] ?? NaN))).toBeGreaterThan(1);
  });
});

describe("what the fill draws", () => {
  it("fills the contours it was handed, not the glyph's own", () => {
    // The scene carries a direction-corrected copy: the compiler corrects them
    // on the way into a font, and a preview of the contours exactly as drawn
    // would show a notch where the exported font has none.
    const ids = counterIds("f");
    const square = contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0)),
        node(ids.node(), vec(100, 0)),
        node(ids.node(), vec(100, 100)),
        node(ids.node(), vec(0, 100)),
      ],
      true,
    );
    const other = contour(
      ids.contour(),
      [
        node(ids.node(), vec(300, 0)),
        node(ids.node(), vec(400, 0)),
        node(ids.node(), vec(400, 100)),
      ],
      true,
    );

    const ctx = new RecordingContext();
    drawScene(
      ctx,
      scene({
        glyph: glyph("a", { advance: 500, contours: [square] }),
        filled: [other],
        view: VIEW,
        viewport: VIEWPORT,
        palette: LIGHT_PALETTE,
        metrics: DEFAULT_METRICS,
      }),
    );

    // The fill traced the contour it was handed rather than the glyph's own.
    const moves = ctx.all("moveTo").map((o) => o.args[0]);
    expect(moves).toContain(toScreen(VIEW, vec(300, 0)).x);
    // The outline is still the glyph's, so its own contour is traced too.
    expect(moves).toContain(toScreen(VIEW, vec(0, 0)).x);
  });

  it("falls back to the glyph's own contours when nothing else is said", () => {
    const ids = counterIds("g");
    const square = contour(
      ids.contour(),
      [node(ids.node(), vec(0, 0)), node(ids.node(), vec(100, 0)), node(ids.node(), vec(100, 100))],
      true,
    );
    const built = scene({
      glyph: glyph("a", { advance: 500, contours: [square] }),
      view: VIEW,
      viewport: VIEWPORT,
      palette: LIGHT_PALETTE,
      metrics: DEFAULT_METRICS,
    });
    expect(built.filled).toEqual([square]);
  });
});

describe("anchors", () => {
  const withAnchor = (extra: Record<string, unknown> = {}) => ({
    ...base(ring()),
    glyph: addAnchor(
      addContour(glyph("test", { advance: 600 }), ring()),
      anchor("k1", "top", vec(0, 250)),
    ),
    ...extra,
  });

  it("draws a cross, not a point", () => {
    const ctx = render(withAnchor());
    const p = toScreen(VIEW, vec(0, 250));

    // Two strokes through the same place, level and upright: the arms of a
    // cross. A node would be an arc or a rect instead.
    const moves = ctx.all("moveTo").map((o) => o.args);
    expect(moves.some(([x, y]) => y === p.y && x !== p.x)).toBe(true);
    expect(moves.some(([x, y]) => x === p.x && y !== p.y)).toBe(true);
  });

  it("writes the name only for the anchor under the pointer", () => {
    expect(render(withAnchor()).texts()).not.toContain("top");
    expect(render(withAnchor({ hoveredAnchor: "k1" })).texts()).toContain("top");
  });

  it("draws nothing at all when anchors are turned off", () => {
    const ctx = render(withAnchor({ options: { showAnchors: false }, hoveredAnchor: "k1" }));
    expect(ctx.texts()).not.toContain("top");
  });
});

describe("a tangent node's triangle", () => {
  /** A corner, a tangent whose handle points somewhere, and a corner after it. */
  const withTangent = (handle: { x: number; y: number }) => {
    const ids = counterIds("tan");
    const c = contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0)),
        node(ids.node(), vec(100, 0), { type: "tangent", out: handle }),
        node(ids.node(), vec(200, 200), { type: "corner", in: vec(150, 100) }),
      ],
      false,
    );
    return { ...base(c), glyph: addContour(glyph("t", { advance: 300 }), c) };
  };

  /**
   * The three corners of the triangle drawn at the tangent node.
   *
   * Found as the closed run of three — a moveTo, two lineTo and a closePath —
   * rather than by proximity: the handle line starts at the same point, so
   * "near the node" alone would pick up half of it.
   */
  const triangle = (ctx: ReturnType<typeof render>) => {
    const at = toScreen(VIEW, vec(100, 0));
    const ops = ctx.ops;

    for (let i = 0; i + 3 < ops.length; i++) {
      const run = ops.slice(i, i + 4);
      const shape = run.map((o) => o.op).join(" ");
      if (shape !== "moveTo lineTo lineTo closePath") continue;

      const corners = run.slice(0, 3).map((o) => ({ x: o.args[0]!, y: o.args[1]! }));
      if (corners.every((c) => Math.hypot(c.x - at.x, c.y - at.y) < 12)) return corners;
    }
    return [];
  };

  it("points along the handle, not at the sky", () => {
    const at = toScreen(VIEW, vec(100, 0));

    // Handle to the right: the apex is the corner furthest to the right, and
    // the other two sit level with each other on the left.
    const east = triangle(render(withTangent(vec(160, 0))));
    expect(east).toHaveLength(3);
    const apexEast = east.reduce((best, p) => (p.x > best.x ? p : best));
    expect(apexEast.x).toBeGreaterThan(at.x);
    expect(Math.abs(apexEast.y - at.y)).toBeLessThan(0.001);

    // Handle upward in design space is upward on screen, which is a smaller y.
    const north = triangle(render(withTangent(vec(100, 60))));
    const apexNorth = north.reduce((best, p) => (p.y < best.y ? p : best));
    expect(apexNorth.y).toBeLessThan(at.y);
    expect(Math.abs(apexNorth.x - at.x)).toBeLessThan(0.001);
  });
});

describe("the curvature comb", () => {
  const ring = () => {
    const ids = counterIds("cc");
    const k = 140;
    return contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 250), { type: "smooth", in: vec(-k, 250), out: vec(k, 250) }),
        node(ids.node(), vec(250, 0), { type: "smooth", in: vec(250, k), out: vec(250, -k) }),
        node(ids.node(), vec(0, -250), { type: "smooth", in: vec(k, -250), out: vec(-k, -250) }),
        node(ids.node(), vec(-250, 0), { type: "smooth", in: vec(-250, -k), out: vec(-250, k) }),
      ],
      true,
    );
  };

  const combed = (extra: Record<string, unknown> = {}) => {
    const c = ring();
    return {
      ...base(c),
      comb: combFor([c], VIEW),
      options: { showCurvature: true },
      ...extra,
    };
  };

  it("draws nothing unless it is asked for", () => {
    // Off by default: it is an instrument, and it covers the letter in hairs.
    const ctx = render({ ...combed(), options: { showCurvature: false } });
    expect(ctx.all("stroke")).toHaveLength(
      render({ ...base(ring()), options: { showCurvature: false } }).all("stroke").length,
    );
  });

  it("draws a hair from the outline outward, and an envelope through the tips", () => {
    const ctx = render(combed());
    const hair = combFor([ring()], VIEW)[0]!.runs[0]![0]!;

    const foot = toScreen(VIEW, hair.at);
    // The hair stands out of the ink: along the normal, as far as it was told.
    const tip = toScreen(VIEW, {
      x: hair.at.x + hair.normal.x * hair.reach,
      y: hair.at.y + hair.normal.y * hair.reach,
    });

    const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y) < 0.001;

    const moves = ctx.all("moveTo").map((o) => ({ x: o.args[0]!, y: o.args[1]! }));
    const lines = ctx.all("lineTo").map((o) => ({ x: o.args[0]!, y: o.args[1]! }));

    expect(moves.some((p) => near(p, foot))).toBe(true);
    expect(lines.some((p) => near(p, tip))).toBe(true);
    // The envelope passes through the same tip, so it appears twice: once as the
    // end of its hair and once as a point on the line joining them.
    expect(
      lines.filter((p) => near(p, tip)).length + moves.filter((p) => near(p, tip)).length,
    ).toBeGreaterThan(1);
  });
});

/**
 * The section ruler's stops: a tick at each, and the angle the ruler meets
 * each at. The points are far apart so no label is crowded out.
 */
describe("the section ruler's stops", () => {
  it("labels the angle at every stop, edges and guides alike", () => {
    const ctx = render({
      ...base(ring()),
      section: {
        from: vec(0, 0),
        to: vec(4000, 0),
        crossings: [vec(0, 0)],
        stops: [
          { point: vec(0, 0), kind: "outline", angle: 90 },
          { point: vec(4000, 0), kind: "guide", angle: 45 },
        ],
        spans: [],
      },
    });
    const texts = ctx.texts();

    expect(texts).toContain("90°");
    expect(texts).toContain("45°");
  });

  it("says nothing about the angle where the outline has no direction", () => {
    const ctx = render({
      ...base(ring()),
      section: {
        from: vec(0, 0),
        to: vec(4000, 0),
        crossings: [vec(0, 0)],
        stops: [{ point: vec(0, 0), kind: "outline", angle: null }],
        spans: [{ from: vec(0, 0), to: vec(4000, 0), distance: 4000, ink: true }],
      },
    });
    const texts = ctx.texts();

    // The width is labelled, so text is being read; only the angle is missing.
    expect(texts).toContain("4000");
    expect(texts.some((t) => t.endsWith("°"))).toBe(false);
  });
});
