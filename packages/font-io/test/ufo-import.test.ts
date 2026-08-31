import {
  EMPTY_KERNING,
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

  it("comes back straight where the export wrote it straight", async () => {
    // Not what anyone would want, and not this importer's doing: `contourPoints`
    // only writes a segment as a curve when *both* its controls are set, so a
    // half-handled one leaves as a line and there is no curve here to read back.
    // Recorded rather than asserted away, so the day the export is fixed this
    // test fails and says where to look.
    const { document } = await back();
    const c = document.glyphs["v"]?.contours[0];

    expect(c?.nodes[2]?.in).toBeNull();
    expect(segmentAt(c!, 1)?.kind).toBe("line");
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

describe("refusing what is not a UFO", () => {
  const bytes = (entries: Array<{ path: string; text: string }>) =>
    zip(entries).buffer as ArrayBuffer;

  it("refuses something that is not a zip at all", async () => {
    const out = await importUfo(new TextEncoder().encode("hello").buffer as ArrayBuffer, ids);
    expect(out).toEqual({ reason: expect.stringContaining("not a zip") as unknown as string });
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
  const wrap = (outline: string) =>
    [
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
