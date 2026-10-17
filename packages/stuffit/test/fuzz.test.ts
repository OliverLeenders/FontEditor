import fc from "fast-check";
import { describe, it } from "vitest";

import { readArchive, unpackFork } from "../src/archive.js";
import { arsenic } from "../src/arsenic.js";
import { method13 } from "../src/method13.js";
import { readResourceFork, resourcesOfType } from "../src/resource-fork.js";
import { madeArchive, madeFork } from "../src/testing.js";
import { CHECK, answersOrSaysWhy, anyBytes, spoiled } from "./fuzz-rule.js";

/**
 * The containers old Macintosh fonts come in, handed anything at all.
 *
 * A StuffIt archive and a resource fork are offsets and counts from start to
 * end, and an archive's forks are compressed: every one of those is a place a
 * file can point past its own end, claim a million entries, or loop. Each is
 * tried with bytes at random, and with good files spoiled a little — most of
 * a file has to be right for a reader to get far enough to go wrong.
 */

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

const forks = [
  madeFork([{ type: "FOND", id: 2017, name: "Chicago", bytes: bytesOf("family") }]),
  madeFork([
    { type: "FOND", id: 128, bytes: bytesOf("f") },
    { type: "NFNT", id: 129, bytes: bytesOf("nine") },
    { type: "NFNT", id: 130, name: "Twelve", bytes: bytesOf("twelve") },
  ]),
];

const archives = [
  madeArchive([{ name: "a" }]),
  madeArchive([
    { name: "Chicago", type: "FFIL", creator: "DMOV", resource: forks[1]!, data: bytesOf("d") },
    {
      name: "Fonts",
      children: [
        { name: "Geneva", type: "FFIL", resource: forks[0]! },
        { name: "Locked", encrypted: true, data: bytesOf("secret") },
      ],
    },
  ]),
];

/** An archive read, and every fork in it unpacked, as somebody opening it would. */
function openArchive(bytes: Uint8Array): void {
  const archive = readArchive(bytes);
  for (const entry of archive.entries) {
    for (const fork of [entry.resource, entry.data]) {
      if (fork !== undefined && fork !== null) unpackFork(bytes, fork);
    }
  }
}

/** A fork read, and every resource in it asked for by its type. */
function openFork(bytes: Uint8Array): void {
  const fork = readResourceFork(bytes);
  for (const type of new Set(fork.resources.map((r) => r.type))) resourcesOfType(fork, type);
}

describe("a StuffIt archive, whatever is in it", () => {
  it("is read, or said why not, given bytes at random", () => {
    fc.assert(
      fc.property(anyBytes, (bytes) => answersOrSaysWhy(() => openArchive(bytes))),
      CHECK,
    );
  });

  it("is read, or said why not, given a good archive spoiled", () => {
    fc.assert(
      fc.property(spoiled(archives), (bytes) => answersOrSaysWhy(() => openArchive(bytes))),
      CHECK,
    );
  });
});

describe("a resource fork, whatever is in it", () => {
  it("is read, or said why not, given bytes at random", () => {
    fc.assert(
      fc.property(anyBytes, (bytes) => answersOrSaysWhy(() => openFork(bytes))),
      CHECK,
    );
  });

  it("is read, or said why not, given a good fork spoiled", () => {
    fc.assert(
      fc.property(spoiled(forks), (bytes) => answersOrSaysWhy(() => openFork(bytes))),
      CHECK,
    );
  });
});

describe("a compressed fork, whatever is in it", () => {
  const length = fc.nat({ max: 4096 });

  it("is unpacked by method 13, or said why not", () => {
    fc.assert(
      fc.property(anyBytes, length, (bytes, n) => answersOrSaysWhy(() => method13(bytes, n))),
      CHECK,
    );
  });

  it("is unpacked by Arsenic, or said why not", () => {
    // Most bytes at random are not Arsenic at all, and are said so at once;
    // these begin as it does, to get further in.
    const begun = anyBytes.map((bytes) => Uint8Array.from([0x41, 0x73, ...bytes]));
    fc.assert(
      fc.property(fc.oneof(anyBytes, begun), length, (bytes, n) =>
        answersOrSaysWhy(() => arsenic(bytes, n)),
      ),
      CHECK,
    );
  });
});
