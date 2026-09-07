/**
 * The only drawing surface the renderer knows about.
 *
 * Deliberately hand-written rather than imported as `CanvasRenderingContext2D`:
 * naming exactly the members the renderer uses means the drawing code cannot
 * reach into the DOM even by accident, and means a plain object that records its
 * calls satisfies the same type. A real 2D context conforms structurally, so
 * nothing has to be adapted at the call site.
 *
 * Everything here is in *screen* pixels. Design units stop at the view
 * transform.
 */
export interface Canvas2D {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  lineJoin: "round" | "bevel" | "miter";
  lineCap: "butt" | "round" | "square";
  font: string;
  textAlign: "left" | "center" | "right";
  textBaseline: "top" | "middle" | "alphabetic" | "bottom";

  save(): void;
  restore(): void;
  /**
   * Move and turn the coordinate system, for the one thing that needs it: a
   * label laid along a line that is not level. Everything else is drawn in
   * screen pixels and has no use for a transform.
   */
  translate(x: number, y: number): void;
  rotate(radians: number): void;
  /**
   * Scale and shear, for the one thing that needs a full transform: a picture
   * laid behind a glyph, which is placed by an affine somebody chose.
   */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;

  /**
   * Draw a decoded picture into a rectangle of the canvas.
   *
   * Typed as unknown because the renderer must not know what an `ImageBitmap`
   * is: this package runs in a test under Node, where that type does not exist,
   * and the only thing drawing needs of it is that the canvas accepts it.
   */
  drawImage(image: unknown, x: number, y: number, width: number, height: number): void;

  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  rect(x: number, y: number, width: number, height: number): void;

  fill(): void;
  stroke(): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  setLineDash(segments: number[]): void;
  /** `maxWidth` squeezes over-long glyph names rather than letting them spill. */
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  /**
   * Outline text, used only to lay a halo behind a label so it stays readable
   * over a filled shape. Drawn first, in the background colour, and then filled
   * over.
   */
  strokeText(text: string, x: number, y: number, maxWidth?: number): void;
}
