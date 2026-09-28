import { vec } from "@typewright/geometry";
import {
  type Contour,
  type Glyph,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  withNib,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { parseGlif } from "../src/glif.js";
import { readUfo } from "../src/ufo-import.js";
import { glif, ufoFiles } from "../src/ufo.js";
import type { ZipFile } from "../src/unzip.js";
import { entryBytes } from "../src/zip.js";

const ids = counterIds("sufo");

/**
 * A stroke through a `.ufo` and back.
 *
 * The file is given the stroke's ink, because another application wants the
 * letter; the stroke itself goes in the glyph's lib, with a fingerprint of the ink
 * written for it. What is asked here is that a stroke saved to a UFO folder comes
 * back a stroke — its path, its pen, where it sat — that a stroke whose ink was
 * redrawn elsewhere comes back as the redrawing, and that nobody else's lib
 * entries are disturbed on the way.
 */

/** A square outline, drawn in place. */
const square = (): Contour =>
  contour(
    ids.contour(),
    [
      node(ids.node(), vec(0, 0)),
      node(ids.node(), vec(100, 0)),
      node(ids.node(), vec(100, 100)),
      node(ids.node(), vec(0, 100)),
    ],
    true,
  );

/** A curved stroke, with coordinates that are not whole units, and a held join. */
const curl = (thickness?: number): Contour =>
  withNib(
    contour(ids.contour(), [
      node(ids.node(), vec(200.25, 0), { out: vec(240.5, 80) }),
      node(ids.node(), vec(350, 120.75), {
        type: "smooth",
        in: vec(300, 120.75),
        out: vec(400, 120.75),
        harmonised: true,
      }),
      node(ids.node(), vec(500, 0), { in: vec(460, 20) }),
    ]),
    thickness === undefined ? { angle: 30, width: 60 } : { angle: 30, width: 60, thickness },
  );

/** Written as a glif and read back. */
function throughGlif(g: Glyph): { glyph: Glyph; warnings: string[] } {
  const warnings: string[] = [];
  const back = parseGlif(glif(g), ids, (m) => warnings.push(m));
  if (back === null) throw new Error("not a glif");
  return { glyph: back, warnings };
}

describe("a stroke through a .glif", () => {
  it("comes back a stroke, with its pen", () => {
    const { glyph: back, warnings } = throughGlif(glyph("s", { advance: 600, contours: [curl()] }));

    expect(warnings).toEqual([]);
    expect(back.contours).toHaveLength(1);
    expect(back.contours[0]!.nib).toEqual({ angle: 30, width: 60 });
  });

  it("comes back exactly, not rounded to the grid the ink was written on", () => {
    // The ink is written in whole units, as every outline is. The stroke is kept
    // as it was drawn, so a point at 200.25 is still at 200.25.
    const drawn = curl();
    const { glyph: back } = throughGlif(glyph("s", { contours: [drawn] }));

    expect(back.contours[0]!.nodes.map((n) => n.pt)).toEqual(drawn.nodes.map((n) => n.pt));
    expect(back.contours[0]!.nodes.map((n) => n.out)).toEqual(drawn.nodes.map((n) => n.out));
  });

  it("keeps its held joins", () => {
    const { glyph: back } = throughGlif(glyph("s", { contours: [curl()] }));
    expect(back.contours[0]!.nodes.map((n) => n.harmonised)).toEqual([false, true, false]);
  });

  it("keeps the pens set at points", () => {
    const drawn = curl();
    const penned = {
      ...drawn,
      nodes: drawn.nodes.map((n, i) =>
        i === 2
          ? { ...n, pen: { angle: 80, width: 30 } }
          : i === 0
            ? { ...n, blend: { angle: "smooth", shape: "step" } as const }
            : n,
      ),
    };
    const { glyph: back, warnings } = throughGlif(glyph("s", { contours: [penned] }));

    expect(warnings).toEqual([]);
    expect(back.contours[0]!.nodes.map((n) => n.pen)).toEqual([
      undefined,
      undefined,
      { angle: 80, width: 30 },
    ]);
    expect(back.contours[0]!.nodes[0]!.blend).toEqual({ angle: "smooth", shape: "step" });
  });

  it("keeps an oval pen's thickness", () => {
    const { glyph: back } = throughGlif(glyph("s", { contours: [curl(20)] }));
    expect(back.contours[0]!.nib).toEqual({ angle: 30, width: 60, thickness: 20 });
  });

  it("goes back to the place it sat among the outlines", () => {
    // Outline, stroke, outline: the ink is written after both outlines, and the
    // stroke is put back in the middle, where it was.
    const g = glyph("s", { contours: [square(), curl(), square()] });
    const { glyph: back } = throughGlif(g);

    expect(back.contours).toHaveLength(3);
    expect(back.contours.map((c) => c.nib !== undefined)).toEqual([false, true, false]);
  });

  it("gives another application the ink, closed, after the outlines", () => {
    const text = glif(glyph("s", { contours: [square(), curl()] }));
    const contours = text.split("<contour>").length - 1;
    // The square, and at least one contour of ink; never the open skeleton.
    expect(contours).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain('type="move"');
  });
});

describe("a stroke whose ink was redrawn elsewhere", () => {
  it("comes back as the redrawing, with a warning", () => {
    // Another application moved a point of the ink. The file now says the letter
    // is that shape, and putting the pen back over it would undo the edit.
    const written = glif(glyph("s", { contours: [square(), curl()] }));
    const at = written.lastIndexOf('<point x="') + '<point x="'.length;
    const close = written.indexOf('"', at);
    const edited =
      written.slice(0, at) + String(Number(written.slice(at, close)) + 7) + written.slice(close);
    expect(edited).not.toBe(written);

    const warnings: string[] = [];
    const back = parseGlif(edited, ids, (m) => warnings.push(m))!;

    expect(back.contours.some((c) => c.nib !== undefined)).toBe(false);
    expect(back.contours.length).toBeGreaterThanOrEqual(2);
    expect(warnings.join(" ")).toMatch(/changed by another application/);
  });
});

describe("the glyph's lib", () => {
  it("keeps other applications' entries, and the mark colour, beside the strokes", () => {
    const g: Glyph = {
      ...glyph("s", { contours: [curl()] }),
      markColor: "1,0,0,1",
      kept: [
        "\t<lib>\n\t\t<dict>\n\t\t\t<key>com.example.note</key>\n\t\t\t<string>keep me</string>\n\t\t</dict>\n\t</lib>",
      ],
    };
    const text = glif(g);
    expect(text).toContain("com.example.note");
    expect(text).toContain("org.typewright.strokes");

    const back = parseGlif(text, ids, () => {})!;
    expect(back.markColor).toBe("1,0,0,1");
    expect(back.contours[0]!.nib).toBeDefined();
    // Somebody else's key is kept; ours is read into the model and not kept twice.
    expect(back.kept.join("")).toContain("com.example.note");
    expect(back.kept.join("")).not.toContain("org.typewright.strokes");
  });

  it("writes no strokes entry for a glyph drawn only in outlines", () => {
    expect(glif(glyph("o", { contours: [square()] }))).not.toContain("org.typewright.strokes");
  });
});

describe("a whole UFO folder", () => {
  it("brings strokes back through a save and an open", () => {
    const document = fontDocument([
      glyph("s", { advance: 600, unicodes: [0x73], contours: [square(), curl(20)] }),
    ]);
    const files: ZipFile[] = ufoFiles(document).map((e) => ({
      path: e.path,
      bytes: entryBytes(e),
    }));

    const read = readUfo(files, ids);
    if ("reason" in read) throw new Error(read.reason);
    const back = read.document.glyphs["s"]!;

    expect(back.contours.map((c) => c.nib)).toEqual([
      undefined,
      { angle: 30, width: 60, thickness: 20 },
    ]);
  });
});
