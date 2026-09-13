import {
  component,
  contour,
  counterIds,
  fontDocument,
  glyph,
  node,
  sidebearings,
} from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { nudgeSidebearing, setSidebearing } from "../src/commands/spacing.js";
import { editorState } from "../src/state.js";

/**
 * Spacing an accented letter.
 *
 * A composite is references and no contours, so these commands used to find no
 * outline and do nothing. Measured through the font, it has the sides of the
 * letter it draws, and setting one moves the components together.
 */

const ids = counterIds("sc");

function state() {
  const n = glyph("n", {
    unicodes: [0x6e],
    advance: 500,
    contours: [
      contour(
        ids.contour(),
        [
          node(ids.node(), { x: 100, y: 0 }),
          node(ids.node(), { x: 400, y: 0 }),
          node(ids.node(), { x: 400, y: 700 }),
        ],
        true,
      ),
    ],
  });
  const ntilde = glyph("ntilde", {
    advance: 500,
    components: [component(ids.component(), "n"), component(ids.component(), "tildecomb")],
  });
  return editorState({
    document: fontDocument([n, ntilde]),
    view: { scale: 1, tx: 0, ty: 0 },
    currentGlyph: "n",
  });
}

describe("spacing a composite", () => {
  it("sets its left side by moving every component, holding the right", () => {
    const before = state();
    const { state: after } = setSidebearing(before, "ntilde", "left", 130);

    const built = after.document.glyphs["ntilde"]!;
    expect(built.components.map((c) => c.transform.xOffset)).toEqual([30, 30]);
    expect(sidebearings(built, after.document)).toEqual({ left: 130, right: 100 });
  });

  it("nudges its right side through the advance", () => {
    const { state: after } = nudgeSidebearing(state(), "ntilde", "right", -10);
    expect(after.document.glyphs["ntilde"]!.advance).toBe(490);
  });
});
