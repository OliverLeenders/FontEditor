import {
  type FontDocument,
  DEFAULT_FONT_INFO,
  counterIds,
  fontDocument,
  glyph,
  rectContour,
  withNib,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import {
  glyphSvg,
  glyphSvgFiles,
  iconCheatSheet,
  iconClass,
  iconCodepoints,
  iconEntries,
  iconKitFiles,
  iconStylesheet,
} from "../src/icon-kit.js";
import { parseSvg } from "../src/svg.js";
import { entryText } from "../src/zip.js";

/**
 * An icon font as what a web page is given, and as pictures again.
 *
 * The stylesheet, the page and the code points are all written from the font,
 * so what is asked of them is that they say what the font says: the same
 * names, the same code points, the same family.
 */

const ids = counterIds("kit");

const square = (name: string, code: number | null) =>
  glyph(name, {
    unicodes: code === null ? [] : [code],
    advance: 1000,
    contours: [rectContour(ids, { minX: 100, minY: 0, maxX: 900, maxY: 700 })],
  });

const font = (spelled = false): FontDocument => ({
  ...fontDocument(
    [
      glyph(".notdef", { advance: 500 }),
      square("a", 0x61),
      square("home", 0xe000),
      square("arrow_left", 0xe001),
      square("home.fill", 0xe002),
      square("unencoded", null),
    ],
    { ...DEFAULT_FONT_INFO, familyName: "My Icons", styleName: "Regular" },
  ),
  nameLigatures: spelled,
});

describe("the icons of a font", () => {
  it("are the glyphs with a private-use code point, in font order", () => {
    expect(iconEntries(font())).toEqual([
      { name: "home", code: 0xe000 },
      { name: "arrow_left", code: 0xe001 },
      { name: "home.fill", code: 0xe002 },
    ]);
  });

  it("share a class made from the family's name", () => {
    expect(iconClass(font())).toBe("my-icons");
    const named = (familyName: string) =>
      iconClass({ ...font(), info: { ...font().info, familyName } });
    expect(named("24 Hours")).toBe("icons-24-hours");
    expect(named("—")).toBe("icons");
  });
});

describe("the stylesheet", () => {
  it("names the font, sets it on the shared class, and gives each icon its code point", () => {
    const css = iconStylesheet(font(), "MyIcons-Regular.woff2");
    expect(css).toContain('font-family: "My Icons";');
    expect(css).toContain('src: url("MyIcons-Regular.woff2") format("woff2");');
    expect(css).toContain(".my-icons {");
    expect(css).toContain('.my-icons-home::before { content: "\\e000"; }');
    expect(css).toContain('.my-icons-arrow_left::before { content: "\\e001"; }');
    // A full stop would end the class name in a selector.
    expect(css).toContain('.my-icons-home-fill::before { content: "\\e002"; }');
    expect(css).not.toContain("my-icons-a:");
  });

  it("turns ligatures on only for a font that spells its names", () => {
    expect(iconStylesheet(font(), "f.woff2")).not.toContain("font-feature-settings");
    expect(iconStylesheet(font(true), "f.woff2")).toContain('font-feature-settings: "liga";');
  });
});

describe("the code points and the page", () => {
  it("lists every icon by name with its code point", () => {
    expect(JSON.parse(iconCodepoints(font()))).toEqual({
      home: "e000",
      arrow_left: "e001",
      "home.fill": "e002",
    });
  });

  it("shows every icon, and how to type one by name where the font spells them", () => {
    const page = iconCheatSheet(font(), "MyIcons-Regular.css");
    expect(page).toContain('<link rel="stylesheet" href="MyIcons-Regular.css">');
    expect(page).toContain('class="my-icons my-icons-arrow_left"');
    expect(page).toContain("U+E001");
    expect(page).toContain("3 icons.");
    expect(page).not.toContain("Or by name");

    const spelled = iconCheatSheet(font(true), "MyIcons-Regular.css");
    expect(spelled).toContain('&lt;span class="my-icons"&gt;home&lt;/span&gt;');
  });

  it("is four files named for the font", () => {
    const files = iconKitFiles(font(), new Uint8Array([1, 2, 3]));
    expect(files.map((f) => f.path)).toEqual([
      "MyIcons-Regular.woff2",
      "MyIcons-Regular.css",
      "MyIcons-Regular.html",
      "MyIcons-Regular.json",
    ]);
  });
});

describe("glyphs as SVG files", () => {
  it("draws a glyph in the box a line gives it, y running down", () => {
    const svg = glyphSvg(font().glyphs["home"]!, font());
    // 750 above the baseline and 250 below, as the default font has it.
    expect(svg).toContain('viewBox="0 0 1000 1000"');
    const back = parseSvg(svg)!;
    const ys = back.shapes[0]!.commands.flatMap((c) => (c.type === "Z" ? [] : [c.y]));
    // The square stood from the baseline to 700: 50 to 750 from the top.
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([50, 750]);
  });

  it("writes one file for each glyph that draws something, strokes as their ink", () => {
    const stroked = {
      ...glyph("ring", { unicodes: [0xe010], advance: 1000 }),
      contours: [
        withNib(rectContour(ids, { minX: 200, minY: 100, maxX: 800, maxY: 600 }), {
          angle: 0,
          width: 80,
          thickness: 80,
        }),
      ],
    };
    const document = {
      ...font(),
      glyphs: { ...font().glyphs, ring: stroked },
      glyphOrder: [...font().glyphOrder, "ring"],
    };
    const files = glyphSvgFiles(document);
    // Not .notdef, which draws nothing.
    expect(files.map((f) => f.path)).toEqual([
      "a.svg",
      "home.svg",
      "arrow_left.svg",
      "home.fill.svg",
      "unencoded.svg",
      "ring.svg",
    ]);
    // The pen's ink reaches forty units outside the path it was drawn along.
    const ring = parseSvg(entryText(files[5]!))!;
    const xs = ring.shapes[0]!.commands.flatMap((c) => (c.type === "Z" ? [] : [c.x]));
    expect(Math.min(...xs)).toBeCloseTo(160, 0);
    expect(Math.max(...xs)).toBeCloseTo(840, 0);
  });
});
