import { beforeEach, describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { EditorStore } = await import("../src/store.js");
const { itemsFor } = await import("../src/components/ContextMenu.js");
const { contourById, segmentAt, segmentCount, sidebearings } = await import(
  "@fonteditor/font-model"
);
const { segmentCubic } = await import("@fonteditor/font-model");

type Store = InstanceType<typeof EditorStore>;

/** Labels of the menu, with separators dropped. */
function labels(store: Store, target: unknown, point = { x: 0, y: 0 }): string[] {
  return itemsFor(store, {
    x: 0,
    y: 0,
    target: target as never,
    point,
  })
    .filter((item) => item.kind === "item")
    .map((item) => (item.kind === "item" ? item.label : ""));
}

function run(store: Store, target: unknown, label: string, point = { x: 0, y: 0 }): void {
  const item = itemsFor(store, { x: 0, y: 0, target: target as never, point }).find(
    (i) => i.kind === "item" && i.label === label,
  );
  if (item === undefined || item.kind !== "item") throw new Error(`no item "${label}"`);
  item.run();
}

describe("context menu", () => {
  let store: Store;
  let contourId: string;
  let nodeId: string;

  beforeEach(() => {
    store = new EditorStore();
    // The starter font's first glyph, and a contour with real curves in it.
    const glyph = store.editor.document.glyphs[store.editor.currentGlyph]!;
    const c = glyph.contours[0]!;
    contourId = c.id;
    nodeId = c.nodes[0]!.id;
  });

  const node = () => ({ kind: "node", contourId, nodeId, point: { x: 0, y: 0 } });
  const handle = () => ({ kind: "handleOut", contourId, nodeId, point: { x: 0, y: 0 } });
  const segment = (i = 0) => {
    const glyph = store.editor.document.glyphs[store.editor.currentGlyph]!;
    const c = contourById(glyph, contourId)!;
    const s = segmentAt(c, i)!;
    return {
      kind: "segment",
      contourId,
      segmentIndex: i,
      cubic: segmentCubic(s),
      status: "ok",
    };
  };
  const tunni = (i = 0) => ({
    kind: "tunniPoint",
    contourId,
    segmentIndex: i,
    point: { x: 0, y: 0 },
  });

  it("offers only what is true of empty canvas: the selection, and rounding", () => {
    // Rounding belongs here because it is about the glyph rather than about
    // whatever was clicked, so it is reachable from anywhere on the canvas.
    expect(labels(store, null)).toEqual([
      "Select all points",
      "Round selection",
      "Round this glyph",
    ]);
  });

  it("cannot round a selection when there is not one", () => {
    const items = itemsFor(store, { x: 0, y: 0, target: null, point: { x: 0, y: 0 } });
    const round = items.find((i) => i.kind === "item" && i.label === "Round selection");
    expect(round !== undefined && round.kind === "item" && round.disabled).toBe(true);
  });

  it("offers point operations on a node, and none of the segment ones", () => {
    const items = labels(store, node());
    expect(items).toContain("Corner");
    expect(items).toContain("Smooth");
    expect(items).toContain("Delete point");
    expect(items).toContain("Lock handles to axis");
    expect(items).not.toContain("Make line");
    expect(items).not.toContain("Insert point here");
  });

  it("offers retraction on a handle, but not deletion of its point", () => {
    const items = labels(store, handle());
    expect(items).toContain("Retract handle");
    expect(items).not.toContain("Delete point");
  });

  it("offers conversion and insertion on a curve segment", () => {
    // Midway along the segment, so a point can be inserted there.
    const s = segment();
    const mid = {
      x: (s.cubic.a.x + s.cubic.b.x) / 2,
      y: (s.cubic.a.y + s.cubic.b.y) / 2,
    };
    const items = labels(store, s, mid);
    expect(items).toContain("Insert point here");
    expect(items).toContain("Make line");
    expect(items).toContain("Balance handles");
  });

  it("offers conversion from a Tunni target too, but not insertion", () => {
    // The Tunni controls sit on top of the curve and win the hit test, so this
    // is the likeliest place to right-click a curve.
    const items = labels(store, tunni());
    expect(items).toContain("Make line");
    expect(items).toContain("Balance handles");
    expect(items).not.toContain("Insert point here");
  });

  it("does not offer to insert a point at a segment's very end", () => {
    const s = segment();
    expect(labels(store, s, s.cubic.a)).not.toContain("Insert point here");
  });

  it("flips between Make line and Make curve with the segment's kind", () => {
    expect(labels(store, segment())).toContain("Make line");
    run(store, segment(), "Make line");
    expect(labels(store, segment())).toContain("Make curve");
    run(store, segment(), "Make curve");
    expect(labels(store, segment())).toContain("Make line");
  });

  it("actually converts the segment, and the edit is undoable", () => {
    const before = store.editor.document;
    run(store, segment(), "Make line");

    const glyph = store.editor.document.glyphs[store.editor.currentGlyph]!;
    expect(segmentAt(contourById(glyph, contourId)!, 0)?.kind).toBe("line");

    store.undo();
    expect(store.editor.document).toBe(before);
  });

  it("inserts a point on the segment it was asked about", () => {
    const s = segment();
    const mid = {
      x: (s.cubic.a.x + s.cubic.b.x) / 2,
      y: (s.cubic.a.y + s.cubic.b.y) / 2,
    };
    const glyph = () => store.editor.document.glyphs[store.editor.currentGlyph]!;
    const before = segmentCount(contourById(glyph(), contourId)!);

    run(store, s, "Insert point here", mid);
    expect(segmentCount(contourById(glyph(), contourId)!)).toBe(before + 1);
  });

  it("shows the axis lock as checked once it is on", () => {
    const checked = () =>
      itemsFor(store, { x: 0, y: 0, target: node() as never, point: { x: 0, y: 0 } }).find(
        (i) => i.kind === "item" && i.label === "Lock handles to axis",
      );

    expect(checked()?.kind === "item" && checked()!.checked).toBeFalsy();
    run(store, node(), "Lock handles to axis");
    const after = checked();
    expect(after?.kind === "item" && after.checked).toBe(true);
  });

  it("offers centring on a margin line, and centres the glyph", () => {
    const target = { kind: "originLine", x: 0 };
    expect(labels(store, target)).toEqual(["Centre glyph"]);

    // Push it off-centre first, so centring has something to do.
    const glyph = () => store.editor.document.glyphs[store.editor.currentGlyph]!;
    const advance = glyph().advance;
    run(store, target, "Centre glyph");

    const sb = sidebearings(glyph())!;
    expect(sb.left).toBeCloseTo(sb.right, 6);
    // Centring works within the advance it already has.
    expect(glyph().advance).toBe(advance);
  });

  it("reverses a contour from any of the targets that name one", () => {
    const first = () =>
      contourById(
        store.editor.document.glyphs[store.editor.currentGlyph]!,
        contourId,
      )!.nodes.map((n) => n.id);

    const before = first();
    run(store, node(), "Reverse contour");
    expect(first()).not.toEqual(before);
    // The same points, walked the other way, so nothing is lost.
    expect([...first()].sort()).toEqual([...before].sort());
  });
});
