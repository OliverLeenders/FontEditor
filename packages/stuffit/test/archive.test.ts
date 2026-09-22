import { describe, expect, it } from "vitest";

import { looksLikeStuffIt, readArchive, unpackFork } from "../src/archive.js";
import { madeArchive } from "../src/testing.js";

const bytesOf = (text: string): Uint8Array =>
  Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

const textOf = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

describe("recognising an archive", () => {
  it("knows one by the string at the front", () => {
    expect(looksLikeStuffIt(madeArchive([{ name: "a" }]))).toBe(true);
  });

  it("does not mistake a short file for one", () => {
    expect(looksLikeStuffIt(bytesOf("StuffIt (c)1997-"))).toBe(false);
  });

  it("refuses to read something else", () => {
    expect(() => readArchive(new Uint8Array(200))).toThrow(/not a StuffIt archive/);
  });
});

describe("walking an archive", () => {
  it("finds a file and both of its forks", () => {
    const archive = madeArchive([
      {
        name: "Chicago",
        type: "FFIL",
        creator: "DMOV",
        resource: bytesOf("the glyphs"),
        data: bytesOf("nothing much"),
      },
    ]);

    const { entries } = readArchive(archive);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.kind).toBe("file");
    expect(entry.name).toBe("Chicago");
    expect(entry.fileType).toBe("FFIL");
    expect(entry.creator).toBe("DMOV");
    expect(textOf(unpackFork(archive, entry.resource!))).toBe("the glyphs");
    expect(textOf(unpackFork(archive, entry.data!))).toBe("nothing much");
  });

  it("reads a file with no resource fork at all", () => {
    const archive = madeArchive([{ name: "read me", data: bytesOf("hello") }]);
    const entry = readArchive(archive).entries[0]!;

    expect(entry.resource).toBeNull();
    expect(textOf(unpackFork(archive, entry.data!))).toBe("hello");
  });

  it("gives a file inside a folder the path it has", () => {
    const archive = madeArchive([
      {
        name: "Fonts",
        children: [{ name: "Geneva", type: "FFIL", resource: bytesOf("g") }],
      },
    ]);

    const { entries } = readArchive(archive);
    expect(entries.map((e) => `${e.kind} ${e.path}`)).toEqual([
      "folder Fonts",
      "file Fonts/Geneva",
    ]);
  });

  it("keeps walking past a folder to what follows it", () => {
    const archive = madeArchive([
      { name: "Fonts", children: [{ name: "Geneva", resource: bytesOf("g") }] },
      { name: "after", data: bytesOf("me") },
    ]);

    const { entries } = readArchive(archive);
    expect(entries.map((e) => e.name)).toEqual(["Fonts", "Geneva", "after"]);
    expect(textOf(unpackFork(archive, entries[2]!.data!))).toBe("me");
  });

  it("reads the dates as dates rather than as Macintosh seconds", () => {
    const entry = readArchive(madeArchive([{ name: "a" }])).entries[0]!;
    // 3,000,000,000 seconds after 1904 is in 1999, which is when these were
    // being written; anything reading them as a Unix time lands in 2065.
    expect(new Date(entry.modified).getUTCFullYear()).toBe(1999);
  });
});

describe("what it will not do", () => {
  it("refuses an encrypted fork instead of unpacking noise", () => {
    const archive = madeArchive([
      { name: "secret", resource: bytesOf("scrambled"), encrypted: true },
    ]);
    const entry = readArchive(archive).entries[0]!;

    expect(entry.encrypted).toBe(true);
    expect(() => unpackFork(archive, entry.resource!)).toThrow(/encrypted/);
  });

  it("says which compression method it does not have", () => {
    const archive = madeArchive([{ name: "old", resource: bytesOf("packed somehow") }]);
    // Method 2 is one of StuffIt 1's, which this reader does not carry.
    const entry = readArchive(archive).entries[0]!;
    expect(() => unpackFork(archive, { ...entry.resource!, method: 2 })).toThrow(/method 2/);
  });

  it("notices a fork that does not unpack to the length it claims", () => {
    const archive = madeArchive([{ name: "short", resource: bytesOf("four") }]);
    const entry = readArchive(archive).entries[0]!;
    expect(() => unpackFork(archive, { ...entry.resource!, length: 40 })).toThrow(/40/);
  });
});
