import { describe, expect, it } from "vitest";

import { clearStoredSettings, installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { EditorStore } = await import("../src/store/index.js");
const { exportFamily } = await import("@typewright/font-io");
const { WEIGHT, DEFAULT_FONT_INFO, fontDocument, glyph } = await import("@typewright/font-model");

/**
 * Opening a family.
 *
 * There is no storage worker here, so the masters that are not open cannot
 * really be parked — what these ask is that the archive is recognised, that the
 * axes and the masters arrive, and that the first of them is the one put on
 * screen. Parking is exercised where it lives.
 */

const font = (family: string, advance: number) =>
  fontDocument([glyph("a", { advance, unicodes: [0x61] })], {
    ...DEFAULT_FONT_INFO,
    familyName: family,
  });

/** A family archive, as this editor writes one. */
function archive(): ArrayBuffer {
  const { bytes } = exportFamily(
    [WEIGHT],
    [
      { name: "Regular", location: { wght: 400 }, document: font("Chalk", 500) },
      { name: "Bold", location: { wght: 700 }, document: font("Chalk", 560) },
    ],
  );
  return bytes.slice().buffer;
}

function freshStore() {
  clearStoredSettings();
  return new EditorStore();
}

describe("opening a family", () => {
  it("recognises one inside an archive that looks like any other", async () => {
    const store = freshStore();
    // The name says `.zip`, as a plain UFO's does: the difference is the
    // designspace inside, and only opening it can tell.
    const report = await store.importFont(archive(), "Chalk.zip");

    expect(report.family).toBe("Chalk Regular");
    expect(report.warnings[0]).toBe("2 masters: Regular, Bold");
  });

  it("brings the axes and the masters with it", async () => {
    const store = freshStore();
    await store.importFont(archive(), "Chalk.zip");

    const { project } = store.getState();
    expect(project.axes).toEqual([WEIGHT]);
    expect(project.masters.map((m) => m.name)).toEqual(["Regular", "Bold"]);
    expect(project.masters.map((m) => m.location)).toEqual([{ wght: 400 }, { wght: 700 }]);
  });

  it("puts the first master on screen", async () => {
    const store = freshStore();
    await store.importFont(archive(), "Chalk.zip");

    expect(store.editor.document.glyphs["a"]?.advance).toBe(500);
    expect(store.getState().project.current).toBe(store.getState().project.masters[0]?.id);
  });

  it("still opens an ordinary UFO as one font", async () => {
    const store = freshStore();
    const { exportUfo } = await import("@typewright/font-io");
    const { bytes } = exportUfo(font("Plain", 480));

    const report = await store.importFont(bytes.slice().buffer, "Plain.ufo.zip");

    expect(report.family).toBe("Plain Regular");
    expect(store.getState().project.masters).toHaveLength(1);
    expect(store.getState().project.axes).toEqual([]);
  });

  it("forgets the masters of the font that was open", async () => {
    const store = freshStore();
    await store.importFont(archive(), "Chalk.zip");
    expect(store.getState().project.masters).toHaveLength(2);

    const { exportUfo } = await import("@typewright/font-io");
    const { bytes } = exportUfo(font("Plain", 480));
    await store.importFont(bytes.slice().buffer, "Plain.ufo.zip");

    // They were drawings of a typeface that is no longer open.
    expect(store.getState().project.masters).toHaveLength(1);
  });
});
