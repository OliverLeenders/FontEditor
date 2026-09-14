import { describe, expect, it } from "vitest";

import { codePointsOfSet } from "../src/query.js";

/**
 * What "Add missing" may create for a set.
 *
 * A block is a range of code points, and two of the first blocks begin with
 * control characters that no font draws. Offered as missing, they became empty
 * glyphs in the font — `uni0000` among them, which stopped every export.
 */

describe("the code points of a set", () => {
  it("leaves the control characters out of Basic Latin", () => {
    const basicLatin = codePointsOfSet("block:basic-latin")!;

    expect(basicLatin).not.toContain(0x0000);
    expect(basicLatin).not.toContain(0x001f);
    expect(basicLatin).not.toContain(0x007f);
    // What is left is exactly the printable ASCII range, space included.
    expect(basicLatin).toEqual(codePointsOfSet("ascii"));
  });

  it("leaves them out of Latin-1 Supplement, and keeps the no-break space", () => {
    const latin1 = codePointsOfSet("block:latin-1");
    expect(latin1).not.toBeNull();
    expect(latin1).not.toContain(0x0080);
    expect(latin1).not.toContain(0x009f);
    expect(latin1).toContain(0x00a0);
    expect(latin1).toContain(0x00e9);
  });

  it("still has nothing to offer for a set about glyph state", () => {
    expect(codePointsOfSet("drawn")).toBeNull();
  });
});
