import type { Canvas2D } from "../src/context.js";

/**
 * One recorded drawing call, with the context state that was in force when it
 * happened.
 *
 * Capturing style at call time is the whole trick: canvas is a stateful API, so
 * "what colour was this stroked in" is only answerable at the moment of the
 * stroke. Recording it afterwards would report whatever the last operation left
 * behind.
 */
export type Op = {
  readonly op: string;
  readonly args: readonly number[];
  readonly fillStyle: string;
  readonly strokeStyle: string;
  readonly lineWidth: number;
  readonly globalAlpha: number;
  readonly lineDash: readonly number[];
  /** Set only by `fillText`, whose payload is not numbers. */
  readonly text?: string;
  readonly font?: string;
};

/**
 * A `Canvas2D` that writes down what it was asked to draw instead of drawing it.
 *
 * Node has no canvas, and adding a native one would buy pixel comparison at the
 * cost of a compiled dependency and brittle image fixtures — poor value for a
 * renderer whose visual language is still moving. What this catches instead is
 * most of what actually goes wrong in a renderer: drawing in the wrong order,
 * drawing something that should be hidden, drawing at the wrong coordinates.
 */
export class RecordingContext implements Canvas2D {
  fillStyle = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  globalAlpha = 1;
  lineJoin: "round" | "bevel" | "miter" = "miter";
  lineCap: "butt" | "round" | "square" = "butt";
  font = "10px sans-serif";
  textAlign: "left" | "center" | "right" = "left";
  textBaseline: "top" | "middle" | "alphabetic" | "bottom" = "alphabetic";

  readonly ops: Op[] = [];
  private dash: readonly number[] = [];
  private readonly stack: Array<Record<string, unknown>> = [];

  private record(op: string, args: readonly number[] = []): void {
    this.ops.push({
      op,
      args,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      globalAlpha: this.globalAlpha,
      lineDash: this.dash,
    });
  }

  save(): void {
    this.stack.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      globalAlpha: this.globalAlpha,
      dash: this.dash,
    });
    this.record("save");
  }

  restore(): void {
    const previous = this.stack.pop();
    if (previous !== undefined) {
      this.fillStyle = previous["fillStyle"] as string;
      this.strokeStyle = previous["strokeStyle"] as string;
      this.lineWidth = previous["lineWidth"] as number;
      this.globalAlpha = previous["globalAlpha"] as number;
      this.dash = previous["dash"] as readonly number[];
    }
    this.record("restore");
  }

  beginPath(): void { this.record("beginPath"); }
  closePath(): void { this.record("closePath"); }
  moveTo(x: number, y: number): void { this.record("moveTo", [x, y]); }
  lineTo(x: number, y: number): void { this.record("lineTo", [x, y]); }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.record("bezierCurveTo", [c1x, c1y, c2x, c2y, x, y]);
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void {
    this.record("arc", [x, y, radius, startAngle, endAngle]);
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.record("rect", [x, y, width, height]);
  }

  fill(): void { this.record("fill"); }
  stroke(): void { this.record("stroke"); }

  clearRect(x: number, y: number, width: number, height: number): void {
    this.record("clearRect", [x, y, width, height]);
  }

  setLineDash(segments: number[]): void {
    this.dash = [...segments];
    this.record("setLineDash", segments);
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.record("fillText", maxWidth === undefined ? [x, y] : [x, y, maxWidth]);
    const last = this.ops[this.ops.length - 1];
    if (last !== undefined) {
      this.ops[this.ops.length - 1] = { ...last, text, font: this.font };
    }
  }

  // ---- queries used by the tests -----------------------------------------

  /** Every recorded call of the given kind, in order. */
  all(op: string): Op[] {
    return this.ops.filter((o) => o.op === op);
  }

  /** Index of the first call of the given kind, or -1. */
  indexOf(op: string): number {
    return this.ops.findIndex((o) => o.op === op);
  }

  /** Index of the first call matching a predicate, or -1. */
  indexWhere(predicate: (op: Op) => boolean): number {
    return this.ops.findIndex(predicate);
  }

  /** Every `arc` whose centre is within `epsilon` of the given point. */
  arcsAt(x: number, y: number, epsilon = 0.5): Op[] {
    return this.all("arc").filter(
      (o) => Math.abs((o.args[0] ?? NaN) - x) <= epsilon && Math.abs((o.args[1] ?? NaN) - y) <= epsilon,
    );
  }

  /**
   * Every `fill` in the given colour.
   *
   * Fill and stroke are kept apart deliberately. Several roles share a hue by
   * design — an on-curve node and the Tunni line are both the accent — so colour
   * alone does not identify what was drawn. What separates them is that a node
   * is filled and the Tunni line is stroked.
   */
  filledIn(colour: string): Op[] {
    return this.ops.filter((o) => o.op === "fill" && o.fillStyle === colour);
  }

  /** The text of every `fillText`, in order. */
  texts(): string[] {
    return this.all("fillText").map((o) => o.text ?? "");
  }

  /** Every `stroke` in the given colour. */
  strokedIn(colour: string): Op[] {
    return this.ops.filter((o) => o.op === "stroke" && o.strokeStyle === colour);
  }

  reset(): void {
    this.ops.length = 0;
    this.stack.length = 0;
  }
}
