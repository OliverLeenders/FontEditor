import { describe, expect, it } from "vitest";

import { readResourceFork, resourcesOfType } from "../src/resource-fork.js";
import { madeFork } from "../src/testing.js";

const bytesOf = (text: string): Uint8Array =>
  Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

const textOf = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

describe("a resource fork", () => {
  it("reads a resource with its type, number and name", () => {
    const fork = readResourceFork(
      madeFork([{ type: "FOND", id: 2017, name: "Chicago", bytes: bytesOf("family") }]),
    );

    expect(fork.resources).toHaveLength(1);
    const resource = fork.resources[0]!;
    expect(resource.type).toBe("FOND");
    expect(resource.id).toBe(2017);
    expect(resource.name).toBe("Chicago");
    expect(textOf(resource.bytes)).toBe("family");
  });

  it("reads several types, and several of one type", () => {
    const fork = readResourceFork(
      madeFork([
        { type: "FOND", id: 128, bytes: bytesOf("f") },
        { type: "NFNT", id: 129, bytes: bytesOf("nine") },
        { type: "NFNT", id: 130, bytes: bytesOf("twelve") },
        { type: "ICN#", id: -16455, bytes: bytesOf("icon") },
      ]),
    );

    expect(fork.resources).toHaveLength(4);
    expect(resourcesOfType(fork, "NFNT").map((r) => r.id)).toEqual([129, 130]);
    expect(resourcesOfType(fork, "sfnt")).toEqual([]);
  });

  it("keeps a negative resource number, which icons have", () => {
    const fork = readResourceFork(madeFork([{ type: "ICN#", id: -16455, bytes: bytesOf("i") }]));
    expect(fork.resources[0]!.id).toBe(-16455);
  });

  it("gives an unnamed resource an empty name rather than a made-up one", () => {
    const fork = readResourceFork(madeFork([{ type: "kvst", id: 128, bytes: bytesOf("x") }]));
    expect(fork.resources[0]!.name).toBe("");
  });

  it("reads a resource of no length at all", () => {
    const fork = readResourceFork(madeFork([{ type: "STR ", id: 1, bytes: new Uint8Array(0) }]));
    expect(fork.resources[0]!.bytes).toHaveLength(0);
  });

  it("refuses a fork too short to hold its own header", () => {
    expect(() => readResourceFork(new Uint8Array(8))).toThrow(/at least its header/);
  });

  it("refuses a fork whose map is not there", () => {
    const fork = madeFork([{ type: "FOND", id: 1, bytes: bytesOf("f") }]);
    expect(() => readResourceFork(fork.subarray(0, 300))).toThrow(/past the end/);
  });
});
