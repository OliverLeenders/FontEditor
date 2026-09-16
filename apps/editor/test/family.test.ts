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

describe("a family that uses more of the designspace", () => {
  const sketch = {
    name: "sketch",
    directory: "glyphs.sketch",
    files: [
      {
        path: "contents.plist",
        text: "<plist><dict><key>a</key><string>a.glif</string></dict></plist>",
      },
      { path: "a.glif", text: '<glyph name="a" format="2"><advance width="1"/></glyph>' },
    ],
  };

  /** A regular with a sketch layer, a bold, a middle master as a layer, a rule and a map. */
  function richer(): ArrayBuffer {
    const { bytes } = exportFamily(
      [
        {
          ...WEIGHT,
          map: [
            [100, 100],
            [400, 400],
            [700, 600],
            [900, 900],
          ],
        },
      ],
      [
        {
          name: "Regular",
          location: { wght: 400 },
          document: font("Chalk", 500),
          layers: [sketch],
        },
        { name: "Bold", location: { wght: 900 }, document: font("Chalk", 600) },
        {
          name: "Mid",
          location: { wght: 650 },
          document: font("Chalk", 590),
          sparse: { of: 0, layer: "{650}" },
        },
      ],
      [],
      {
        rules: [
          {
            id: "r",
            name: "heavy",
            conditionSets: [[{ tag: "wght", min: 600, max: null }]],
            swaps: [["a", "a.alt"]],
          },
        ],
        rulesProcessing: "last",
      },
    );
    return bytes.slice().buffer;
  }

  it("keeps the map, the rule, and which master is a layer of which", async () => {
    const store = freshStore();
    await store.importFont(richer(), "Chalk.zip");
    const { project, layers } = store.getState();

    expect(project.axes[0]?.map?.[2]).toEqual([700, 600]);
    expect(project.rules.map((r) => r.name)).toEqual(["heavy"]);
    expect(project.rulesProcessing).toBe("last");

    const [regular, , mid] = project.masters;
    expect(mid?.sparse).toMatchObject({ of: regular?.id, layer: "{650}" });
    // The sketch is the regular's, and the layer that became the Mid is not
    // carried as well.
    expect(layers.map((l) => [l.name, l.master])).toEqual([["sketch", regular?.id]]);
  });

  it("writes back the same arrangement it opened", async () => {
    const store = freshStore();
    await store.importFont(richer(), "Chalk.zip");

    const { entryText, familyFiles, parseDesignspace, readFamily, unzip } =
      await import("@typewright/font-io");
    const { randomIds } = await import("@typewright/font-model");

    // There is no storage worker here to park the masters that are not open, so
    // they are put back into the project from the archive they came from.
    const unzipped = await unzip(richer());
    if (!Array.isArray(unzipped)) throw new Error(unzipped.reason);
    const read = readFamily(unzipped, randomIds());
    if ("reason" in read) throw new Error(read.reason);
    const opened = store.getState().project;
    store.patch({
      project: {
        ...opened,
        sources: Object.fromEntries(
          opened.masters.map((m, i) => [m.id, read.masters[i]!.document]),
        ),
      },
    });

    const { project } = store.getState();
    const files = familyFiles(project.axes, await store.familyMasters(), project.instances, {
      rules: project.rules,
      rulesProcessing: project.rulesProcessing,
      kept: project.kept,
    });
    const paths = files.map((f) => f.path);

    expect(paths).toContain("Chalk-Regular.ufo/glyphs.sketch/a.glif");
    expect(paths).toContain("Chalk-Regular.ufo/glyphs.%7B650%7D/a.glif");
    expect(paths.some((p) => p.startsWith("Chalk-Bold.ufo/glyphs.sketch"))).toBe(false);

    const written = files.find((f) => f.path === "Chalk.designspace");
    const designspace = parseDesignspace(written === undefined ? "" : entryText(written));
    // Lightest first, as the masters are always listed: the Mid between the two.
    expect(designspace?.sources.map((s) => [s.styleName, s.layer])).toEqual([
      ["Regular", undefined],
      ["Mid", "{650}"],
      ["Bold", undefined],
    ]);
    expect(designspace?.sources[1]?.filename).toBe("Chalk-Regular.ufo");
    expect(designspace?.rulesProcessing).toBe("last");
  });
});
