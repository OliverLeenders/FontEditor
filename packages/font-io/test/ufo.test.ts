import { IDENTITY_AFFINE, translation } from "@fonteditor/geometry";
import {
  type FontDocument,
  component,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
} from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { contourPoints, exportUfo, glif, ufoFiles } from "../src/ufo.js";

const ids = counterIds();

/** Four nodes, every segment a curve — the ordering a glif has to get right. */
const ring = () =>
  contour(
    ids.contour(),
    [
      node(
        ids.node(),
        { x: 300, y: 0 },
        { type: "smooth", in: { x: 420, y: 0 }, out: { x: 180, y: 0 } },
      ),
      node(
        ids.node(),
        { x: 60, y: 350 },
        { type: "smooth", in: { x: 60, y: 160 }, out: { x: 60, y: 540 } },
      ),
      node(
        ids.node(),
        { x: 300, y: 700 },
        { type: "smooth", in: { x: 180, y: 700 }, out: { x: 420, y: 700 } },
      ),
      node(
        ids.node(),
        { x: 540, y: 350 },
        { type: "smooth", in: { x: 540, y: 540 }, out: { x: 540, y: 160 } },
      ),
    ],
    true,
  );

const triangle = (closed = true) =>
  contour(
    ids.contour(),
    [
      node(ids.node(), { x: 0, y: 0 }),
      node(ids.node(), { x: 300, y: 0 }),
      node(ids.node(), { x: 150, y: 400 }),
    ],
    closed,
  );

const INFO = {
  familyName: "Trip Sans",
  styleName: "Regular",
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  xHeight: 500,
  capHeight: 700,
};

const sample = (): FontDocument =>
  fontDocument(
    [
      glyph("o", { unicodes: [0x6f], advance: 600, contours: [ring()] }),
      glyph("A", { unicodes: [0x41], advance: 500, contours: [triangle()] }),
      glyph("a", { unicodes: [0x61], advance: 500, contours: [triangle()] }),
      glyph("space", { unicodes: [0x20], advance: 250 }),
    ],
    INFO,
  );

describe("contourPoints", () => {
  it("writes a closed curve contour as its cyclic point list", () => {
    const points = contourPoints(ring());

    // Four on-curve points and eight controls, and the controls of the closing
    // segment come last, where they pair with the first point.
    expect(points).toHaveLength(12);
    expect(points.filter((p) => p.type !== undefined)).toHaveLength(4);

    expect(points[0]).toMatchObject({ x: 300, y: 0, type: "curve", smooth: true });
    expect(points[1]).toMatchObject({ x: 180, y: 0 });
    expect(points[2]).toMatchObject({ x: 60, y: 160 });
    expect(points[3]).toMatchObject({ x: 60, y: 350, type: "curve" });

    // The tail: the closing segment's controls, with no on-curve point after.
    expect(points[10]).toMatchObject({ x: 540, y: 160 });
    expect(points[11]).toMatchObject({ x: 420, y: 0 });
    expect(points[11]?.type).toBeUndefined();
  });

  it("writes a closed straight-sided contour as bare line points", () => {
    const points = contourPoints(triangle());
    expect(points).toHaveLength(3);
    expect(points.every((p) => p.type === "line")).toBe(true);
  });

  it("starts an open contour with a move, which is what makes it open", () => {
    const points = contourPoints(triangle(false));
    expect(points[0]?.type).toBe("move");
    expect(points).toHaveLength(3);
  });

  it("marks smooth points, and only on-curve ones", () => {
    const points = contourPoints(ring());
    for (const p of points) {
      if (p.type === undefined) expect(p.smooth).not.toBe(true);
    }
    expect(points.filter((p) => p.smooth === true)).toHaveLength(4);
  });
});

describe("glif", () => {
  it("carries the name, advance and every code point", () => {
    const text = glif(sample().glyphs["o"]!);
    expect(text).toContain('<glyph name="o" format="2">');
    expect(text).toContain('<advance width="600"/>');
    expect(text).toContain('<unicode hex="006F"/>');
  });

  it("writes several code points when a glyph has them", () => {
    const text = glif(glyph("x", { unicodes: [0x78, 0x2093], advance: 400 }));
    expect(text).toContain('<unicode hex="0078"/>');
    expect(text).toContain('<unicode hex="2093"/>');
  });

  it("writes a blank glyph with an empty outline rather than none", () => {
    const text = glif(sample().glyphs["space"]!);
    expect(text).toContain("<outline/>");
    expect(text).toContain('<advance width="250"/>');
  });

  it("escapes a name that would break the XML", () => {
    const text = glif(glyph("a<b&c", { advance: 100 }));
    expect(text).toContain('name="a&lt;b&amp;c"');
  });

  it("rounds coordinates to the integer grid", () => {
    const c = contour(
      ids.contour(),
      [node(ids.node(), { x: 10.4, y: 0.6 }), node(ids.node(), { x: 99.5, y: 3 })],
      true,
    );
    const text = glif(glyph("t", { advance: 100.7, contours: [c] }));
    expect(text).toContain('<advance width="101"/>');
    expect(text).toContain('x="10" y="1"');
  });
});

describe("ufoFiles", () => {
  const files = () => new Map(ufoFiles(sample()).map((f) => [f.path, f.text]));

  it("writes the four files a UFO must have, plus one glif per glyph", () => {
    const map = files();
    expect(map.has("metainfo.plist")).toBe(true);
    expect(map.has("fontinfo.plist")).toBe(true);
    expect(map.has("layercontents.plist")).toBe(true);
    expect(map.has("glyphs/contents.plist")).toBe(true);
    expect([...map.keys()].filter((p) => p.endsWith(".glif"))).toHaveLength(4);
  });

  it("declares format 3", () => {
    expect(files().get("metainfo.plist")).toContain("<integer>3</integer>");
  });

  it("carries the metrics", () => {
    const info = files().get("fontinfo.plist")!;
    expect(info).toContain("<key>familyName</key>");
    expect(info).toContain("<string>Trip Sans</string>");
    expect(info).toContain("<key>unitsPerEm</key>");
    expect(info).toContain("<integer>1000</integer>");
    expect(info).toContain("<integer>-200</integer>");
  });

  it("keeps upper and lower case glyphs in separate files", () => {
    // The reason UFO mangles names at all: a case-insensitive filesystem would
    // otherwise let A and a fight over one file.
    const paths = [...files().keys()];
    expect(paths).toContain("glyphs/A_.glif");
    expect(paths).toContain("glyphs/a.glif");
  });

  it("indexes every glyph at the filename it actually wrote", () => {
    const map = files();
    const contents = map.get("glyphs/contents.plist")!;

    for (const [path] of map) {
      if (!path.endsWith(".glif")) continue;
      expect(contents).toContain(`<string>${path.slice("glyphs/".length)}</string>`);
    }
    for (const name of ["o", "A", "a", "space"]) {
      expect(contents).toContain(`<key>${name}</key>`);
    }
  });

  it("puts the glyphs in a layer the format knows about", () => {
    expect(files().get("layercontents.plist")).toContain("public.default");
  });
});

describe("exportUfo", () => {
  it("names the archive after the font", () => {
    expect(exportUfo(sample()).fileName).toBe("TripSans-Regular.ufo.zip");
  });

  it("puts everything inside one folder, so unzipping gives a .ufo", () => {
    const { bytes } = exportUfo(sample());
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("TripSans-Regular.ufo/metainfo.plist");
    expect(text).toContain("TripSans-Regular.ufo/glyphs/o.glif");
  });

  it("counts what it wrote", () => {
    // Four glyphs plus metainfo, fontinfo, layercontents and contents.
    expect(exportUfo(sample()).files).toBe(8);
  });

  it("falls back where the font is unnamed", () => {
    const document = fontDocument([glyph("a", { advance: 1 })], {
      ...INFO,
      familyName: " ",
      styleName: "",
    });
    expect(exportUfo(document).fileName).toBe("Untitled-Regular.ufo.zip");
  });
});

describe("components", () => {
  const ids = counterIds("k");
  const composite = () =>
    fontDocument(
      [
        glyph("a", { unicodes: [0x61], advance: 500, contours: [triangle()] }),
        glyph("acute", { advance: 0, contours: [triangle()] }),
        glyph("aacute", {
          unicodes: [0xe1],
          advance: 500,
          components: [
            component(ids.component(), "a"),
            component(ids.component(), "acute", translation(120, 400)),
          ],
        }),
      ],
      INFO,
    );

  it("writes a component as a reference, not as outlines", () => {
    const text = glif(composite().glyphs["aacute"]!);
    expect(text).toContain('<component base="a"/>');
    expect(text).toContain('<component base="acute" xOffset="120" yOffset="400"/>');
    // The referenced glyph's points must not appear here.
    expect(text).not.toContain("<point");
  });

  it("omits transform attributes that are already the default", () => {
    // A component that merely sits somewhere writes two numbers, not six.
    const text = glif(composite().glyphs["aacute"]!);
    expect(text).not.toContain("xScale");
    expect(text).not.toContain("yxScale");
  });

  it("writes a scaled or mirrored component in full", () => {
    const mirrored = glyph("x", {
      components: [component("k9", "a", { ...IDENTITY_AFFINE, xScale: -1, xOffset: 500 })],
    });
    const text = glif(mirrored);
    expect(text).toContain('xScale="-1"');
    expect(text).toContain('xOffset="500"');
  });

  it("gives a glyph that is only components a real outline element", () => {
    const text = glif(composite().glyphs["aacute"]!);
    expect(text).not.toContain("<outline/>");
    expect(text).toContain("<outline>");
  });
});
