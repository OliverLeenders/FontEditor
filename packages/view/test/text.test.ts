import { describe, expect, it } from "vitest";

import { READ_FROM_TEXT, featureTagsFor, sameTextSettings } from "../src/text.js";

/**
 * How a line is set: which way it runs, whose rules it chooses, and which of the
 * font's features are switched on for it.
 *
 * The features are kept as differences from what a text renderer would do
 * rather than as a list of what runs, which is what lets a proof be truthful by
 * default and still be able to show a stylistic set nobody would get by typing.
 */

const DEFAULTS = ["ccmp", "rlig", "liga", "clig", "calt"];

describe("the tags a line is set with", () => {
  it("is what a renderer turns on, where nothing has been switched", () => {
    expect(featureTagsFor(DEFAULTS, {})).toEqual(DEFAULTS);
  });

  it("adds a feature switched on", () => {
    expect(featureTagsFor(DEFAULTS, { ss01: true })).toEqual([...DEFAULTS, "ss01"]);
  });

  it("takes away one switched off", () => {
    expect(featureTagsFor(DEFAULTS, { liga: false })).toEqual(["ccmp", "rlig", "clig", "calt"]);
  });

  it("does not add a default twice", () => {
    expect(featureTagsFor(DEFAULTS, { liga: true })).toEqual(DEFAULTS);
  });
});

describe("whether two settings say the same thing", () => {
  it("is true for two copies of the same", () => {
    expect(sameTextSettings(READ_FROM_TEXT, { ...READ_FROM_TEXT })).toBe(true);
  });

  it("notices a feature switched on", () => {
    // What keeps the shaping engine from being reused for a line set another
    // way: the settings are its key, and a feature is part of them.
    expect(sameTextSettings(READ_FROM_TEXT, { ...READ_FROM_TEXT, features: { ss01: true } })).toBe(
      false,
    );
  });

  it("notices a feature switched the other way", () => {
    expect(
      sameTextSettings(
        { ...READ_FROM_TEXT, features: { ss01: true } },
        { ...READ_FROM_TEXT, features: { ss01: false } },
      ),
    ).toBe(false);
  });

  it("does not care what order the tags were switched in", () => {
    expect(
      sameTextSettings(
        { ...READ_FROM_TEXT, features: { ss01: true, liga: false } },
        { ...READ_FROM_TEXT, features: { liga: false, ss01: true } },
      ),
    ).toBe(true);
  });
});
