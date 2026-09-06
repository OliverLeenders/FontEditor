import { describe, expect, it } from "vitest";

import {
  TURN_STEP,
  boxContains,
  boxHandlePoint,
  boxPivot,
  boxRotatePoint,
  boxScale,
  boxScaleTransform,
  boxTurn,
  pickBoxHandle,
} from "../src/transformbox.js";

/** A hundred-unit square from the origin, so every number reads at a glance. */
const box = { rect: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, angle: 0 };
const at = (x: number, y: number) => ({ x, y });

describe("where the handles are", () => {
  it("puts the corners on the corners, y-up", () => {
    // Design units grow upward, so the top of the box is its maximum.
    expect(boxHandlePoint(box, "topLeft")).toEqual(at(0, 100));
    expect(boxHandlePoint(box, "bottomRight")).toEqual(at(100, 0));
  });

  it("puts the edge handles halfway along their edges", () => {
    expect(boxHandlePoint(box, "top")).toEqual(at(50, 100));
    expect(boxHandlePoint(box, "left")).toEqual(at(0, 50));
  });
});

describe("picking a handle", () => {
  it("takes one the pointer is on", () => {
    expect(pickBoxHandle(box, at(2, 98), 5)).toEqual({ at: "topLeft", action: "scale" });
    expect(pickBoxHandle(box, at(50, 2), 5)).toEqual({ at: "bottom", action: "scale" });
  });

  it("takes nothing in the middle of the box, which belongs to the outline", () => {
    expect(pickBoxHandle(box, at(50, 50), 5)).toBeNull();
  });

  it("prefers the corner where a corner and an edge overlap", () => {
    // The corner carries two axes; the edge carries one, and is the lesser
    // answer wherever both are true.
    expect(
      pickBoxHandle({ rect: { minX: 0, minY: 0, maxX: 8, maxY: 8 }, angle: 0 }, at(0, 8), 5)?.at,
    ).toBe("topLeft");
  });

  it("turns just outside a corner", () => {
    expect(pickBoxHandle(box, at(-7, 107), 5)).toEqual({ at: "topLeft", action: "rotate" });
    expect(pickBoxHandle(box, at(107, -7), 5)).toEqual({ at: "bottomRight", action: "rotate" });
  });

  it("does not turn beside a corner, only outward of it on both axes", () => {
    // Straight out along one edge is not the ring; it is the space beside the
    // box, where a marquee should start.
    expect(pickBoxHandle(box, at(-7, 50), 5)).toBeNull();
    expect(pickBoxHandle(box, at(50, 107), 5)).toBeNull();
  });

  it("stops turning far enough away", () => {
    expect(pickBoxHandle(box, at(-40, 140), 5)).toBeNull();
  });
});

describe("what a drag from a handle does", () => {
  it("holds the opposite corner still", () => {
    const handle = { at: "topRight", action: "scale" } as const;
    expect(boxPivot(box, handle, false)).toEqual(at(0, 0));
  });

  it("holds the middle instead when asked", () => {
    const handle = { at: "topRight", action: "scale" } as const;
    expect(boxPivot(box, handle, true)).toEqual(at(50, 50));
  });

  it("always turns about the middle", () => {
    expect(boxPivot(box, { at: "topRight", action: "rotate" }, false)).toEqual(at(50, 50));
  });

  it("scales by how far the pointer is over how far the handle was", () => {
    const handle = { at: "topRight", action: "scale" } as const;
    const pivot = boxPivot(box, handle, false);
    expect(boxScale(box, handle, pivot, at(200, 50), false)).toEqual({ x: 2, y: 0.5 });
  });

  it("moves one axis from an edge and leaves the other alone", () => {
    const handle = { at: "right", action: "scale" } as const;
    const pivot = boxPivot(box, handle, false);
    expect(boxScale(box, handle, pivot, at(300, 999), false)).toEqual({ x: 3, y: 1 });
  });

  it("gives both axes the larger factor when held", () => {
    const handle = { at: "topRight", action: "scale" } as const;
    const pivot = boxPivot(box, handle, false);
    expect(boxScale(box, handle, pivot, at(200, 50), true)).toEqual({ x: 2, y: 2 });
  });

  it("keeps a flip a flip while holding the shape", () => {
    // Dragging back through the pivot turns the axis over; the shape is held,
    // but which way round each axis faces is still the drag's to say.
    const handle = { at: "topRight", action: "scale" } as const;
    const pivot = boxPivot(box, handle, false);
    const by = boxScale(box, handle, pivot, at(-200, 50), true);
    expect(by.x).toBe(-2);
    expect(by.y).toBe(2);
  });

  it("leaves an axis alone when the box has no extent along it", () => {
    // Two points in a vertical line: there is no width to compare against, so
    // there is no horizontal factor to be had.
    const flat = { rect: { minX: 50, minY: 0, maxX: 50, maxY: 100 }, angle: 0 };
    const handle = { at: "topRight", action: "scale" } as const;
    const pivot = boxPivot(flat, handle, false);
    expect(boxScale(flat, handle, pivot, at(999, 200), false).x).toBe(1);
  });

  it("turns by the angle swept about the pivot", () => {
    const handle = { at: "bottomRight", action: "rotate" } as const;
    const pivot = boxPivot(box, handle, false);
    // The handle sits south-east of the middle and the pointer south-west of it,
    // which is a quarter turn clockwise — negative, since angles grow the other
    // way in a frame whose y grows upward.
    expect(boxTurn(box, handle, pivot, at(0, 0), false)).toBeCloseTo(-Math.PI / 2, 6);
  });

  it("snaps the angle to steps when held", () => {
    const handle = { at: "bottomRight", action: "rotate" } as const;
    const pivot = boxPivot(box, handle, false);
    const turned = boxTurn(box, handle, pivot, at(2, 0), true);
    expect(turned / TURN_STEP).toBeCloseTo(Math.round(turned / TURN_STEP), 9);
  });
});

/**
 * A box held at a right angle, which is the one turn whose answers can be read
 * off by eye: the frame's x runs up the plane and its y runs left along it.
 */
const turned = { rect: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, angle: Math.PI / 2 };

describe("a box held at an angle", () => {
  it("puts its handles where the turn puts them", () => {
    // The frame's top left, turned a quarter anticlockwise about the origin.
    const p = boxHandlePoint(turned, "topLeft");
    expect(p.x).toBeCloseTo(-100, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it("keeps the middle where it is when the box is square about it", () => {
    const p = boxHandlePoint(turned, "top");
    expect(p.x).toBeCloseTo(-100, 6);
    expect(p.y).toBeCloseTo(50, 6);
  });

  it("picks a handle from the pointer turned back into the frame", () => {
    expect(pickBoxHandle(turned, at(-98, 2), 5)).toEqual({ at: "topLeft", action: "scale" });
    // Where the top left would be if the box were upright is now the bottom
    // right of it: the same corner of the plane, a different corner of the box.
    expect(pickBoxHandle(turned, at(2, 98), 5)).toEqual({
      at: "bottomRight",
      action: "scale",
    });
  });

  it("scales along its own axes rather than the plane's", () => {
    const handle = { at: "top", action: "scale" } as const;
    const pivot = boxPivot(turned, handle, false);
    // The frame's up now points along the plane's −x, so that is the way to pull.
    const by = boxScale(turned, handle, pivot, at(-200, 50), false);
    expect(by.y).toBeCloseTo(2, 6);
    expect(by.x).toBe(1);
  });

  it("turns the scale back into the plane", () => {
    // Doubling the frame's y doubles the plane's x, since the frame is a quarter
    // turn round. What comes out is the transform to apply to the points.
    const t = boxScaleTransform(turned, { x: 1, y: 2 });
    expect(t.xScale).toBeCloseTo(2, 6);
    expect(t.yScale).toBeCloseTo(1, 6);
    expect(t.xyScale).toBeCloseTo(0, 6);
    expect(t.yxScale).toBeCloseTo(0, 6);
  });

  it("hands back the bare scale when there is no angle", () => {
    // Exactly, not nearly: an upright box must go on doing what it always did.
    expect(boxScaleTransform(box, { x: 2, y: 3 })).toEqual({
      xScale: 2,
      xyScale: 0,
      yxScale: 0,
      yScale: 3,
      xOffset: 0,
      yOffset: 0,
    });
  });
});

describe("the turn knob", () => {
  it("stands off the top edge, along the box's own up", () => {
    expect(boxRotatePoint(box, 20)).toEqual(at(50, 120));

    const p = boxRotatePoint(turned, 20);
    expect(p.x).toBeCloseTo(-120, 6);
    expect(p.y).toBeCloseTo(50, 6);
  });

  it("is picked as a turn when a stem is given", () => {
    expect(pickBoxHandle(box, at(50, 120), 5, 20)).toEqual({ at: "top", action: "rotate" });
  });

  it("is not there at all when no stem is given", () => {
    // The renderer decides whether the knob is drawn; a pick that assumed one
    // would take a click over empty canvas.
    expect(pickBoxHandle(box, at(50, 120), 5)).toBeNull();
  });

  it("leaves the top handle its own place", () => {
    expect(pickBoxHandle(box, at(50, 100), 5, 20)).toEqual({ at: "top", action: "scale" });
  });

  it("turns about the middle, from the ray the top edge already names", () => {
    // The knob sits directly above the middle, so a pointer to the left of it is
    // a quarter turn anticlockwise.
    const handle = { at: "top", action: "rotate" } as const;
    const pivot = boxPivot(box, handle, false);
    expect(boxTurn(box, handle, pivot, at(-50, 50), false)).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe("what counts as inside", () => {
  it("takes the box itself, edges included", () => {
    expect(boxContains(box, at(50, 50))).toBe(true);
    expect(boxContains(box, at(0, 0))).toBe(true);
    expect(boxContains(box, at(100, 100))).toBe(true);
    expect(boxContains(box, at(-1, 50))).toBe(false);
    expect(boxContains(box, at(50, 101))).toBe(false);
  });

  it("means the shape that is drawn once the box is turned", () => {
    // Turned a quarter anticlockwise about the origin, the box now covers the
    // plane's second quadrant: its own middle is at (-50, 50), and where the
    // upright box sat is outside it.
    expect(boxContains(turned, at(-50, 50))).toBe(true);
    expect(boxContains(turned, at(50, 50))).toBe(false);
  });
});
