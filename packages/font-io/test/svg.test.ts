import {
  DEFAULT_FONT_INFO,
  contourBounds,
  contourWinding,
  counterIds,
  fontDocument,
  glyph,
  setFixedPitch,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { contoursFromSvg, glyphsFromSvgs, parseSvg, svgPlacement } from "../src/svg.js";

/**
 * An SVG read as a drawing a glyph can be made from.
 *
 * Icons are drawn in SVG, in a square, y running down, as fills or as strokes.
 * These ask that the shapes are read as a browser draws them, and that they land
 * in a font where an icon belongs: scaled to the line box, on whole units.
 */

const svg = (body: string, attributes = 'viewBox="0 0 24 24"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`;

const read = (source: string) => {
  const drawing = parseSvg(source);
  if (drawing === null) throw new Error("not an SVG");
  return drawing;
};

/** A font whose line box is 960 units tall, so a 24 unit drawing is 40 to the unit. */
const font = () =>
  fontDocument([glyph(".notdef", { advance: 500 })], {
    ...DEFAULT_FONT_INFO,
    unitsPerEm: 960,
    ascender: 720,
    descender: -240,
  });

const contours = (source: string, document = font()) => {
  const drawing = read(source);
  return contoursFromSvg(drawing, svgPlacement(drawing, document), counterIds("svg"));
};

const box = (source: string, document = font()) => {
  const all = contours(source, document).map((c) => contourBounds(c)!);
  return {
    minX: Math.min(...all.map((b) => b.minX)),
    minY: Math.min(...all.map((b) => b.minY)),
    maxX: Math.max(...all.map((b) => b.maxX)),
    maxY: Math.max(...all.map((b) => b.maxY)),
  };
};

describe("reading an SVG", () => {
  it("is nothing where the text is not an SVG", () => {
    expect(parseSvg("hello")).toBeNull();
    expect(parseSvg("<html><body/></html>")).toBeNull();
  });

  it("takes the view box, or the width and height where there is none", () => {
    expect(read(svg("", 'viewBox="2 4 24 48"')).viewBox).toEqual({
      x: 2,
      y: 4,
      width: 24,
      height: 48,
    });
    expect(read(svg("", 'width="16px" height="16"')).viewBox).toEqual({
      x: 0,
      y: 0,
      width: 16,
      height: 16,
    });
  });

  it("reads path data written as tightly as it is allowed to be", () => {
    // Relative moves, a horizontal and a vertical, numbers run together, and an
    // arc whose two flags share a run of digits with the number after them.
    const drawing = read(svg('<path d="M2 2h4v4H2zm10 0l2-.5.5.5a1 1 0 011 1"/>'));
    const [shape] = drawing.shapes;
    const kinds = shape!.commands.map((c) => c.type).join("");
    expect(kinds).toBe("MLLLZMLLC");
    const last = shape!.commands[shape!.commands.length - 1]!;
    expect(last).toMatchObject({ type: "C", x: 15.5, y: 3 });
    // The second subpath starts from where the first closed back to.
    expect(shape!.commands[5]).toEqual({ type: "M", x: 12, y: 2 });
  });

  it("reflects the control point of a smooth curve", () => {
    const [shape] = read(svg('<path d="M0 0C0 4 4 4 4 0S8-4 8 0"/>')).shapes;
    expect(shape!.commands[2]).toEqual({ type: "C", x1: 4, y1: -4, x2: 8, y2: -4, x: 8, y: 0 });
  });

  it("draws an arc through the points a circle goes through", () => {
    // Half a circle of radius 5 from (0, 5) to (10, 5), over the top.
    const [shape] = read(svg('<path d="M0 5A5 5 0 0 1 10 5"/>')).shapes;
    const curves = shape!.commands.filter((c) => c.type === "C");
    expect(curves).toHaveLength(2);
    expect(curves[0]!.x).toBeCloseTo(5, 6);
    expect(curves[0]!.y).toBeCloseTo(0, 6);
  });

  it("reads the basic shapes", () => {
    const drawing = read(
      svg(
        '<rect x="2" y="2" width="8" height="6"/>' +
          '<rect x="2" y="2" width="8" height="6" rx="2"/>' +
          '<circle cx="12" cy="12" r="4"/>' +
          '<ellipse cx="12" cy="12" rx="4" ry="2"/>' +
          '<polygon points="0,0 4,0 2,4"/>' +
          '<polyline points="0,0 4,0 2,4" fill="none" stroke="black"/>' +
          '<line x1="0" y1="0" x2="4" y2="4" stroke="black"/>',
      ),
    );
    expect(drawing.shapes.map((s) => s.commands.map((c) => c.type).join(""))).toEqual([
      "MLLLZ",
      "MLCLCLCLCZ",
      "MCCCCZ",
      "MCCCCZ",
      "MLLZ",
      "MLL",
      "ML",
    ]);
    // A line has no inside, whatever it inherits for a fill.
    expect(drawing.shapes[6]).toMatchObject({ filled: false, stroke: { width: 1 } });
  });

  it("applies the transforms above a shape, outermost first", () => {
    const [shape] = read(
      svg('<g transform="translate(10 0)"><rect width="2" height="2" transform="scale(2)"/></g>'),
    ).shapes;
    const xs = shape!.commands.flatMap((c) => (c.type === "Z" ? [] : [c.x]));
    expect(Math.min(...xs)).toBe(10);
    expect(Math.max(...xs)).toBe(14);
  });

  it("takes paint from attributes, classes and style, the nearest winning", () => {
    const drawing = read(
      svg(
        "<style>.line{fill:none;stroke:#000;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}</style>" +
          '<g fill="none" stroke="currentColor" stroke-width="3">' +
          '<path d="M2 2L8 8"/>' +
          '<path class="line" d="M2 2L8 8"/>' +
          '<path d="M2 2L8 8" style="stroke-width: 4"/>' +
          '<path d="M2 2L8 8L2 8z" stroke="none" fill="black"/>' +
          '<path d="M2 2L8 8" stroke="none"/>' +
          '<path d="M2 2L8 8" display="none"/>' +
          "</g>",
      ),
    );
    expect(drawing.shapes.map((s) => [s.filled, s.stroke?.width ?? null])).toEqual([
      [false, 3],
      [false, 2],
      [false, 4],
      [true, null],
    ]);
  });

  it("says what it left out and what it changed, once each", () => {
    const drawing = read(
      svg(
        '<text x="0" y="10">hi</text><text>again</text><image href="a.png"/>' +
          '<path d="M2 2L8 8" fill="none" stroke="black"/>' +
          '<path d="M2 4L8 9" fill="none" stroke="black"/>',
      ),
    );
    expect(drawing.warnings).toEqual([
      "Left out text, which is not drawn as shapes.",
      "Left out a picture.",
      "Strokes with square ends or mitred corners came in with round ones.",
    ]);
    const round = read(
      svg(
        '<path d="M2 2L8 8" fill="none" stroke="black" stroke-linecap="round" stroke-linejoin="round"/>',
      ),
    );
    expect(round.warnings).toEqual([]);
  });
});

describe("a drawing placed in a font", () => {
  it("runs from the descender to the ascender, on whole units", () => {
    const drawing = read(svg('<rect x="0" y="0" width="24" height="24"/>'));
    expect(svgPlacement(drawing, font())).toEqual({ scale: 40, left: 0, top: 720, advance: 960 });
    expect(box(svg('<rect x="0" y="0" width="24" height="24"/>'))).toEqual({
      minX: 0,
      minY: -240,
      maxX: 960,
      maxY: 720,
    });
    // Half a unit of the drawing is twenty of the font's: still whole.
    expect(box(svg('<rect x="2.5" y="3" width="4" height="6"/>'))).toEqual({
      minX: 100,
      minY: 360,
      maxX: 260,
      maxY: 600,
    });
  });

  it("is centred in the fixed width of a font that has one", () => {
    const fixed = setFixedPitch(font(), true, 1200);
    const drawing = read(svg('<rect x="0" y="0" width="24" height="24"/>'));
    expect(svgPlacement(drawing, fixed)).toMatchObject({ left: 120, advance: 1200 });
    expect(box(svg('<rect x="0" y="0" width="24" height="24"/>'), fixed).minX).toBe(120);
  });

  it("turns a filled shape so its outside runs anticlockwise, and keeps its holes", () => {
    // Drawn clockwise on screen with a hole drawn the other way, as paths
    // usually are; upside down in a font that is the right way round already.
    const ring = contours(svg('<path d="M2 2H22V22H2zM8 8V16H16V8z"/>'));
    expect(ring).toHaveLength(2);
    expect(contourWinding(ring[0]!)).toBeGreaterThan(0);
    expect(contourWinding(ring[1]!)).toBeLessThan(0);
  });

  it("makes a hole of a shape inside a shape where the fill is even-odd", () => {
    // Both squares drawn the same way round: a hole by the even-odd rule only.
    const ring = contours(svg('<path fill-rule="evenodd" d="M2 2H22V22H2zM8 8H16V16H8z"/>'));
    expect(contourWinding(ring[0]!)).toBeGreaterThan(0);
    expect(contourWinding(ring[1]!)).toBeLessThan(0);
  });

  it("runs two overlapping shapes the same way, so both are ink", () => {
    const two = contours(svg('<path d="M2 2H12V12H2z"/><path d="M8 8V18H18V8z"/>'));
    expect(two.map((c) => Math.sign(contourWinding(c)))).toEqual([1, 1]);
  });

  it("closes an open path that is filled, as a fill does", () => {
    const [filled] = contours(svg('<path d="M2 2H12V12"/>'));
    expect(filled!.closed).toBe(true);
    expect(filled!.nodes).toHaveLength(3);
  });

  it("brings a stroke in as a path drawn with a round pen of its width", () => {
    const [line, shape] = contours(
      svg(
        '<path d="M4 4L20 20" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<circle cx="12" cy="12" r="6" fill="none" stroke="black" stroke-width="1.5"/>',
      ),
    );
    expect(line!.closed).toBe(false);
    expect(line!.nib).toEqual({ angle: 0, width: 80, thickness: 80 });
    expect(line!.nodes.map((n) => n.pt)).toEqual([
      { x: 160, y: 560 },
      { x: 800, y: -80 },
    ]);
    expect(shape!.closed).toBe(true);
    expect(shape!.nib).toEqual({ angle: 0, width: 60, thickness: 60 });
  });

  it("scales a stroke's width by the transforms above it", () => {
    const [line] = contours(
      svg('<g transform="scale(2)"><path d="M2 2L8 8" fill="none" stroke="black"/></g>'),
    );
    expect(line!.nib?.width).toBe(80);
  });

  it("brings a shape both filled and stroked in as both", () => {
    const both = contours(svg('<rect x="4" y="4" width="8" height="8" stroke="black"/>'));
    expect(both.map((c) => c.nib === undefined)).toEqual([true, false]);
  });
});

describe("a set of SVG files as glyphs", () => {
  const square = svg('<rect x="4" y="4" width="16" height="16"/>');
  const stroked = svg('<path d="M4 4L20 20" fill="none" stroke="black"/>');

  it("makes a glyph of each, named for its file, at the next free private-use code points", () => {
    const document = fontDocument([
      glyph(".notdef", { advance: 500 }),
      glyph("taken", { advance: 500, unicodes: [0xe000] }),
    ]);
    const made = glyphsFromSvgs(
      [
        { name: "arrow-left.svg", text: square },
        { name: "Home.SVG", text: stroked },
      ],
      document,
      counterIds("set"),
    );

    expect(made.glyphs.map((g) => [g.name, g.unicodes, g.advance])).toEqual([
      ["arrow_left", [0xe001], 1000],
      ["Home", [0xe002], 1000],
    ]);
    expect(made.glyphs[0]!.contours).toHaveLength(1);
    expect(made.skipped).toEqual([]);
    expect(made.warnings).toEqual([
      {
        glyph: "Home",
        message: "Strokes with square ends or mitred corners came in with round ones.",
      },
    ]);
  });

  it("leaves out what is not an SVG, what draws nothing, and a name the font has", () => {
    const document = fontDocument([glyph("home", { advance: 500 })]);
    const made = glyphsFromSvgs(
      [
        { name: "home.svg", text: square },
        { name: "notes.svg", text: "not a drawing" },
        { name: "empty.svg", text: svg("<text>hi</text>") },
        { name: "---.svg", text: square },
        { name: "star.svg", text: square },
        // Two files that come to one name: the second is the one left out.
        { name: "star!.svg", text: square },
      ],
      document,
      counterIds("set"),
    );

    expect(made.glyphs.map((g) => g.name)).toEqual(["star"]);
    // The code point after none: the ones left out did not use any up.
    expect(made.glyphs[0]!.unicodes).toEqual([0xe000]);
    expect(made.skipped).toEqual([
      { file: "home.svg", why: "the font already has home, which is not an icon" },
      { file: "notes.svg", why: "it is not an SVG" },
      { file: "empty.svg", why: "it has no shapes a glyph can hold" },
      { file: "---.svg", why: "its name has nothing a glyph can be called" },
      { file: "star!.svg", why: "another file in this set is already star" },
    ]);
    expect(made.replaced).toEqual([]);
  });

  it("redraws an icon the font already has, and keeps what it is known by", () => {
    const old = glyph("home", {
      advance: 800,
      unicodes: [0xe040],
      contours: contours(svg('<rect x="2" y="2" width="4" height="4"/>')),
      anchors: [{ id: "a1", name: "top", pt: { x: 400, y: 700 } }],
      markColor: "1,0,0,1",
    });
    const document = fontDocument([old, glyph("a", { advance: 500, unicodes: [0x61] })]);
    const made = glyphsFromSvgs(
      [
        { name: "home.svg", text: square },
        { name: "a.svg", text: square },
        { name: "new.svg", text: square },
        // The same icon twice in one set: the first file is the one taken.
        { name: "home!.svg", text: stroked },
      ],
      document,
      counterIds("again"),
    );

    expect(made.glyphs.map((g) => g.name)).toEqual(["new"]);
    expect(made.replaced).toHaveLength(1);
    const home = made.replaced[0]!;
    // The drawing and the width are the file's.
    expect(home.advance).toBe(1000);
    expect(home.contours).toHaveLength(1);
    expect(contourBounds(home.contours[0]!)?.minX).toBeCloseTo(167, 0);
    // And everything it is known by is as it was.
    expect(home.name).toBe("home");
    expect(home.unicodes).toEqual([0xe040]);
    expect(home.anchors).toEqual(old.anchors);
    expect(home.markColor).toBe("1,0,0,1");
    // The letter is never drawn over, whatever the file is called.
    expect(made.skipped).toEqual([
      { file: "a.svg", why: "the font already has a, which is not an icon" },
      { file: "home!.svg", why: "another file in this set is already home" },
    ]);
  });
});
