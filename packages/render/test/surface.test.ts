import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasSurface } from "../src/surface.js";

/**
 * The one file in the package that touches the DOM, tested against a canvas and
 * a window written out here.
 *
 * Written by hand rather than with a DOM library: what this file does is
 * arithmetic on a device pixel ratio and a frame loop that must draw once per
 * frame however often it is asked. Both are easier to state against four fake
 * methods than against a real browser, and neither needs one.
 */

type Recorded = { transform: number[] };

function fakeCanvas(width: number, height: number) {
  const recorded: Recorded = { transform: [] };
  const ctx = {
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      recorded.transform = [a, b, c, d, e, f];
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) => (kind === "2d" ? ctx : null),
    getBoundingClientRect: () => ({ width, height, left: 12, top: 30 }),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, recorded };
}

/** Frames run only when the test says so, so "once per frame" can be asserted. */
function fakeWindow(dpr: number) {
  const pending = new Map<number, () => void>();
  let next = 1;

  const globals = globalThis as unknown as Record<string, unknown>;
  globals["window"] = { devicePixelRatio: dpr };
  globals["requestAnimationFrame"] = (fn: () => void): number => {
    const id = next++;
    pending.set(id, fn);
    return id;
  };
  globals["cancelAnimationFrame"] = (id: number): void => {
    pending.delete(id);
  };
  globals["ResizeObserver"] = undefined;

  return {
    /** Run whatever is scheduled now, not what those calls schedule in turn. */
    frame: () => {
      for (const fn of [...pending.values()]) {
        pending.delete([...pending.keys()][0]!);
        fn();
      }
    },
    scheduled: () => pending.size,
  };
}

afterEach(() => {
  const globals = globalThis as unknown as Record<string, unknown>;
  delete globals["window"];
  delete globals["requestAnimationFrame"];
  delete globals["cancelAnimationFrame"];
  delete globals["ResizeObserver"];
});

describe("the canvas surface", () => {
  it("scales the backing store by the device pixel ratio and draws in CSS pixels", () => {
    fakeWindow(2);
    const { canvas, recorded } = fakeCanvas(400, 300);
    const surface = new CanvasSurface(canvas, () => undefined);

    // Without this the canvas is soft on every retina display: the backing store
    // is in device pixels, and the context is scaled so drawing is not.
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(recorded.transform).toEqual([2, 0, 0, 2, 0, 0]);
    expect(surface.size).toEqual({ width: 400, height: 300 });
  });

  it("rounds the element's size, and never reports nothing at all", () => {
    fakeWindow(1);
    const { canvas } = fakeCanvas(0, 100.4);
    const surface = new CanvasSurface(canvas, () => undefined);

    // A canvas of zero width cannot have a backing store of zero width.
    expect(surface.size).toEqual({ width: 1, height: 100 });
    expect(canvas.width).toBe(1);
  });

  it("draws once a frame however many times it is invalidated", () => {
    const clock = fakeWindow(1);
    const { canvas } = fakeCanvas(200, 100);
    const draw = vi.fn();
    const surface = new CanvasSurface(canvas, draw);

    surface.start();
    // The rule the whole design rests on: a pointer move can ask fifty times
    // before the next frame and the canvas is still drawn exactly once.
    for (let i = 0; i < 50; i++) surface.invalidate();
    clock.frame();
    expect(draw).toHaveBeenCalledTimes(1);

    // And nothing to draw means nothing drawn.
    clock.frame();
    expect(draw).toHaveBeenCalledTimes(1);

    surface.invalidate();
    clock.frame();
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it("hands the frame the size it drew at", () => {
    const clock = fakeWindow(2);
    const { canvas } = fakeCanvas(640, 480);
    const sizes: Array<{ width: number; height: number }> = [];
    const surface = new CanvasSurface(canvas, (_ctx, size) => sizes.push(size));

    surface.start();
    clock.frame();
    expect(sizes).toEqual([{ width: 640, height: 480 }]);
  });

  it("stops when stopped, and starting twice is not two loops", () => {
    const clock = fakeWindow(1);
    const { canvas } = fakeCanvas(100, 100);
    const draw = vi.fn();
    const surface = new CanvasSurface(canvas, draw);

    surface.start();
    surface.start();
    clock.frame();
    expect(draw).toHaveBeenCalledTimes(1);

    surface.stop();
    surface.invalidate();
    clock.frame();
    expect(draw).toHaveBeenCalledTimes(1);
    expect(clock.scheduled()).toBe(0);
  });

  it("turns a pointer's page coordinates into canvas ones", () => {
    fakeWindow(1);
    const { canvas } = fakeCanvas(300, 200);
    const surface = new CanvasSurface(canvas, () => undefined);

    // The element sits at (12, 30) in the page, and drawing happens in CSS
    // pixels, so the ratio does not come into it.
    expect(surface.toCanvasPoint({ clientX: 112, clientY: 130 })).toEqual({ x: 100, y: 100 });
  });

  it("refuses a canvas with no 2D context rather than drawing nowhere", () => {
    fakeWindow(1);
    const canvas = {
      getContext: () => null,
      getBoundingClientRect: () => ({ width: 10, height: 10, left: 0, top: 0 }),
    } as unknown as HTMLCanvasElement;

    expect(() => new CanvasSurface(canvas, () => undefined)).toThrow(/2D canvas context/);
  });
});
