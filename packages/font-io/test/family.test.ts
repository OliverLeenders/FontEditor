import {
  DEFAULT_FONT_INFO,
  WEIGHT,
  axis,
  counterIds,
  fontDocument,
  glyph,
} from "@typewright/font-model";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { designspaceXml, parseDesignspace } from "../src/designspace.js";
import { exportFamily, familyFiles, looksLikeFamily, readFamily } from "../src/family.js";
import { unzip } from "../src/unzip.js";
import { entryBytes, entryText } from "../src/zip.js";

/**
 * A family: several UFOs and the designspace that ties them together.
 *
 * The arrangement is the thing being tested. A UFO knows nothing of the others,
 * so everything that makes a family a family lives in one small XML file — and
 * a designspace naming a UFO that is not beside it is the failure this cannot
 * afford, because it is invisible until a build.
 */

const ids = counterIds("fam");

const font = (family: string, advance: number) =>
  fontDocument([glyph("a", { advance, unicodes: [0x61] })], {
    ...DEFAULT_FONT_INFO,
    familyName: family,
  });

const masters = () => [
  { name: "Regular", location: { wght: 400 }, document: font("Chalk", 500) },
  { name: "Bold", location: { wght: 700 }, document: font("Chalk", 560) },
];

/** The files a family is made of, by path. */
const filesOf = () => new Map(familyFiles([WEIGHT], masters()).map((e) => [e.path, e]));

describe("what a family is made of", () => {
  it("is a designspace and one UFO for each master", () => {
    const paths = [...filesOf().keys()];

    expect(paths).toContain("Chalk.designspace");
    expect(paths).toContain("Chalk-Regular.ufo/metainfo.plist");
    expect(paths).toContain("Chalk-Bold.ufo/glyphs/a.glif");
  });

  it("names in the designspace exactly the folders it wrote", () => {
    const files = filesOf();
    const designspace = parseDesignspace(entryText(files.get("Chalk.designspace")!));

    // The failure this cannot afford: a source naming a UFO that is not here.
    for (const source of designspace?.sources ?? []) {
      expect([...files.keys()].some((p) => p.startsWith(`${source.filename}/`))).toBe(true);
    }
  });

  it("puts each master's own drawing in its own UFO", () => {
    const files = filesOf();
    expect(entryText(files.get("Chalk-Regular.ufo/glyphs/a.glif")!)).toContain('width="500"');
    expect(entryText(files.get("Chalk-Bold.ufo/glyphs/a.glif")!)).toContain('width="560"');
  });

  it("carries each master's own pictures into its own UFO", () => {
    const picture = new Uint8Array([1, 2, 3]);
    const entries = familyFiles(
      [WEIGHT],
      [{ ...masters()[0]!, images: new Map([["sheet.png", picture]]) }, masters()[1]!],
    );

    const found = entries.find((e) => e.path === "Chalk-Regular.ufo/images/sheet.png");
    expect(found).toBeDefined();
    expect(entryBytes(found!)).toEqual(picture);
    expect(entries.some((e) => e.path.startsWith("Chalk-Bold.ufo/images/"))).toBe(false);
  });
});

describe("the designspace file", () => {
  it("names its axes by tag and its locations by name", () => {
    const text = designspaceXml({
      axes: [WEIGHT],
      instances: [],
      sources: [
        {
          filename: "Chalk-Bold.ufo",
          name: "Chalk Bold",
          familyName: "Chalk",
          styleName: "Bold",
          location: { wght: 700 },
        },
      ],
    });

    expect(text).toContain('<axis tag="wght" name="Weight" minimum="100" maximum="900"');
    // A location names the axis by name, never by tag. Every reader of this
    // format expects that and nothing says so out loud.
    expect(text).toContain('<dimension name="Weight" xvalue="700"/>');
  });

  it("says which source the family's information comes from", () => {
    const text = designspaceXml({
      axes: [WEIGHT],
      instances: [],
      sources: [
        {
          filename: "a.ufo",
          name: "A",
          familyName: "Chalk",
          styleName: "Regular",
          location: {},
        },
        { filename: "b.ufo", name: "B", familyName: "Chalk", styleName: "Bold", location: {} },
      ],
    });

    // Once, on the first: somebody has to be, and a build that guesses picks
    // differently from the editor that wrote it.
    expect(text.match(/<info copy="1"\/>/g)).toHaveLength(1);
  });

  it("reads back what it wrote", () => {
    const before = {
      axes: [WEIGHT, axis("wdth", "Width", 75, 100, 125)],
      instances: [
        {
          familyName: "Chalk",
          styleName: "Semibold",
          filename: "instance_ufo/Chalk-Semibold.ufo",
          location: { wght: 600, wdth: 100 },
        },
      ],
      sources: [
        {
          filename: "Chalk-Regular.ufo",
          name: "Chalk Regular",
          familyName: "Chalk",
          styleName: "Regular",
          location: { wght: 400, wdth: 100 },
        },
        {
          filename: "Chalk-Bold.ufo",
          name: "Chalk Bold",
          familyName: "Chalk",
          styleName: "Bold",
          location: { wght: 700, wdth: 75 },
        },
      ],
    };

    const after = parseDesignspace(designspaceXml(before));
    expect(after?.axes).toEqual(before.axes);
    expect(after?.sources).toEqual(before.sources);
    expect(after?.instances).toEqual(before.instances);
  });

  it("is not fooled by something that is not one", () => {
    expect(parseDesignspace("<html><body/></html>")).toBeNull();
    expect(parseDesignspace("not xml at all")).toBeNull();
  });

  it("ignores a dimension naming an axis the file does not have", () => {
    const text = [
      '<designspace format="4.1">',
      '<axes><axis tag="wght" name="Weight" minimum="100" maximum="900" default="400"/></axes>',
      '<sources><source filename="a.ufo" name="A" familyname="C" stylename="R">',
      "<location>",
      '<dimension name="Weight" xvalue="700"/>',
      '<dimension name="Optical size" xvalue="12"/>',
      "</location></source></sources>",
      "</designspace>",
    ].join("");

    expect(parseDesignspace(text)?.sources[0]?.location).toEqual({ wght: 700 });
  });
});

describe("reading a family back", () => {
  const archive = async () => {
    const { bytes } = exportFamily([WEIGHT], masters());
    const files = await unzip(bytes.buffer.slice(0) as ArrayBuffer);
    if (!Array.isArray(files)) throw new Error(files.reason);
    return files;
  };

  it("knows one when it sees one", async () => {
    expect(looksLikeFamily(await archive())).toBe(true);
    expect(looksLikeFamily([{ path: "a.ufo/metainfo.plist", bytes: new Uint8Array() }])).toBe(
      false,
    );
  });

  it("comes back as the masters that went in", async () => {
    const read = readFamily(await archive(), ids);
    if ("reason" in read) throw new Error(read.reason);

    expect(read.axes).toEqual([WEIGHT]);
    expect(read.masters.map((m) => m.name)).toEqual(["Regular", "Bold"]);
    expect(read.masters.map((m) => m.location)).toEqual([{ wght: 400 }, { wght: 700 }]);
    expect(read.masters[0]?.document.glyphs["a"]?.advance).toBe(500);
    expect(read.masters[1]?.document.glyphs["a"]?.advance).toBe(560);
  });

  it("refuses something that is not a family", async () => {
    const out = readFamily([{ path: "a.txt", bytes: new Uint8Array() }], ids);
    expect("reason" in out && out.reason).toMatch(/not a family/);
  });

  it("opens what it can when a master is missing, and says which", async () => {
    const files = (await archive()).filter((f) => !f.path.includes("Chalk-Bold.ufo/"));
    const read = readFamily(files, ids);
    if ("reason" in read) throw new Error(read.reason);

    // Two masters of which one is here is worth opening; the alternative is a
    // designer with nothing on screen and no idea which file has gone.
    expect(read.masters.map((m) => m.name)).toEqual(["Regular"]);
    expect(read.warnings.map((w) => w.message).join(" ")).toMatch(/Chalk-Bold\.ufo is not/);
  });

  it("refuses a designspace whose sources are all missing", async () => {
    const files = (await archive()).filter((f) => f.path.endsWith(".designspace"));
    const out = readFamily(files, ids);
    expect("reason" in out && out.reason).toMatch(/names no source/);
  });
});

describe("the proof family", () => {
  /**
   * Write a family out for fontTools to read.
   *
   * A designspace is a document about files, and the failure it makes possible
   * — naming a UFO that is not beside it — is invisible to anything that only
   * reads what we wrote. So the same reader every build pipeline uses is handed
   * the whole arrangement on CI.
   */
  it("writes itself out when asked to", () => {
    const out = process.env["FAMILY_OUT"] ?? "";
    if (out === "") return;

    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });

    for (const entry of familyFiles([WEIGHT], masters())) {
      const path = join(out, entry.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, entryBytes(entry));
    }
  });
});
