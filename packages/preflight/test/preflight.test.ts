import {
  imageRef,
  DEFAULT_FONT_INFO,
  EMPTY_KERNING,
  addAnchor,
  addContour,
  anchor,
  component,
  contour,
  counterIds,
  fontDocument,
  glyph,
  groupKey,
  node,
  setKern,
  setKernGroup,
  setKerning,
} from "@typewright/font-model";
import { vec } from "@typewright/geometry";
import { describe, expect, it } from "vitest";

import { CHECKS, type CheckId, countBySeverity, preflight } from "../src/index.js";

const ids = counterIds("pf");

/** A closed triangle: an ordinary shape with nothing wrong with it. */
const shape = (x = 0) =>
  contour(
    ids.contour(),
    [
      node(ids.node(), vec(x, 0)),
      node(ids.node(), vec(x + 300, 0)),
      node(ids.node(), vec(x + 150, 700)),
    ],
    true,
  );

const font = (...glyphs: ReturnType<typeof glyph>[]) =>
  fontDocument([glyph(".notdef", { advance: 500 }), ...glyphs], DEFAULT_FONT_INFO);

/** The checks a document tripped, as a set, which is what most tests are about. */
const tripped = (document: Parameters<typeof preflight>[0]): Set<CheckId> =>
  new Set(preflight(document).map((f) => f.check));

describe("a font with nothing wrong with it", () => {
  it("says nothing", () => {
    const document = font(
      addContour(glyph("a", { unicodes: [0x61], advance: 500 }), shape()),
      glyph("space", { unicodes: [0x20], advance: 250 }),
    );

    expect(preflight(document)).toEqual([]);
  });
});

describe("outlines", () => {
  it("finds a contour left open", () => {
    const open = contour(ids.contour(), [
      node(ids.node(), vec(0, 0)),
      node(ids.node(), vec(100, 0)),
    ]);
    const document = font(addContour(glyph("a", { advance: 500 }), open));

    const found = preflight(document);
    expect(found.map((f) => f.check)).toContain("open-contour");
    // It says where, so the editor can select it rather than hunt for it.
    expect(found[0]?.where?.contourId).toBe(open.id);
  });

  it("finds a stray point and an empty contour, and does not call either open", () => {
    const stray = contour(ids.contour(), [node(ids.node(), vec(10, 10))]);
    const nothing = contour(ids.contour(), []);
    const document = font(addContour(addContour(glyph("a", { advance: 500 }), stray), nothing));

    const checks = tripped(document);
    expect(checks.has("stray-point")).toBe(true);
    expect(checks.has("empty-contour")).toBe(true);
    expect(checks.has("open-contour")).toBe(false);
  });

  it("finds two points in the same place, and only when they are neighbours", () => {
    const twice = contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0)),
        node(ids.node(), vec(0, 0)),
        node(ids.node(), vec(300, 0)),
        node(ids.node(), vec(150, 700)),
      ],
      true,
    );
    const document = font(addContour(glyph("a", { advance: 500 }), twice));

    expect(preflight(document).filter((f) => f.check === "duplicate-point")).toHaveLength(1);
  });

  it("does not mind two points in the same place at opposite ends of a contour", () => {
    // The waist of a figure eight, drawn as one contour. On purpose, and not a
    // pair of neighbours.
    const waist = contour(
      ids.contour(),
      [
        node(ids.node(), vec(0, 0)),
        node(ids.node(), vec(150, 150)),
        node(ids.node(), vec(300, 0)),
        node(ids.node(), vec(150, 150)),
      ],
      true,
    );
    const document = font(addContour(glyph("a", { advance: 500 }), waist));

    expect(tripped(document).has("duplicate-point")).toBe(false);
  });

  it("counts the points between units once per contour", () => {
    const scaled = contour(
      ids.contour(),
      [
        node(ids.node(), vec(0.5, 0)),
        node(ids.node(), vec(300.25, 0)),
        node(ids.node(), vec(150, 700.75)),
      ],
      true,
    );
    const document = font(addContour(glyph("a", { advance: 500 }), scaled));

    const off = preflight(document).filter((f) => f.check === "off-grid");
    expect(off).toHaveLength(1);
    expect(off[0]?.message).toContain("3 points");
  });
});

describe("names, advances and characters", () => {
  it("finds a name a font cannot carry", () => {
    const document = font(
      glyph("a b", { advance: 500 }),
      glyph("2nd", { advance: 500 }),
      glyph(".private", { advance: 500 }),
    );

    const named = preflight(document).filter((f) => f.check === "glyph-name");
    expect(named.map((f) => f.glyph).sort()).toEqual([".private", "2nd", "a b"]);
  });

  it("leaves .notdef alone, which is spelt with a full stop on purpose", () => {
    expect(tripped(font()).has("glyph-name")).toBe(false);
  });

  it("finds an advance below zero", () => {
    const document = font(glyph("a", { advance: -10 }));
    expect(tripped(document).has("negative-advance")).toBe(true);
  });

  it("finds two glyphs claiming one character, and blames the one that loses", () => {
    const document = font(
      glyph("a", { unicodes: [0x61], advance: 500 }),
      glyph("a.alt", { unicodes: [0x61], advance: 500 }),
    );

    const clash = preflight(document).filter((f) => f.check === "duplicate-unicode");
    expect(clash).toHaveLength(1);
    expect(clash[0]?.glyph).toBe("a.alt");
    expect(clash[0]?.message).toContain("U+0061");
  });

  it("says when there is no .notdef", () => {
    const document = fontDocument([glyph("a", { advance: 500 })], DEFAULT_FONT_INFO);
    expect(tripped(document).has("no-notdef")).toBe(true);
  });
});

describe("components", () => {
  it("finds one placing a glyph that is not in the font", () => {
    const document = font(
      glyph("Aacute", { advance: 600, components: [component(ids.component(), "acute")] }),
    );

    const missing = preflight(document).filter((f) => f.check === "missing-base");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain("acute");
  });

  it("finds one that places itself", () => {
    const document = font(
      glyph("a", { advance: 500, components: [component(ids.component(), "a")] }),
    );
    expect(tripped(document).has("recursive-component")).toBe(true);
  });

  it("finds a circle of two", () => {
    const document = font(
      glyph("a", { advance: 500, components: [component(ids.component(), "b")] }),
      glyph("b", { advance: 500, components: [component(ids.component(), "a")] }),
    );

    expect(preflight(document).filter((f) => f.check === "recursive-component")).toHaveLength(2);
  });
});

describe("anchors", () => {
  const at = (name: string) => anchor(ids.anchor(), name, { x: 100, y: 500 });

  it("finds an anchor with no name, and two with one name", () => {
    const document = font(
      addAnchor(addAnchor(glyph("A", { advance: 600 }), at("top")), at("top")),
      addAnchor(glyph("B", { advance: 600 }), at("")),
    );

    const checks = tripped(document);
    expect(checks.has("duplicate-anchor")).toBe(true);
    expect(checks.has("unnamed-anchor")).toBe(true);
  });

  it("finds a mark that attaches two ways", () => {
    const document = font(
      addAnchor(addAnchor(glyph("acute", { advance: 0 }), at("_top")), at("_bottom")),
      addAnchor(glyph("A", { advance: 600 }), at("top")),
      addAnchor(glyph("B", { advance: 600 }), at("bottom")),
    );

    expect(tripped(document).has("two-mark-anchors")).toBe(true);
  });

  it("finds a mark with nowhere to land, and not one that has somewhere", () => {
    const landing = font(
      addAnchor(glyph("acute", { advance: 0 }), at("_top")),
      addAnchor(glyph("A", { advance: 600 }), at("top")),
    );
    expect(tripped(landing).has("mark-without-base")).toBe(false);

    const nowhere = font(addAnchor(glyph("acute", { advance: 0 }), at("_cedilla")));
    expect(tripped(nowhere).has("mark-without-base")).toBe(true);
  });
});

describe("kerning", () => {
  it("finds a group naming a glyph that has gone", () => {
    const kerning = setKernGroup(EMPTY_KERNING, "first", "O", ["O", "Q"]);
    const document = setKerning(font(glyph("O", { advance: 600 })), kerning);

    const found = preflight(document).filter((f) => f.check === "kern-missing-glyph");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("Q");
  });

  it("finds a pair naming a glyph that has gone", () => {
    const kerning = setKern(EMPTY_KERNING, "T", "a", -80);
    const document = setKerning(font(glyph("T", { advance: 600 })), kerning);

    expect(tripped(document).has("kern-missing-glyph")).toBe(true);
  });

  it("finds a pair naming a group that was removed", () => {
    const kerning = setKern(EMPTY_KERNING, "T", groupKey("A"), -80);
    const document = setKerning(font(glyph("T", { advance: 600 })), kerning);

    expect(tripped(document).has("kern-missing-glyph")).toBe(true);
  });

  it("finds an empty group, and says so as a note rather than a warning", () => {
    const kerning = setKernGroup(EMPTY_KERNING, "second", "A", []);
    const document = setKerning(font(), kerning);

    const found = preflight(document).filter((f) => f.check === "empty-kern-group");
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("note");
  });
});

describe("the report itself", () => {
  const messy = () => {
    const open = contour(ids.contour(), [
      node(ids.node(), vec(0, 0)),
      node(ids.node(), vec(9.5, 0)),
    ]);
    return font(addContour(glyph("b", { advance: 500 }), open), glyph("a b", { advance: 500 }));
  };

  it("puts the errors first", () => {
    const severities = preflight(messy()).map((f) => f.severity);
    expect(severities).toEqual([...severities].sort((a, b) => rank(a) - rank(b)));
    expect(severities[0]).toBe("error");
  });

  it("counts what it found", () => {
    const counted = countBySeverity(preflight(messy()));
    expect(counted.error).toBeGreaterThan(0);
    expect(counted.warning).toBeGreaterThan(0);
    expect(counted.error + counted.warning + counted.note).toBe(preflight(messy()).length);
  });

  it("leaves out what it was asked to leave out", () => {
    const checks = new Set(
      preflight(messy(), { skip: ["off-grid", "open-contour"] }).map((f) => f.check),
    );
    expect(checks.has("off-grid")).toBe(false);
    expect(checks.has("open-contour")).toBe(false);
    expect(checks.has("glyph-name")).toBe(true);
  });

  it("has a description for every check it can report", () => {
    const described = new Set(CHECKS.map((c) => c.id));
    for (const f of preflight(messy())) expect(described.has(f.check)).toBe(true);
    // And no two entries claiming the same id.
    expect(described.size).toBe(CHECKS.length);
  });
});

const rank = (s: string): number => ["error", "warning", "note"].indexOf(s);

describe("pictures a glyph traces from", () => {
  it("finds a glyph naming one the font does not have", () => {
    const document = font(
      glyph("a", { advance: 500, image: imageRef("gone.png") }),
      glyph("b", { advance: 500, image: imageRef("sheet.png") }),
    );

    const found = preflight(document, { images: new Set(["sheet.png"]) });
    const missing = found.filter((f) => f.check === "missing-image");

    expect(missing).toHaveLength(1);
    expect(missing[0]?.glyph).toBe("a");
  });

  it("says nothing at all when it was not told what the font holds", () => {
    // The pictures live beside the document, so a check that guessed would
    // report every tracing in a font whose images simply were not handed over.
    const document = font(glyph("a", { advance: 500, image: imageRef("gone.png") }));
    expect(tripped(document).has("missing-image")).toBe(false);
  });
});
