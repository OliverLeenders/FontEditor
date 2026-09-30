import { type Cubic, cubic } from "../src/cubic.js";
import type { PenShape, SegmentBlend } from "../src/pen.js";
import type { Vec2 } from "../src/vec2.js";

/**
 * Strokes that have gone wrong, or could: the corners, bends and pinches a
 * stroker gets right or does not. Each is a path, the pen at each of its points,
 * and how each segment blends between them.
 */
export type StrokeCase = {
  readonly name: string;
  readonly curves: readonly Cubic[];
  readonly pens: readonly PenShape[];
  readonly closed: boolean;
  readonly blends?: readonly (SegmentBlend | undefined)[];
};

const p = (x: number, y: number): Vec2 => ({ x, y });
const line = (a: Vec2, b: Vec2): Cubic =>
  cubic(
    a,
    p(a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3),
    p(a.x + ((b.x - a.x) * 2) / 3, a.y + ((b.y - a.y) * 2) / 3),
    b,
  );
const pens = (n: number, pen: PenShape): PenShape[] => Array.from({ length: n }, () => pen);

const round: PenShape = { angle: 0, width: 80, thickness: 80 };
const oval: PenShape = { angle: 30, width: 90, thickness: 36 };
const broad: PenShape = { angle: 30, width: 80, thickness: 0 };

export const STROKE_CASES: readonly StrokeCase[] = [
  {
    name: "a round pen round a sharp V",
    curves: [line(p(0, 0), p(150, 500)), line(p(150, 500), p(300, 0))],
    pens: pens(3, round),
    closed: false,
  },
  {
    name: "an oval pen round a sharp V",
    curves: [line(p(0, 0), p(150, 500)), line(p(150, 500), p(300, 0))],
    pens: pens(3, oval),
    closed: false,
  },
  {
    name: "a broad nib round a sharp V",
    curves: [line(p(0, 0), p(150, 500)), line(p(150, 500), p(300, 0))],
    pens: pens(3, broad),
    closed: false,
  },
  {
    name: "an oval pen round a bend tighter than itself",
    curves: [cubic(p(0, 0), p(0, 300), p(60, 300), p(60, 0))],
    pens: pens(2, oval),
    closed: false,
  },
  {
    name: "a round pen round a hairpin",
    curves: [cubic(p(0, 0), p(0, 400), p(30, 400), p(30, 0))],
    pens: pens(2, round),
    closed: false,
  },
  {
    name: "a broad nib along an S, pinching",
    curves: [cubic(p(0, 0), p(300, 0), p(-100, 400), p(200, 400))],
    pens: pens(2, broad),
    closed: false,
  },
  {
    name: "an oval pen along an S",
    curves: [cubic(p(0, 0), p(300, 0), p(-100, 400), p(200, 400))],
    pens: pens(2, oval),
    closed: false,
  },
  {
    name: "a pen widening along a line",
    curves: [line(p(0, 0), p(400, 100))],
    pens: [
      { angle: 90, width: 20, thickness: 20 },
      { angle: 90, width: 140, thickness: 40 },
    ],
    closed: false,
  },
  {
    name: "a broad nib turning along a curve",
    curves: [cubic(p(0, 0), p(150, 200), p(300, 200), p(450, 0))],
    pens: [
      { angle: 0, width: 90, thickness: 0 },
      { angle: 90, width: 90, thickness: 0 },
    ],
    closed: false,
  },
  {
    name: "an oval pen turning and swelling round a corner",
    curves: [line(p(0, 0), p(0, 400)), cubic(p(0, 400), p(100, 500), p(250, 450), p(300, 300))],
    pens: [
      { angle: 0, width: 60, thickness: 20 },
      { angle: 60, width: 120, thickness: 40 },
      { angle: 120, width: 60, thickness: 20 },
    ],
    closed: false,
    blends: [
      { angle: "smooth", shape: "smooth" },
      { angle: "smooth", shape: "smooth" },
    ],
  },
  {
    name: "a zigzag with a broad nib",
    curves: [
      line(p(0, 0), p(100, 300)),
      line(p(100, 300), p(200, 0)),
      line(p(200, 0), p(300, 300)),
      line(p(300, 300), p(400, 0)),
    ],
    pens: pens(5, broad),
    closed: false,
  },
  {
    name: "an oval pen round a closed square",
    curves: [
      line(p(0, 0), p(400, 0)),
      line(p(400, 0), p(400, 400)),
      line(p(400, 400), p(0, 400)),
      line(p(0, 400), p(0, 0)),
    ],
    pens: pens(4, oval),
    closed: true,
  },
  {
    name: "a round pen round a small closed curve",
    curves: [
      cubic(p(0, 0), p(60, -30), p(120, 30), p(90, 90)),
      cubic(p(90, 90), p(60, 150), p(-30, 60), p(0, 0)),
    ],
    pens: pens(2, round),
    closed: true,
  },
  {
    // A stroke drawn in the editor (0.1.54) whose ink showed a bump and a notch at
    // its corners and converted into an outline full of clustered points: every
    // corner point has its handles pulled onto it.
    name: "a drawn hook with retracted handles",
    curves: [
      cubic(
        p(29.041972630460503, 263.97260813645914),
        p(29.041972630460503, 263.97260813645914),
        p(16.717991358797292, 414.9409556053055),
        p(183.09128720995406, 418.0219227159527),
      ),
      cubic(
        p(183.09128720995406, 418.0219227159527),
        p(349.46458306111083, 421.10288982659995),
        p(343.3025360107422, 224.9467802719331),
        p(343.3025360107422, 224.9467802719331),
      ),
      cubic(
        p(343.3025360107422, 224.9467802719331),
        p(343.3025360107422, 224.9467802719331),
        p(380.27447982573176, 145.86815431084432),
        p(257.0350055963221, 151.00311830010213),
      ),
      cubic(
        p(257.0350055963221, 151.00311830010213),
        p(133.79553136691243, 156.13808228935994),
        p(146.11945622403857, 240.35172865424357),
        p(146.11945622403857, 240.35172865424357),
      ),
    ],
    pens: pens(5, { angle: 30, width: 80, thickness: 20 }),
    closed: false,
  },
  {
    // A stroke drawn in the editor (0.1.54) with a notch on the outside, just
    // past its one corner.
    name: "a drawn J with a sharp corner",
    curves: [
      cubic(
        p(23.173736658481445, 262.013663582845),
        p(23.173736658481445, 266.62302371505064),
        p(99.22817883987369, 370.3336266896764),
        p(228.29026254163028, 369.18128665662505),
      ),
      cubic(
        p(228.29026254163028, 369.18128665662505),
        p(357.3523462433869, 368.0289466235737),
        p(390.7702072018774, 317.32598516931216),
        p(391.9225472349288, 248.18558318622829),
      ),
      cubic(
        p(391.9225472349288, 248.18558318622829),
        p(317.4184872609663, 246.9438488533289),
        p(368.87574657390087, 24.63161677425705),
        p(222.52856237637332, 25.78395680730845),
      ),
      cubic(
        p(222.52856237637332, 25.78395680730845),
        p(76.18137817884576, 26.936296840359848),
        p(61.20095774917758, 67.26819799715878),
        p(62.35329778222898, 123.73285961667729),
      ),
    ],
    pens: pens(5, { angle: 30, width: 80, thickness: 20 }),
    closed: false,
  },
  {
    name: "a path crossing itself",
    curves: [cubic(p(0, 0), p(400, 400), p(400, -100), p(0, 300))],
    pens: pens(2, oval),
    closed: false,
  },
];
