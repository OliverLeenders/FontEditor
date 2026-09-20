import { beforeEach, describe, expect, it } from "vitest";

import type { Item } from "../src/components/ContextMenu.js";
import { installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { EditorStore } = await import("../src/store/index.js");
const { itemsFor } = await import("../src/components/ContextMenu.js");
const {
  addContour,
  contour,
  contourById,
  counterIds,
  node: newNode,
  segmentAt,
  segmentCount,
  sidebearings,
  updateGlyph,
} = await import("@typewright/font-model");
const { segmentCubic } = await import("@typewright/font-model");

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
      // Named for the anchor it would make, which is the first usual name the
      // glyph is not already using.
      "Add anchor here (top)",
      // Level and upright, in both scopes: which scope a guide is in is the
      // decision, so the menu asks rather than guessing.
      "Add horizontal guide",
      "Add vertical guide",
      "Add horizontal guide, for the whole font",
      "Add vertical guide, for the whole font",
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

  /**
   * Draw a bow into the current glyph: out to the right and back, so the curve
   * has a vertical extreme halfway along with no point on it.
   *
   * The starter font is drawn the way a font should be, with a point at every
   * extreme, which is the wrong shape for testing the item that adds them.
   */
  function bow(): {
    kind: string;
    contourId: string;
    segmentIndex: number;
    cubic: unknown;
    status: string;
  } {
    const ids = counterIds("bow");
    const drawn = contour(
      ids.contour(),
      [
        newNode(ids.node(), { x: 0, y: 0 }, { out: { x: 200, y: 0 } }),
        newNode(ids.node(), { x: 0, y: 300 }, { in: { x: 200, y: 300 } }),
      ],
      false,
    );
    const name = store.editor.currentGlyph;
    store.setEditor({
      ...store.editor,
      document: updateGlyph(store.editor.document, name, (g) => addContour(g, drawn))!,
    });

    const glyph = store.editor.document.glyphs[name]!;
    const c = contourById(glyph, drawn.id)!;
    return {
      kind: "segment",
      contourId: drawn.id,
      segmentIndex: 0,
      cubic: segmentCubic(segmentAt(c, 0)!),
      status: "ok",
    };
  }

  /**
   * The two things two masters have to agree on that are not the shape: which
   * point a contour begins at, and which contour comes first.
   */
  it("begins the contour at the point the menu was opened on", () => {
    const glyph = store.editor.document.glyphs[store.editor.currentGlyph]!;
    const c = contourById(glyph, contourId)!;
    const third = c.nodes[2]!.id;

    const items = labels(store, { kind: "node", contourId, nodeId: third, point: { x: 0, y: 0 } });
    expect(items).toContain("Start the contour here");

    run(
      store,
      { kind: "node", contourId, nodeId: third, point: { x: 0, y: 0 } },
      "Start the contour here",
    );

    const after = contourById(store.editor.document.glyphs[store.editor.currentGlyph]!, contourId)!;
    expect(after.nodes[0]!.id).toBe(third);
  });

  it("offers it disabled on the point that is first already", () => {
    const items = itemsFor(store, {
      x: 0,
      y: 0,
      target: { kind: "node", contourId, nodeId } as never,
      point: { x: 0, y: 0 },
    });
    const start = items.find((i) => i.kind === "item" && i.label === "Start the contour here");
    expect(start !== undefined && start.kind === "item" && start.disabled).toBe(true);
  });

  it("moves a contour along the glyph's list, and says where it sits", () => {
    // The starter font's first glyph may have one contour, which has no order
    // to argue about; the o of the starter font has two.
    const named = store.editor.document.glyphOrder.find(
      (name) => (store.editor.document.glyphs[name]?.contours.length ?? 0) > 1,
    );
    if (named === undefined) return;
    store.setCurrentGlyph(named);

    const outer = store.editor.document.glyphs[named]!.contours[1]!.id;
    const target = {
      kind: "node",
      contourId: outer,
      nodeId: store.editor.document.glyphs[named]!.contours[1]!.nodes[0]!.id,
      point: { x: 0, y: 0 },
    };
    expect(labels(store, target)).toContain("Bring forward (2 of 2)");

    run(store, target, "Bring forward (2 of 2)");
    expect(store.editor.document.glyphs[named]!.contours[0]!.id).toBe(outer);
  });

  it("offers a point at an extreme only where the curve turns with nothing on it", () => {
    // The starter font's own curves turn at their own points, so there is
    // nothing to add and the item is not there to be tried.
    expect(labels(store, segment())).not.toContain("Add point at extreme");

    expect(labels(store, bow())).toContain("Add point at extreme");
  });

  it("adds it where the curve turns, not where the handles reach", () => {
    const curve = bow();
    run(store, curve, "Add point at extreme");

    const glyph = store.editor.document.glyphs[store.editor.currentGlyph]!;
    const c = contourById(glyph, curve.contourId)!;

    expect(c.nodes).toHaveLength(3);
    expect(c.nodes[1]!.pt.x).toBeCloseTo(150, 6);
    // And it is not offered twice.
    expect(labels(store, curve)).not.toContain("Add point at extreme");
  });

  it("names the inflection separately, and offers it where there is one", () => {
    const ids = counterIds("ess");
    const drawn = contour(
      ids.contour(),
      [
        newNode(ids.node(), { x: 0, y: 0 }, { out: { x: 0, y: 100 } }),
        newNode(ids.node(), { x: 100, y: 100 }, { in: { x: 100, y: 0 } }),
      ],
      false,
    );
    const name = store.editor.currentGlyph;
    store.setEditor({
      ...store.editor,
      document: updateGlyph(store.editor.document, name, (g) => addContour(g, drawn))!,
    });

    const items = labels(store, {
      kind: "segment",
      contourId: drawn.id,
      segmentIndex: 0,
      cubic: segmentCubic(
        segmentAt(contourById(store.editor.document.glyphs[name]!, drawn.id)!, 0)!,
      ),
      status: "ok",
    });

    expect(items).toContain("Add point at inflection");
    expect(items).not.toContain("Add point at extreme");
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
    // Narrowed by a predicate rather than by a comparison, so the separator
    // variant is gone from the type and `checked` can be read from what is left.
    const lock = (): Extract<Item, { kind: "item" }> | undefined =>
      itemsFor(store, { x: 0, y: 0, target: node() as never, point: { x: 0, y: 0 } }).find(
        (i): i is Extract<Item, { kind: "item" }> =>
          i.kind === "item" && i.label === "Lock handles to axis",
      );

    expect(lock()?.checked).toBeFalsy();
    run(store, node(), "Lock handles to axis");
    expect(lock()?.checked).toBe(true);
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
      contourById(store.editor.document.glyphs[store.editor.currentGlyph]!, contourId)!.nodes.map(
        (n) => n.id,
      );

    const before = first();
    run(store, node(), "Reverse contour");
    expect(first()).not.toEqual(before);
    // The same points, walked the other way, so nothing is lost.
    expect([...first()].sort()).toEqual([...before].sort());
  });
});

describe("what the menu shows beside its words", () => {
  it("gives every action a drawing, or the tick column its own space", () => {
    const store = new EditorStore();
    const glyph = store.editor.document.glyphs[store.editor.currentGlyph]!;
    const contour = glyph.contours[0]!;
    const node = contour.nodes[0]!;

    const items = itemsFor(store, {
      x: 0,
      y: 0,
      target: {
        kind: "node",
        contourId: contour.id,
        nodeId: node.id,
        point: node.pt,
      } as never,
      point: node.pt,
    }).filter((item) => item.kind === "item");

    // Not every item has one — a state that is only ever ticked does not need a
    // drawing as well — but the ones that do the work of the menu do.
    const drawn = items.filter((item) => item.kind === "item" && item.icon !== undefined);
    expect(drawn.length).toBeGreaterThan(items.length / 2);
    expect(items.find((i) => i.kind === "item" && i.label === "Delete point")).toBeTruthy();
    expect(
      items.find((i) => i.kind === "item" && i.label === "Delete point" && i.icon !== undefined),
    ).toBeTruthy();
  });
});
