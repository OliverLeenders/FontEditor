import { describe, expect, it } from "vitest";

import { markColorCss } from "../src/draw.js";

describe("a colour mark as a CSS colour", () => {
  it("scales the channels to bytes and keeps the alpha", () => {
    expect(markColorCss("1,0,0.5,0.5")).toBe("rgba(255, 0, 128, 0.5)");
  });

  it("scales the alpha for a tint of the same colour", () => {
    expect(markColorCss("1,0,0,1", 0.15)).toBe("rgba(255, 0, 0, 0.15)");
    expect(markColorCss("1,0,0,0.5", 0.5)).toBe("rgba(255, 0, 0, 0.25)");
  });

  it("has no colour for a mark that does not parse", () => {
    expect(markColorCss("red")).toBeNull();
  });
});
