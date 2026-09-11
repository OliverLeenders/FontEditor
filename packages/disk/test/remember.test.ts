import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DiskFolder } from "../src/handles.js";
import { forgetFolder, recallFolder, rememberFolder } from "../src/remember.js";
import { type FakeFactory, installFakeIdb } from "./fake-idb.js";

const folder = (name: string): DiskFolder => ({ name }) as unknown as DiskFolder;

/** What the old version of this editor left behind, in the shape it left it. */
function seedOldDatabase(factory: FakeFactory, name: string): void {
  factory
    .make("fonteditor-disk")
    .store("handles")
    .set("ufo-folder", {
      folder: folder(name),
      name,
      at: 7,
      wrote: [["glyphs/a.glif", { crc: 1, at: 2 }]],
    });
}

let factory: FakeFactory;
let restore: () => void;

beforeEach(() => {
  ({ factory, restore } = installFakeIdb());
});

afterEach(() => {
  restore();
});

describe("remembering the folder", () => {
  it("reads back what was remembered", async () => {
    await rememberFolder(folder("Source"), new Map([["a.glif", { crc: 3, at: 4 }]]));
    const back = await recallFolder();

    expect(back?.name).toBe("Source");
    expect(back?.wrote).toEqual([["a.glif", { crc: 3, at: 4 }]]);
  });

  it("forgets on request", async () => {
    await rememberFolder(folder("Source"));
    await forgetFolder();
    expect(await recallFolder()).toBeNull();
  });

  it("is null when nothing was ever remembered", async () => {
    expect(await recallFolder()).toBeNull();
  });

  it("does not leave behind a database named after the editor's old name", async () => {
    await recallFolder();
    const names = (await factory.databases()).map((it) => it.name);
    expect(names).not.toContain("fonteditor-disk");
  });
});

describe("a folder remembered before the editor was named", () => {
  it("is found under the old name", async () => {
    seedOldDatabase(factory, "Older");
    const back = await recallFolder();

    expect(back?.name).toBe("Older");
    expect(back?.wrote).toEqual([["glyphs/a.glif", { crc: 1, at: 2 }]]);
  });

  it("is moved across, so the old database is asked once and never again", async () => {
    seedOldDatabase(factory, "Older");
    await recallFolder();

    // Gone from the old database's reach: emptying it changes nothing now.
    factory.databasesByName.delete("fonteditor-disk");
    expect((await recallFolder())?.name).toBe("Older");
  });

  it("gives way to whatever is under the new name", async () => {
    seedOldDatabase(factory, "Older");
    await rememberFolder(folder("Newer"));

    expect((await recallFolder())?.name).toBe("Newer");
  });
});
