import { describe, expect, it } from "vitest";

import { installBrowserGlobals } from "./browser-globals.js";

installBrowserGlobals();

const { EditorStore } = await import("../src/store/index.js");
const { compile } = await import("../src/exporting.js");
const { runExport } = await import("../src/export-jobs.js");

/**
 * An export asked for by name, as a worker is asked for it.
 *
 * Here there is no worker, so it is done where it is asked for — which is what
 * a page that could not start one does too. That it is really done in one, with
 * the window answering meanwhile, is asked in a browser.
 */
describe("an export asked for as a job", () => {
  const document = new EditorStore().editor.document;

  it("makes the font, and says how far it has got on the way", async () => {
    const told: [number, number][] = [];
    const made = await compile({ kind: "otf", document }, (done, total) => {
      told.push([done, total]);
    });

    // An OpenType font with CFF outlines begins with OTTO.
    const head = new Uint8Array(made.bytes).subarray(0, 4);
    expect(String.fromCharCode(...head)).toBe("OTTO");
    // Of every glyph the font is written with, counted from none.
    expect(told[0]?.[0]).toBe(0);
    expect(told.every(([, total]) => total === told[0]![1])).toBe(true);
    expect(told[0]![1]).toBeGreaterThanOrEqual(document.glyphOrder.length);
  });

  it("makes the same font each way it is asked for", async () => {
    const ttf = await compile({ kind: "ttf", document });
    const direct = await runExport({ kind: "ttf", document });
    expect(ttf.bytes.byteLength).toBe(direct.bytes.byteLength);
    // A TrueType font begins with its version, 1.0.
    expect([...new Uint8Array(ttf.bytes).subarray(0, 4)]).toEqual([0, 1, 0, 0]);
  });

  it("gives back a picture for each glyph that draws something", async () => {
    const files = await compile({ kind: "svgs", document });
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file.path.endsWith(".svg"))).toBe(true);
  });

  it("fails as the export fails, and not as something else", async () => {
    const empty = { ...document, glyphOrder: [], glyphs: {} };
    await expect(compile({ kind: "otf", document: empty })).rejects.toThrow(/no glyphs/);
  });
});
