import { vec } from "@fonteditor/geometry";
import {
  type Contour,
  type Glyph,
  addContour,
  contour,
  counterIds,
  glyph,
  node,
} from "@fonteditor/font-model";

/**
 * A lowercase 'o' on a 1000-unit em, with an x-height of 500.
 *
 * Two contours wound in opposite directions so the counter reads as a hole under
 * the canvas's nonzero fill rule — the same convention a real font uses. Both are
 * built from circular arcs, which puts every segment in the `ok` Tunni state and
 * gives the controls something well-behaved to start from.
 */
const K = 0.5523; // the usual constant for approximating a quarter circle

function ellipse(
  ids: ReturnType<typeof counterIds>,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  clockwise: boolean,
): Contour {
  const hx = rx * K;
  const hy = ry * K;
  const s = clockwise ? -1 : 1;

  return contour(
    ids.contour(),
    [
      node(ids.node(), vec(cx + rx, cy), {
        type: "smooth",
        in: vec(cx + rx, cy - s * hy),
        out: vec(cx + rx, cy + s * hy),
      }),
      node(ids.node(), vec(cx, cy + s * ry), {
        type: "smooth",
        in: vec(cx + hx, cy + s * ry),
        out: vec(cx - hx, cy + s * ry),
      }),
      node(ids.node(), vec(cx - rx, cy), {
        type: "smooth",
        in: vec(cx - rx, cy + s * hy),
        out: vec(cx - rx, cy - s * hy),
      }),
      node(ids.node(), vec(cx, cy - s * ry), {
        type: "smooth",
        in: vec(cx - hx, cy - s * ry),
        out: vec(cx + hx, cy - s * ry),
      }),
    ],
    true,
  );
}

function ringGlyph(name: string, codePoint: number): Glyph {
  const ids = counterIds(`${name}-`);
  const outer = ellipse(ids, 300, 250, 240, 260, false);
  const counter = ellipse(ids, 300, 250, 130, 150, true);
  return addContour(
    addContour(glyph(name, { unicodes: [codePoint], advance: 600 }), outer),
    counter,
  );
}

function barGlyph(name: string, codePoint: number): Glyph {
  const ids = counterIds(`${name}-`);
  const stem = contour(
    ids.contour(),
    [
      node(ids.node(), vec(100, 0)),
      node(ids.node(), vec(200, 0)),
      node(ids.node(), vec(200, 700)),
      node(ids.node(), vec(100, 700)),
    ],
    true,
  );
  return addContour(glyph(name, { unicodes: [codePoint], advance: 300 }), stem);
}

/**
 * A few glyphs rather than one, so the glyph strip and the browser have
 * something to show. Deliberately crude — this is a harness, and the shapes only
 * have to be distinguishable from each other.
 */
export function sampleGlyphs(): Glyph[] {
  return [
    ringGlyph("o", 0x6f),
    barGlyph("l", 0x6c),
    ringGlyph("e", 0x65),
    barGlyph("i", 0x69),
    ringGlyph("c", 0x63),
  ];
}

/** Vertical metrics for the guides, in design units. */
export const GUIDES = [
  { y: 0, emphasis: true },
  { y: 500 },
  { y: 700 },
  { y: -200 },
];
