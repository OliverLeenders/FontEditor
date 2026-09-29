// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { keyTarget } from "../src/keyTarget.js";

/**
 * What a key pressed in the window landed on, as the window's shortcuts ask it:
 * the proof's text and the feature file are textareas, a search keeps its own
 * undo, and Space on a button presses the button.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

function put(html: string): Element {
  document.body.innerHTML = html;
  return document.body.querySelector("[data-hit]") ?? document.body.firstElementChild!;
}

describe("keyTarget", () => {
  it("counts a textarea as typing, so ? is left to it", () => {
    expect(keyTarget(put("<textarea></textarea>")).typing).toBe(true);
    expect(keyTarget(put("<input>")).typing).toBe(true);
    expect(keyTarget(put("<div></div>")).typing).toBe(false);
  });

  it("marks the fields that keep their own undo, and only those", () => {
    expect(keyTarget(put("<input data-own-undo>")).ownUndo).toBe(true);
    expect(keyTarget(put("<textarea></textarea>")).ownUndo).toBe(false);
  });

  it("knows a key on a button, or inside one, is the button's", () => {
    expect(keyTarget(put("<button><span data-hit></span></button>")).onControl).toBe(true);
    expect(keyTarget(put("<canvas></canvas>")).onControl).toBe(false);
    expect(keyTarget(window).onControl).toBe(false);
  });
});
