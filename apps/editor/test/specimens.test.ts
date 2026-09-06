import { describe, expect, it } from "vitest";

import { PROOF_SPECIMENS, PROOF_TEXT, SPACING_SPECIMENS, specimenNamed } from "../src/specimens.js";

/**
 * The control strings are generated, so what is worth asserting is that the
 * generator produces the thing spacing work actually needs: every letter, each
 * one framed by the same neighbours, and nothing dropped.
 */

const named = (name: string): string => SPACING_SPECIMENS.find((s) => s.name === name)?.text ?? "";

describe("the spacing specimens", () => {
  it("threads the whole alphabet through its frame", () => {
    const text = named("Lowercase between n");
    expect(text.startsWith("nnannbnncnn")).toBe(true);
    expect(text.endsWith("nnznn")).toBe(true);

    // Twenty-six letters, each with a frame before it, and one frame to close.
    expect(text).toHaveLength(26 * 3 + 2);
    for (const letter of "abcdefghijklmnopqrstuvwxyz") {
      expect(text).toContain(`nn${letter}nn`);
    }
  });

  it("frames capitals with a straight and a round, at both sizes of letter", () => {
    expect(named("Capitals between H").startsWith("HAHBHCH")).toBe(true);
    expect(named("Capitals between O").startsWith("OAOBOCO")).toBe(true);
    // The pair that says whether the capitals suit the lowercase beside them.
    expect(named("Capitals between nn").startsWith("nnAnnBnn")).toBe(true);
    expect(named("Capitals between oo").startsWith("ooAooBoo")).toBe(true);
  });

  it("keeps a short one first, because that is what spacing starts from", () => {
    expect(SPACING_SPECIMENS[0]!.text).toBe("handgloves");
  });
});

describe("the proof specimens", () => {
  it("offers the pangrams as well as the default text", () => {
    expect(PROOF_SPECIMENS[0]!.text).toBe(PROOF_TEXT);

    const pangrams = PROOF_SPECIMENS.find((s) => s.name === "Pangrams")!.text;
    expect(pangrams.split(String.fromCharCode(10))).toHaveLength(6);
    // Each line sets the whole alphabet, which is what makes it a pangram.
    for (const line of pangrams.split(String.fromCharCode(10))) {
      const letters = new Set(line.toLowerCase().replace(/[^a-z]/g, ""));
      expect(letters.size).toBe(26);
    }
  });
});

describe("naming what is on screen", () => {
  it("finds the specimen showing, and names nothing once it is edited", () => {
    expect(specimenNamed(SPACING_SPECIMENS, "handgloves")).toBe("Handgloves");
    expect(specimenNamed(SPACING_SPECIMENS, "handglovess")).toBeNull();
    expect(specimenNamed(PROOF_SPECIMENS, PROOF_TEXT)).toBe("Handgloves");
    expect(specimenNamed(PROOF_SPECIMENS, "")).toBeNull();
  });
});
