import {
  addContour,
  counterIds,
  fontDocument,
  glyph,
  inkOf,
  inkRegions,
  insideGlyph,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { parseClipboard } from "../src/clipboard.js";
import { convertStrokesToOutlines } from "../src/commands/nib.js";
import { editorState } from "../src/state.js";

/**
 * Turning a stroke into outlines, on a stroke that used to come out a mess.
 *
 * An oval pen along a path with a sharp V, a corner whose incoming handle is
 * pulled onto its point, and bends tighter than the pen. Each of those broke a
 * different part of the conversion: the bends were halved into two hundred
 * slivers, the retracted handle threw one offset handle a hundred billion units
 * away, and the V's legs left edges lying all but on each other that the union of
 * curves could not sort out. What is asked is the result a person sees: one
 * outline, covering what the pen covers, nowhere wild, and quick.
 */

const PASTED = JSON.stringify({
  kind: "typewright/contours",
  version: 1,
  contours: [
    {
      closed: false,
      nodes: [
        { pt: { x: 88, y: 444.58720104211034 }, type: "corner", in: null, out: null },
        {
          pt: { x: 184.19786323835913, y: 475.8660025653482 },
          type: "smooth",
          in: { x: 110, y: 475.8660025653482 },
          out: { x: 309.1321122497843, y: 475.8660025653482 },
        },
        { pt: { x: 124.92646121402991, y: 0 }, type: "corner", in: null, out: null },
        {
          pt: { x: 485.5603121740246, y: 491.8660025653482 },
          type: "smooth",
          in: { x: 322, y: 491.8660025653482 },
          out: { x: 629, y: 491.8660025653482 },
        },
        {
          pt: { x: 397.02015797723266, y: 38.61445828231474 },
          type: "smooth",
          in: { x: 420.8702431561083, y: 113.57186884449533 },
          out: { x: 373.170072798357, y: -36.34295227986584 },
        },
        {
          pt: { x: 508.74194164285234, y: 38.61445828231474 },
          type: "smooth",
          in: { x: 495.1133215406377, y: 27.25734418254899 },
          out: { x: 522.370561745067, y: 49.971572382080495 },
        },
      ],
      nib: { angle: 30, width: 100, thickness: 30 },
    },
  ],
});

describe("an oval-pen stroke with a sharp V, turned into outlines", () => {
  const ids = counterIds("so");
  const stroke = () => parseClipboard(PASTED, ids)![0]!;

  it("is drawn in a handful of pieces, not hundreds", () => {
    expect(inkRegions(stroke()).length).toBeLessThan(20);
  });

  it("becomes one outline, in good time", () => {
    const start = performance.now();
    const ink = inkOf(stroke(), ids);
    expect(performance.now() - start).toBeLessThan(5000);
    expect(ink).toHaveLength(1);
  });

  it("has no point anywhere near far away", () => {
    for (const c of inkOf(stroke(), ids)) {
      for (const n of c.nodes) {
        for (const p of [n.pt, n.in, n.out]) {
          if (p === null) continue;
          expect(Math.abs(p.x)).toBeLessThan(1000);
          expect(Math.abs(p.y)).toBeLessThan(1000);
        }
      }
    }
  });

  it("covers what the pen covers", () => {
    const c = stroke();
    const pieces = glyph("p", { contours: [...inkRegions(c)] });
    const outline = glyph("o", { contours: [...inkOf(c, ids)] });
    let differ = 0;
    let total = 0;
    for (let x = 30; x < 600; x += 9) {
      for (let y = -40; y < 540; y += 9) {
        total += 1;
        if (insideGlyph(pieces, { x, y }) !== insideGlyph(outline, { x, y })) differ += 1;
      }
    }
    // A sample landing within the refit's few hundredths of an edge may fall
    // either side; anything more is ink lost or added.
    expect(differ / total).toBeLessThan(0.002);
  });

  it("goes into the glyph as that outline from the canvas menu", () => {
    const c = stroke();
    const state = {
      ...editorState({
        document: fontDocument([addContour(glyph("n", { advance: 600 }), c)]),
        view: { scale: 1, tx: 0, ty: 0 },
      }),
      selection: [{ contourId: c.id, nodeId: c.nodes[0]!.id, part: "point" as const }],
    };
    const after = convertStrokesToOutlines(state, c.id, ids).state;
    const contours = after.document.glyphs["n"]!.contours;
    expect(contours).toHaveLength(1);
    expect(contours[0]!.nib).toBeUndefined();
    expect(contours[0]!.closed).toBe(true);
  });
});
