import type { ZipEntry } from "@typewright/font-io";
import { describe, expect, it } from "vitest";

import { writeFolder } from "../src/folder.js";
import { FakeFolder } from "./fake-folder.js";

/**
 * A glyph taken out of a layer behind the drawing, and the folder afterwards.
 *
 * Only the drawing's own glyph files were tidied. A sketch cleared from the
 * background was taken off that layer's list and left in its directory, a file
 * no list named, for as long as the folder lasted.
 */

const listOf = (names: readonly string[]): string =>
  `<plist><dict>${names.map((n) => `<key>${n}</key><string>${n}.glif</string>`).join("")}</dict></plist>`;

/** A font's files, as far as this is about: the drawing and one layer behind it. */
function files(drawn: readonly string[], behind: readonly string[] | null): ZipEntry[] {
  const out: ZipEntry[] = [
    { path: "metainfo.plist", text: "<plist/>" },
    { path: "glyphs/contents.plist", text: listOf(drawn) },
    ...drawn.map((n) => ({ path: `glyphs/${n}.glif`, text: `<glyph name="${n}"/>` })),
  ];
  if (behind !== null) {
    out.push(
      { path: "glyphs.background/contents.plist", text: listOf(behind) },
      ...behind.map((n) => ({
        path: `glyphs.background/${n}.glif`,
        text: `<glyph name="${n}"/>`,
      })),
    );
  }
  return out;
}

describe("a glyph gone from a layer behind the drawing", () => {
  it("is gone from that layer's directory, and from nowhere else", async () => {
    const folder = new FakeFolder("Test.ufo");
    await writeFolder(folder, files(["a", "b"], ["a", "b"]));

    const report = await writeFolder(folder, files(["a", "b"], ["a"]));

    expect(report.removed).toEqual(["glyphs.background/b.glif"]);
    const left = [...folder.all().keys()];
    expect(left).not.toContain("glyphs.background/b.glif");
    expect(left).toContain("glyphs.background/a.glif");
    expect(left).toContain("glyphs/b.glif");
  });

  it("is named as it always was when it is gone from the drawing", async () => {
    const folder = new FakeFolder("Test.ufo");
    await writeFolder(folder, files(["a", "b"], ["a", "b"]));

    const report = await writeFolder(folder, files(["a"], ["a", "b"]));
    expect(report.removed).toEqual(["b.glif"]);
    expect([...folder.all().keys()]).toContain("glyphs.background/b.glif");
  });

  it("leaves alone a file in the layer that its list never named", async () => {
    const folder = new FakeFolder("Test.ufo");
    await writeFolder(folder, files(["a"], ["a", "b"]));
    folder.put("glyphs.background/somebody-elses.glif", "<glyph/>");

    await writeFolder(folder, files(["a"], ["a"]));
    expect([...folder.all().keys()]).toContain("glyphs.background/somebody-elses.glif");
  });

  it("leaves a layer alone altogether when this save does not write it", async () => {
    // A layer the font no longer has: its directory is the user's to delete.
    const folder = new FakeFolder("Test.ufo");
    await writeFolder(folder, files(["a"], ["a", "b"]));

    const report = await writeFolder(folder, files(["a"], null));
    expect(report.removed).toEqual([]);
    expect([...folder.all().keys()]).toContain("glyphs.background/b.glif");
  });
});
