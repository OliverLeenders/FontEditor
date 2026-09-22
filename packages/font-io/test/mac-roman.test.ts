import { describe, expect, it } from "vitest";

import { macRomanCodePoint } from "../src/mac-roman.js";

describe("Mac OS Roman", () => {
  it("leaves the ASCII half alone", () => {
    expect(macRomanCodePoint(0x41)).toBe(0x41);
    expect(macRomanCodePoint(0x7e)).toBe(0x7e);
  });

  it("reads the letters a Mac could set", () => {
    expect(macRomanCodePoint(0x80)).toBe(0x00c4); // A umlaut
    expect(macRomanCodePoint(0xa7)).toBe(0x00df); // eszett
    expect(macRomanCodePoint(0xd5)).toBe(0x2019); // right single quote
  });

  it("maps the slot that became the euro", () => {
    expect(macRomanCodePoint(0xdb)).toBe(0x20ac);
  });

  it("keeps the Apple logo, which Unicode has no room for", () => {
    expect(macRomanCodePoint(0xf0)).toBe(0xf8ff);
  });
});
