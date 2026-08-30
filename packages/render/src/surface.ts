import type { Vec2 } from "@fonteditor/geometry";

import type { Canvas2D } from "./context.js";

/**
 * The canvas element, the device-pixel ratio, and the frame loop.
 *
 * The only file in this package that touches the DOM. It deliberately knows
 * nothing about glyphs, views or palettes — it hands a context and a size to a
 * callback and gets out of the way, so all the drawing decisions stay in
 * `draw.ts` where they can be tested.
 *
 * Redraws are scheduled, never immediate. A pointer move can call
 * {@link invalidate} fifty times before the next frame and the canvas is still
 * drawn exactly once — which is the rule that keeps a drag at sixty frames a
 * second regardless of how chatty the input is.
 */
export type FrameCallback = (ctx: Canvas2D, size: { width: number; height: number }) => void;

export class CanvasSurface {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /**
   * The same context, narrowed to what the renderer is allowed to use.
   *
   * A real context types `fillStyle` as `string | CanvasGradient | CanvasPattern`,
   * which is wider than {@link Canvas2D}'s `string`, so it is not structurally
   * assignable however closely the rest matches. Narrowing a paint style is
   * exactly the restriction the renderer wants — it only ever assigns colour
   * strings — so this is one deliberate cast at the DOM boundary rather than a
   * hole in the type. Widening `Canvas2D` instead would drag `CanvasGradient`
   * into the drawing code and defeat the point of hand-writing the interface.
   */
  private readonly target: Canvas2D;
  private readonly onFrame: FrameCallback;
  private readonly observer: ResizeObserver | null;

  private frame: number | null = null;
  private dirty = true;
  private running = false;
  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement, onFrame: FrameCallback) {
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("This browser did not provide a 2D canvas context.");

    this.canvas = canvas;
    this.ctx = ctx;
    this.target = ctx as unknown as Canvas2D;
    this.onFrame = onFrame;

    this.observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => this.resize())
      : null;
    this.observer?.observe(canvas);

    this.resize();
  }

  /** The canvas size in CSS pixels — the coordinate space drawing happens in. */
  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * Match the backing store to the element's CSS size times the device pixel
   * ratio, then scale the context so all drawing can be done in CSS pixels.
   * Without this the canvas is soft on every retina display.
   */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.invalidate();
  }

  /** Ask for a redraw on the next frame. Cheap, and safe to call repeatedly. */
  invalidate(): void {
    this.dirty = true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = (): void => {
      if (!this.running) return;
      if (this.dirty) {
        this.dirty = false;
        this.onFrame(this.target, this.size);
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  /** Convert a pointer event's client coordinates into canvas CSS pixels. */
  toCanvasPoint(event: { clientX: number; clientY: number }): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  destroy(): void {
    this.stop();
    this.observer?.disconnect();
  }
}
