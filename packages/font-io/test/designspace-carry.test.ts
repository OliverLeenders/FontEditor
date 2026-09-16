import { DEFAULT_FONT_INFO, WEIGHT, counterIds, fontDocument, glyph } from "@typewright/font-model";
import { describe, expect, it } from "vitest";

import { designspaceXml, parseDesignspace } from "../src/designspace.js";
import { familyFiles, readFamily } from "../src/family.js";
import { entryBytes, entryText } from "../src/zip.js";

/**
 * A designspace as somebody else wrote it, opened and written back.
 *
 * The file below uses what real families use and what this editor did not use
 * to read: a map between the weight a menu offers and the stem it is drawn at,
 * an axis with stops, rules that swap glyphs, a source that is a layer of
 * another's UFO, and the parts of version 5 nothing here acts on. None of it
 * may be lost by opening the file and saving it.
 */

const FILE = `<?xml version="1.0" encoding="UTF-8"?>
<designspace format="5.0">
  <axes elidedfallbackname="Regular">
    <axis tag="wght" name="Weight" minimum="100" maximum="900" default="400">
      <map input="100" output="20"/>
      <map input="400" output="80"/>
      <map input="900" output="220"/>
      <labels>
        <label uservalue="400" name="Regular" elidable="true"/>
      </labels>
    </axis>
    <axis tag="ital" name="Italic" values="0 1" default="0" hidden="1"/>
  </axes>
  <rules processing="last">
    <rule name="heavy dollar">
      <conditionset>
        <condition name="Weight" minimum="150"/>
      </conditionset>
      <sub name="dollar" with="dollar.heavy"/>
    </rule>
    <rule name="old style">
      <condition name="Weight" maximum="50"/>
      <sub name="g" with="g.alt"/>
    </rule>
  </rules>
  <sources>
    <source filename="Chalk-Regular.ufo" name="Chalk Regular" familyname="Chalk" stylename="Regular">
      <features copy="1"/>
      <location>
        <dimension name="Weight" xvalue="80"/>
        <dimension name="Italic" xvalue="0"/>
      </location>
    </source>
    <source filename="Chalk-Regular.ufo" name="Chalk Mid" familyname="Chalk" stylename="Mid" layer="{150}">
      <location>
        <dimension name="Weight" xvalue="150"/>
        <dimension name="Italic" xvalue="0"/>
      </location>
    </source>
    <source filename="Chalk-Black.ufo" name="Chalk Black" familyname="Chalk" stylename="Black">
      <location>
        <dimension name="Weight" uservalue="900"/>
        <dimension name="Italic" xvalue="0"/>
      </location>
    </source>
  </sources>
  <variable-fonts>
    <variable-font name="Chalk-Upright">
      <axis-subsets>
        <axis-subset name="Weight"/>
      </axis-subsets>
    </variable-font>
  </variable-fonts>
  <instances>
    <instance familyname="Chalk" stylename="Bold" filename="instances/Chalk-Bold.ufo" postscriptfontname="Chalk-Bold" stylemapstylename="bold">
      <location>
        <dimension name="Weight" xvalue="150"/>
      </location>
      <lib>
        <dict>
          <key>com.example.note</key>
          <string>keep me</string>
        </dict>
      </lib>
    </instance>
  </instances>
  <lib>
    <dict>
      <key>com.example.family</key>
      <string>ours</string>
    </dict>
  </lib>
</designspace>
`;

describe("a designspace somebody else wrote", () => {
  const read = parseDesignspace(FILE)!;

  it("keeps the axis on the design scale, with its map", () => {
    const [weight, italic] = read.axes;
    expect(weight).toMatchObject({ tag: "wght", min: 20, default: 80, max: 220 });
    expect(weight?.map).toEqual([
      [100, 20],
      [400, 80],
      [900, 220],
    ]);
    expect(italic).toMatchObject({ tag: "ital", min: 0, max: 1, values: [0, 1] });
    expect(italic?.kept?.attributes).toEqual({ hidden: "1" });
  });

  it("reads a place given on the user scale through the map", () => {
    expect(read.sources[2]?.location).toEqual({ wght: 220, ital: 0 });
  });

  it("reads the rules, in both ways of writing a condition", () => {
    expect(read.rulesProcessing).toBe("last");
    expect(read.rules).toEqual([
      {
        name: "heavy dollar",
        conditionSets: [[{ tag: "wght", min: 150, max: null }]],
        swaps: [["dollar", "dollar.heavy"]],
      },
      {
        name: "old style",
        conditionSets: [[{ tag: "wght", min: null, max: 50 }]],
        swaps: [["g", "g.alt"]],
      },
    ]);
  });

  it("knows a source that is a layer", () => {
    expect(read.sources[1]?.layer).toBe("{150}");
    expect(read.sources[0]?.layer).toBeUndefined();
  });

  it("writes back what it did not read", () => {
    const written = designspaceXml(read);

    expect(written).toContain('<designspace format="5.0">');
    expect(written).toContain('<axes elidedfallbackname="Regular">');
    expect(written).toContain(
      '<axis tag="wght" name="Weight" minimum="100" maximum="900" default="400">',
    );
    expect(written).toContain('<map input="400" output="80"/>');
    expect(written).toContain('<label uservalue="400" name="Regular" elidable="true"/>');
    expect(written).toContain(
      '<axis tag="ital" name="Italic" values="0 1" default="0" hidden="1"/>',
    );
    expect(written).toContain('<rules processing="last">');
    expect(written).toContain('<features copy="1"/>');
    expect(written).toContain('layer="{150}"');
    expect(written).toContain('<variable-font name="Chalk-Upright">');
    expect(written).toContain('postscriptfontname="Chalk-Bold"');
    expect(written).toContain("<string>keep me</string>");
    expect(written).toContain("<string>ours</string>");
    // And nothing it did not have: the file said which source to copy from.
    expect(written).not.toContain("<info copy");
  });

  it("settles after being written once", () => {
    // The first write fills in every axis of every location, which the file had
    // left to default; after that, reading and writing change nothing.
    const once = parseDesignspace(designspaceXml(read))!;
    expect(once.instances[0]?.location).toEqual({ wght: 150, ital: 0 });
    expect(parseDesignspace(designspaceXml(once))).toEqual(once);
    expect({ ...once, instances: [] }).toEqual({ ...read, instances: [] });
  });
});

describe("a family with a master drawn as a layer", () => {
  const ids = counterIds("carry");
  const font = (advance: number, names: readonly string[]) =>
    fontDocument(
      names.map((name) => glyph(name, { advance })),
      { ...DEFAULT_FONT_INFO, familyName: "Chalk" },
    );

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

  const masters = [
    {
      name: "Regular",
      location: { wght: 400 },
      document: font(500, ["a", "dollar"]),
      layers: [sketch],
    },
    { name: "Black", location: { wght: 900 }, document: font(600, ["a", "dollar"]) },
    {
      name: "Mid",
      location: { wght: 650 },
      document: font(580, ["dollar"]),
      sparse: { of: 0, layer: "{650}" },
    },
  ];
  const rules = [
    {
      id: "r",
      name: "heavy",
      conditionSets: [[{ tag: "wght", min: 600, max: null }]],
      swaps: [["dollar", "dollar.heavy"] as const],
    },
  ];

  const files = familyFiles([WEIGHT], masters, [], { rules, rulesProcessing: "last" });
  const paths = files.map((f) => f.path);

  it("writes the layer into the UFO of the master it belongs to", () => {
    expect(paths.some((p) => p.startsWith("Chalk-Mid.ufo/"))).toBe(false);
    expect(paths).toContain("Chalk-Regular.ufo/glyphs.%7B650%7D/dollar.glif");
    expect(paths).toContain("Chalk-Regular.ufo/glyphs.sketch/a.glif");

    const designspace = entryText(files.find((f) => f.path === "Chalk.designspace")!);
    expect(designspace).toContain('filename="Chalk-Regular.ufo" name="Chalk Mid"');
    expect(designspace).toContain('layer="{650}"');
    expect(designspace).toContain('<sub name="dollar" with="dollar.heavy"/>');
  });

  it("reads back as the masters, the layer and the rules that went in", () => {
    const read = readFamily(
      files.map((f) => ({ path: f.path, bytes: entryBytes(f) })),
      ids,
    );
    if ("reason" in read) throw new Error(read.reason);

    expect(read.masters.map((m) => m.name)).toEqual(["Regular", "Black", "Mid"]);
    const mid = read.masters[2]!;
    expect(mid.sparse).toMatchObject({ of: 0, layer: "{650}" });
    expect(mid.document.glyphOrder).toEqual(["dollar"]);
    expect(mid.document.glyphs["dollar"]?.advance).toBe(580);

    // The sketch is still carried; the layer that became a master is not
    // carried as well, or the next save would write it twice.
    expect(read.masters[0]?.layers.map((l) => l.name)).toEqual(["sketch"]);
    expect(read.rules.map((r) => r.swaps)).toEqual([[["dollar", "dollar.heavy"]]]);
    expect(read.rulesProcessing).toBe("last");
  });

  it("says so when a layer names a file that is not a master", () => {
    const text = entryText(files.find((f) => f.path === "Chalk.designspace")!).replace(
      'filename="Chalk-Regular.ufo" name="Chalk Mid"',
      'filename="Elsewhere.ufo" name="Chalk Mid"',
    );
    const read = readFamily(
      files.map((f) => ({
        path: f.path,
        bytes: f.path === "Chalk.designspace" ? new TextEncoder().encode(text) : entryBytes(f),
      })),
      ids,
    );
    if ("reason" in read) throw new Error(read.reason);
    expect(read.masters.map((m) => m.name)).toEqual(["Regular", "Black"]);
    expect(read.warnings.map((w) => w.message).join(" ")).toMatch(
      /Mid is a layer of Elsewhere\.ufo/,
    );
  });
});
