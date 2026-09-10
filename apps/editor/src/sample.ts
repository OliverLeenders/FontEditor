import { vec } from "@typewright/geometry";
import {
  type Contour,
  type FontDocument,
  type Glyph,
  addContour,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
} from "@typewright/font-model";

/** The usual constant for approximating a quarter circle with a cubic. */
const K = 0.5523;

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

function box(
  ids: ReturnType<typeof counterIds>,
  x: number,
  y: number,
  w: number,
  h: number,
): Contour {
  return contour(
    ids.contour(),
    [
      node(ids.node(), vec(x, y)),
      node(ids.node(), vec(x + w, y)),
      node(ids.node(), vec(x + w, y + h)),
      node(ids.node(), vec(x, y + h)),
    ],
    true,
  );
}

function ring(name: string, codePoint: number): Glyph {
  const ids = counterIds(`${name}-`);
  return addContour(
    addContour(
      glyph(name, { unicodes: [codePoint], advance: 600 }),
      ellipse(ids, 300, 250, 240, 260, false),
    ),
    ellipse(ids, 300, 250, 130, 150, true),
  );
}

function stem(name: string, codePoint: number): Glyph {
  const ids = counterIds(`${name}-`);
  return addContour(
    glyph(name, { unicodes: [codePoint], advance: 300 }),
    box(ids, 100, 0, 100, 700),
  );
}

function shortStem(name: string, codePoint: number): Glyph {
  const ids = counterIds(`${name}-`);
  return addContour(
    glyph(name, { unicodes: [codePoint], advance: 300 }),
    box(ids, 100, 0, 100, 500),
  );
}

function blank(name: string, codePoint: number, advance: number): Glyph {
  return glyph(name, { unicodes: [codePoint], advance });
}

/**
 * Enough of a font to type a word with.
 *
 * Crude on purpose — the shapes only have to be distinguishable, and drawing a
 * real alphabet by hand here would be inventing work. `hello` resolves
 * completely, which is what the glyph strip needs to be worth looking at.
 */
export function starterFont(): FontDocument {
  return fontDocument([
    ring("o", 0x6f),
    ring("e", 0x65),
    ring("c", 0x63),
    stem("l", 0x6c),
    stem("h", 0x68),
    shortStem("i", 0x69),
    shortStem("n", 0x6e),
    blank("space", 0x20, 250),
    // Last rather than first, though the compiled font puts it at the front:
    // the editor opens on the first glyph, and a letter is a better thing to
    // open on than the box shown for characters the font does not have.
    glyph(".notdef", { advance: 500 }),
  ]);
}
