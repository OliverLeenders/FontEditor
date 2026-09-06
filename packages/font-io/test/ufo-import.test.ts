import {
  EMPTY_KERNING,
  addAnchor,
  anchor,
  contour,
  counterIds,
  fontDocument,
  glyph,
  glyphBounds,
  groupKey,
  kernIndex,
  kernValue,
  node,
  segmentAt,
  segmentCubic,
  setFeatures,
  setKern,
  setKernGroup,
  setKerning,
} from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { exportUfo } from "../src/ufo.js";
import { importUfo } from "../src/ufo-import.js";
import { zip } from "../src/zip.js";

const ids = counterIds();
const at = (x: number, y: number) => ({ x, y });

const INFO = {
  familyName: "Round Trip",
  styleName: "Regular",
  unitsPerEm: 1000,
  ascender: 750,
  descender: -250,
  xHeight: 512,
  capHeight: 700,
};

/** A closed ring of curves, an open run of lines, and a half-handled segment. */
function shapes() {
  const ring = contour(
    ids.contour(),
    [
      node(ids.node(), at(300, 700), { type: "smooth", in: at(180, 700), out: at(420, 700) }),
      node(ids.node(), at(540, 350), { type: "smooth", in: at(540, 490), out: at(540, 210) }),
      node(ids.node(), at(300, 0), { type: "smooth", in: at(420, 0), out: at(180, 0) }),
      node(ids.node(), at(60, 350), { type: "smooth", in: at(60, 210), out: at(60, 490) }),
    ],
    true,
  );

  const open = contour(
    ids.contour(),
    [
      node(ids.node(), at(10, 10)),
      node(ids.node(), at(200, 10)),
      node(ids.node(), at(200, 300), { type: "corner", in: at(200, 200) }),
    ],
    false,
  );

  return { ring, open };
}

function source() {
  const { ring, open } = shapes();
  const document = fontDocument(
    [
      glyph("o", { unicodes: [0x6f], advance: 600, contours: [ring] }),
      glyph("v", { unicodes: [0x76], advance: 420, contours: [open] }),
      glyph("space", { unicodes: [0x20], advance: 250 }),
    ],
    INFO,
  );

  let k = setKernGroup(EMPTY_KERNING, "first", "O", ["o"]);
  k = setKernGroup(k, "second", "V", ["v"]);
  k = setKern(k, groupKey("O"), groupKey("V"), -55);
  k = setKern(k, "o", "space", -12);
  return setKerning(document, k);
}

const back = async () => {
  const out = await importUfo(exportUfo(source()).bytes.buffer as ArrayBuffer, counterIds("r"));
  if ("reason" in out) throw new Error(out.reason);
  return out;
};

describe("a UFO written by us and read back", () => {
  it("brings back every glyph, in order", async () => {
    const { document } = await back();
    expect(document.glyphOrder).toEqual(["o", "v", "space"]);
  });

  it("keeps the font's own measurements", async () => {
    const { document } = await back();
    expect(document.info).toEqual(INFO);
  });

  it("keeps advances and code points", async () => {
    const { document } = await back();
    expect(document.glyphs["o"]?.advance).toBe(600);
    expect(document.glyphs["space"]?.advance).toBe(250);
    expect(document.glyphs["v"]?.unicodes).toEqual([0x76]);
  });

  it("puts every point back where it was", async () => {
    const { document } = await back();
    const { ring } = shapes();
    const c = document.glyphs["o"]?.contours[0];

    expect(c?.closed).toBe(true);
    expect(c?.nodes.map((n) => n.pt)).toEqual(ring.nodes.map((n) => n.pt));
    expect(c?.nodes.map((n) => n.in)).toEqual(ring.nodes.map((n) => n.in));
    expect(c?.nodes.map((n) => n.out)).toEqual(ring.nodes.map((n) => n.out));
  });

  it("keeps a node's own smoothness", async () => {
    const { document } = await back();
    expect(document.glyphs["o"]?.contours[0]?.nodes.map((n) => n.type)).toEqual([
      "smooth",
      "smooth",
      "smooth",
      "smooth",
    ]);
  });

  it("keeps an open contour open, and its ends bare", async () => {
    const { document } = await back();
    const c = document.glyphs["v"]?.contours[0];

    expect(c?.closed).toBe(false);
    expect(c?.nodes).toHaveLength(3);
    expect(c?.nodes[0]?.in).toBeNull();
  });

  it("keeps a segment that is a line a line", async () => {
    const { document } = await back();
    const c = document.glyphs["v"]?.contours[0];
    expect(segmentAt(c!, 0)?.kind).toBe("line");
  });

  it("keeps a half-handled curve half-handled, rather than straightening it", async () => {
    // One control and none facing it is a real shape the model holds. The export
    // writes the missing one onto its anchor, which is what the segment already
    // means and is unambiguous in any reader; the import takes it off again.
    const { document } = await back();
    const c = document.glyphs["v"]?.contours[0];

    expect(segmentAt(c!, 1)?.kind).toBe("curve");
    expect(c?.nodes[2]?.in).toEqual({ x: 200, y: 200 });
    expect(c?.nodes[1]?.out).toBeNull();
  });

  it("draws the same curve after the trip as before it", async () => {
    // The real question a round trip answers. `segmentCubic` reads an absent
    // handle as a control on its anchor, so the two representations describe one
    // curve — and this is what would catch it if they ever stopped doing so.
    const { document } = await back();
    const { open } = shapes();
    const before = contour(open.id, open.nodes, false);

    expect(segmentCubic(segmentAt(document.glyphs["v"]!.contours[0]!, 1)!)).toEqual(
      segmentCubic(segmentAt(before, 1)!),
    );
  });

  it("leaves the glyph the same size it was", async () => {
    const { document } = await back();
    expect(glyphBounds(document.glyphs["o"]!)).toEqual(glyphBounds(source().glyphs["o"]!));
  });

  it("brings the kerning back, groups and all", async () => {
    const { document } = await back();
    const index = kernIndex(document.kerning);

    expect(kernValue(index, "o", "v")).toBe(-55);
    expect(kernValue(index, "o", "space")).toBe(-12);
  });

  it("recovers the groups as groups, not as loose pairs", async () => {
    const { document } = await back();
    expect(Object.values(document.kerning.firstGroups)).toContainEqual(["o"]);
    expect(Object.values(document.kerning.secondGroups)).toContainEqual(["v"]);
  });

  it("survives a second trip unchanged", async () => {
    const once = (await back()).document;
    const out = await importUfo(exportUfo(once).bytes.buffer as ArrayBuffer, counterIds("s"));
    if ("reason" in out) throw new Error(out.reason);

    expect(out.document.glyphOrder).toEqual(once.glyphOrder);
    expect(kernValue(kernIndex(out.document.kerning), "o", "v")).toBe(-55);
  });

  it("says nothing it does not have to", async () => {
    expect((await back()).warnings).toEqual([]);
  });
});

describe("a half-handled segment that closes a contour", () => {
  /**
   * The awkward one. A closed contour's first point carries the *closing*
   * segment's type, and its controls are written at the end of the list. When
   * the export decided that type from the segment's kind but emitted controls
   * only for a fully handled one, a half-handled closing segment produced a
   * point claiming to be a curve with nothing to curve through.
   */
  const closing = () => {
    const ids = counterIds("close");
    const c = contour(
      ids.contour(),
      [
        node(ids.node(), at(0, 0), { type: "corner", in: at(-40, 60) }),
        node(ids.node(), at(200, 0)),
        node(ids.node(), at(100, 200)),
      ],
      true,
    );
    return fontDocument([glyph("t", { unicodes: [0x74], advance: 300, contours: [c] })], INFO);
  };

  const reread = async () => {
    const out = await importUfo(exportUfo(closing()).bytes.buffer as ArrayBuffer, counterIds("c"));
    if ("reason" in out) throw new Error(out.reason);
    return out.document;
  };

  it("comes back as a curve rather than a line", async () => {
    const c = (await reread()).glyphs["t"]?.contours[0];
    expect(segmentAt(c!, 2)?.kind).toBe("curve");
  });

  it("keeps the one handle it had, and does not invent the other", async () => {
    const c = (await reread()).glyphs["t"]?.contours[0];
    expect(c?.nodes[0]?.in).toEqual({ x: -40, y: 60 });
    expect(c?.nodes[2]?.out).toBeNull();
  });

  it("draws the same closing curve it started with", async () => {
    const c = (await reread()).glyphs["t"]?.contours[0];
    const before = closing().glyphs["t"]!.contours[0]!;
    expect(segmentCubic(segmentAt(c!, 2)!)).toEqual(segmentCubic(segmentAt(before, 2)!));
  });
});

describe("the order the glyphs are in", () => {
  const bytes = (entries: Array<{ path: string; text: string }>) =>
    zip(entries).buffer as ArrayBuffer;

  /** Three glyphs, listed in contents.plist in an order nobody chose. */
  const parts = (lib: string | null) => {
    const outline = (name: string) =>
      `<glyph name="${name}" format="2"><advance width="500"/><outline><contour>` +
      `<point x="0" y="0" type="line"/><point x="100" y="0" type="line"/>` +
      `<point x="50" y="200" type="line"/></contour></outline></glyph>`;

    const entries = [
      { path: "x.ufo/metainfo.plist", text: "<plist><dict/></plist>" },
      {
        path: "x.ufo/glyphs/contents.plist",
        text:
          "<plist><dict>" +
          "<key>a</key><string>a.glif</string>" +
          "<key>b</key><string>b.glif</string>" +
          "<key>c</key><string>c.glif</string>" +
          "</dict></plist>",
      },
      { path: "x.ufo/glyphs/a.glif", text: outline("a") },
      { path: "x.ufo/glyphs/b.glif", text: outline("b") },
      { path: "x.ufo/glyphs/c.glif", text: outline("c") },
    ];
    if (lib !== null) entries.push({ path: "x.ufo/lib.plist", text: lib });
    return bytes(entries);
  };

  const orderOf = (names: readonly string[]) =>
    "<plist><dict><key>public.glyphOrder</key><array>" +
    names.map((n) => `<string>${n}</string>`).join("") +
    "</array></dict></plist>";

  const orderIn = async (source: ArrayBuffer, seed: string): Promise<readonly string[]> => {
    const out = await importUfo(source, counterIds(seed));
    if ("reason" in out) throw new Error(out.reason);
    return out.document.glyphOrder;
  };

  it("takes it from public.glyphOrder, not from contents.plist", async () => {
    // Most tools write contents.plist alphabetically and keep the real order in
    // the lib. Reading the wrong one silently reorders somebody's font.
    expect(await orderIn(parts(orderOf(["c", "a", "b"])), "o1")).toEqual(["c", "a", "b"]);
  });

  it("falls back to the order they were listed in when there is no lib", async () => {
    expect(await orderIn(parts(null), "o2")).toEqual(["a", "b", "c"]);
  });

  it("ignores names the lib mentions that are not here", async () => {
    expect(await orderIn(parts(orderOf(["c", "ghost", "a", "b"])), "o3")).toEqual(["c", "a", "b"]);
  });

  it("puts glyphs the lib forgot after the ones it named", async () => {
    // A lib that has drifted from the glyphs beside it costs the drift, not the
    // whole order.
    expect(await orderIn(parts(orderOf(["c"])), "o4")).toEqual(["c", "a", "b"]);
  });

  it("keeps the order through a round trip of our own", async () => {
    const source = fontDocument(
      [
        glyph("zebra", { advance: 400 }),
        glyph("apple", { advance: 400 }),
        glyph("mango", { advance: 400 }),
      ],
      INFO,
    );
    expect(await orderIn(exportUfo(source).bytes.buffer as ArrayBuffer, "o5")).toEqual([
      "zebra",
      "apple",
      "mango",
    ]);
  });
});

describe("refusing what is not a UFO", () => {
  const bytes = (entries: Array<{ path: string; text: string }>) =>
    zip(entries).buffer as ArrayBuffer;

  it("refuses something that is not a zip at all", async () => {
    const out = await importUfo(new TextEncoder().encode("hello").buffer, ids);
    expect(out).toEqual({ reason: expect.stringContaining("not a zip") });
  });

  it("refuses a zip with no metainfo.plist", async () => {
    const out = await importUfo(bytes([{ path: "notes.txt", text: "hi" }]), ids);
    expect("reason" in out && out.reason).toContain("does not look like a UFO");
  });

  it("refuses a UFO whose glyphs are all unreadable", async () => {
    const out = await importUfo(
      bytes([
        { path: "x.ufo/metainfo.plist", text: "<plist><dict/></plist>" },
        {
          path: "x.ufo/glyphs/contents.plist",
          text: "<plist><dict><key>a</key><string>a.glif</string></dict></plist>",
        },
        { path: "x.ufo/glyphs/a.glif", text: "<nonsense/>" },
      ]),
      ids,
    );
    expect("reason" in out && out.reason).toContain("no readable glyphs");
  });
});

describe("reading a glif written by something else", () => {
  const wrap = (outline: string) => [
    { path: "x.ufo/metainfo.plist", text: "<plist><dict/></plist>" },
    {
      path: "x.ufo/glyphs/contents.plist",
      text: "<plist><dict><key>a</key><string>a.glif</string></dict></plist>",
    },
    {
      path: "x.ufo/glyphs/a.glif",
      text: `<?xml version="1.0"?><glyph name="a" format="2"><advance width="500"/><unicode hex="0061"/><outline>${outline}</outline></glyph>`,
    },
  ];

  const read = async (outline: string) => {
    const out = await importUfo(zip(wrap(outline)).buffer as ArrayBuffer, counterIds("g"));
    if ("reason" in out) throw new Error(out.reason);
    return out;
  };

  it("gives a lone control point to the segment arriving at it", async () => {
    // UFO allows a curve with one off-curve point. The model holds exactly that
    // shape, so it is read rather than straightened or invented into a pair.
    const { document } = await read(
      `<contour>
         <point x="0" y="0" type="line"/>
         <point x="50" y="80"/>
         <point x="100" y="0" type="curve"/>
       </contour>`,
    );
    const c = document.glyphs["a"]?.contours[0];

    // Two on-curve points, not three: the contour starts with a line rather than
    // a move, so it closes, and the off-curve between them is the only control.
    expect(c?.nodes).toHaveLength(2);
    expect(c?.nodes[1]?.in).toEqual({ x: 50, y: 80 });
    expect(c?.nodes[0]?.out).toBeNull();
  });

  it("reads a component and where it is placed", async () => {
    const { document } = await read(`<component base="b" xOffset="40" yOffset="-10"/>`);
    const placed = document.glyphs["a"]?.components[0];

    expect(placed?.base).toBe("b");
    expect(placed?.transform.xOffset).toBe(40);
    expect(placed?.transform.yOffset).toBe(-10);
    // Unstated terms are the identity, which is what UFO's defaults mean.
    expect(placed?.transform.xScale).toBe(1);
  });

  it("turns a quadratic into the cubic that draws the same curve", async () => {
    const { document, warnings } = await read(
      `<contour>
         <point x="0" y="0" type="line"/>
         <point x="60" y="120"/>
         <point x="120" y="0" type="qcurve"/>
       </contour>`,
    );
    const c = document.glyphs["a"]?.contours[0];

    // A quadratic is exactly a cubic whose controls sit two thirds of the way
    // from each anchor towards its own control.
    expect(c?.nodes[0]?.out).toEqual({ x: 40, y: 80 });
    expect(c?.nodes[1]?.in).toEqual({ x: 80, y: 80 });
    expect(warnings.map((w) => w.message)).toContain("converted quadratic curves to cubics");
  });

  it("puts back the on-curve points a TrueType outline leaves out", async () => {
    // A run of controls implies an on-curve point midway between each pair.
    const { document } = await read(
      `<contour>
         <point x="0" y="0" type="line"/>
         <point x="0" y="100"/>
         <point x="100" y="100"/>
         <point x="100" y="0" type="qcurve"/>
       </contour>`,
    );
    const c = document.glyphs["a"]?.contours[0];

    expect(c?.nodes.map((n) => n.pt)).toContainEqual({ x: 50, y: 100 });
  });

  it("drops a contour with no on-curve points, and says so", async () => {
    const { document, warnings } = await read(
      `<contour><point x="0" y="0"/><point x="10" y="10"/></contour>
       <contour><point x="5" y="5" type="line"/><point x="9" y="9" type="line"/></contour>`,
    );

    expect(document.glyphs["a"]?.contours).toHaveLength(1);
    expect(warnings.map((w) => w.message)).toContain("dropped a contour with no on-curve points");
  });

  it("reads the advance and the code point", async () => {
    const { document } = await read(`<contour><point x="0" y="0" type="line"/></contour>`);
    expect(document.glyphs["a"]?.advance).toBe(500);
    expect(document.glyphs["a"]?.unicodes).toEqual([0x61]);
  });
});

describe("anchors", () => {
  const wrapGlyph = (body: string) => [
    { path: "x.ufo/metainfo.plist", text: "<plist><dict/></plist>" },
    {
      path: "x.ufo/glyphs/contents.plist",
      text: "<plist><dict><key>a</key><string>a.glif</string></dict></plist>",
    },
    {
      path: "x.ufo/glyphs/a.glif",
      text: `<?xml version="1.0"?><glyph name="a" format="2"><advance width="500"/>${body}</glyph>`,
    },
  ];

  const readGlyph = async (body: string) => {
    const out = await importUfo(zip(wrapGlyph(body)).buffer as ArrayBuffer, counterIds("g"));
    if ("reason" in out) throw new Error(out.reason);
    return out.document.glyphs["a"]!;
  };

  it("reads the anchors beside the outline", async () => {
    const g = await readGlyph(
      `<outline/><anchor name="top" x="250" y="700"/><anchor name="bottom" x="250" y="0"/>`,
    );
    expect(g.anchors.map((a) => [a.name, a.pt.x, a.pt.y])).toEqual([
      ["top", 250, 700],
      ["bottom", 250, 0],
    ]);
  });

  it("reads a format-1 anchor, which is written as a named move point", async () => {
    // Older files have no <anchor> element. Read as a contour this would put a
    // stray one-point path in the outline and lose the attachment entirely.
    const g = await readGlyph(
      `<outline><contour><point x="250" y="700" type="move" name="top"/></contour></outline>`,
    );
    expect(g.contours).toHaveLength(0);
    expect(g.anchors.map((a) => [a.name, a.pt.x, a.pt.y])).toEqual([["top", 250, 700]]);
  });

  it("keeps a real one-point contour a contour", async () => {
    // A move point with no name is not an anchor, whatever else it is.
    const g = await readGlyph(
      `<outline><contour><point x="10" y="20" type="move"/></contour></outline>`,
    );
    expect(g.anchors).toHaveLength(0);
    expect(g.contours).toHaveLength(1);
  });

  it("carries them out again, and back in unchanged", async () => {
    const accent = addAnchor(glyph("acute", { advance: 0 }), anchor("k1", "_top", at(120, 690)));
    const letter = addAnchor(
      glyph("a", { advance: 500, contours: [shapes().ring] }),
      anchor("k2", "top", at(250, 700)),
    );

    const document = fontDocument([letter, accent], INFO);
    const out = await importUfo(exportUfo(document).bytes.buffer as ArrayBuffer, counterIds("r"));
    if ("reason" in out) throw new Error(out.reason);

    expect(out.document.glyphs["a"]!.anchors.map((a) => [a.name, a.pt.x, a.pt.y])).toEqual([
      ["top", 250, 700],
    ]);
    expect(out.document.glyphs["acute"]!.anchors.map((a) => [a.name, a.pt.x, a.pt.y])).toEqual([
      ["_top", 120, 690],
    ]);
  });

  it("does not write one with no name, which could attach nothing", async () => {
    const nameless = addAnchor(glyph("a", { advance: 500 }), anchor("k3", "", at(0, 0)));
    const out = await importUfo(
      exportUfo(fontDocument([nameless], INFO)).bytes.buffer as ArrayBuffer,
      counterIds("n"),
    );
    if ("reason" in out) throw new Error(out.reason);
    expect(out.document.glyphs["a"]!.anchors).toHaveLength(0);
  });
});

describe("feature source through a UFO", () => {
  const FEATURES = "feature liga {\n    sub f i by fi;\n} liga;\n";

  const roundTrip = async (text: string) => {
    const doc = setFeatures(source(), text);
    const out = await importUfo(exportUfo(doc).bytes.buffer as ArrayBuffer, counterIds("fx"));
    if ("reason" in out) throw new Error(out.reason);
    return out.document;
  };

  it("comes back exactly as it was written", async () => {
    expect((await roundTrip(FEATURES)).features).toBe(FEATURES);
  });

  it("keeps source this editor cannot compile", async () => {
    // Dropping what the compiler does not understand would make opening a file a
    // way to lose work. The UFO is somebody's source, not our intermediate form.
    const contextual = "feature calt {\n    sub a' b by a.alt;\n} calt;\n";
    expect((await roundTrip(contextual)).features).toBe(contextual);
  });

  it("writes no features file for a font with none", async () => {
    const files = exportUfo(source()).files;
    const withText = exportUfo(setFeatures(source(), FEATURES)).files;
    expect(withText).toBe(files + 1);
  });

  it("leaves a font without features with empty source", async () => {
    expect((await back()).document.features).toBe("");
  });
});
