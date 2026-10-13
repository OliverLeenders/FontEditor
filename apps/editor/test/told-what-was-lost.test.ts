import { describe, expect, it } from "vitest";

import { WEIGHT, copyOf, mark, opened } from "./walk-harness.js";

const { MemoryFileStore, glyphPath } = await import("@typewright/storage");

/**
 * A font that came in without something, and where that is said.
 *
 * Reading goes on past a glyph that cannot be read: most of a font back is the
 * point. But which glyph, and that there was one, was said to the console and
 * to nobody else, or as a number beside a menu. These ask that it is said on
 * the status line, a line to each thing lost, as what an export left out is.
 */

/** Every path a working copy has for a glyph's own file, whichever generation it is in. */
async function fileOf(files: InstanceType<typeof MemoryFileStore>, name: string): Promise<string> {
  const found = (await files.list("")).filter((path) => path.endsWith(glyphPath(name)));
  if (found.length !== 1) throw new Error(`${String(found.length)} files for ${name}`);
  return found[0]!;
}

describe("a glyph the browser's copy cannot give back", () => {
  it("is named on the status line when the font is opened", async () => {
    const files = new MemoryFileStore();
    const first = await opened(files);
    mark(first, "the font");
    await first.flushNow();

    // A file cut short, as a write that was interrupted leaves one.
    const damaged = await copyOf(files);
    await damaged.write(await fileOf(damaged, "o"), '{"name":"o","adv');

    const store = await opened(damaged);
    const notice = store.getState().notice;
    expect(notice?.failed).toBe(true);
    expect(notice?.summary).toMatch(/1 glyph could not be read$/);
    expect(notice?.details.join("\n")).toContain("o.json");
    expect(store.editor.document.glyphs["o"]).toBeUndefined();
  });

  it("says nothing where everything was read", async () => {
    const files = new MemoryFileStore();
    const first = await opened(files);
    mark(first, "the font");
    await first.flushNow();

    expect((await opened(await copyOf(files))).getState().notice).toBeNull();
  });
});

describe("a master that comes back without a glyph", () => {
  it("is named on the status line when it is gone to", async () => {
    const files = new MemoryFileStore();
    const store = await opened(files);
    await store.setAxes([WEIGHT]);
    await store.addMaster("bold", "Bold", { wght: 900 });
    await store.flushNow();

    // The bold is parked whole in one file: one of its glyphs spoiled there.
    const parked = (await files.list("masters/")).find((path) => path.includes("bold"));
    if (parked === undefined) throw new Error("the bold is not parked");
    const whole = JSON.parse((await files.read(parked)) ?? "") as {
      glyphs: { contours: unknown }[];
    };
    whole.glyphs[0]!.contours = "none";
    await files.write(parked, JSON.stringify(whole));

    // Opened again, so that the bold is read from its file and not remembered.
    const again = await opened(await copyOf(files));
    const done = await again.switchMaster("bold");
    expect(done?.problems).toHaveLength(1);
    const notice = again.getState().notice;
    expect(notice?.failed).toBe(true);
    expect(notice?.summary).toBe("Bold: 1 glyph could not be read");
    expect(notice?.details).toEqual(done?.problems);
  });
});
