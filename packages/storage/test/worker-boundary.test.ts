import {
  EMPTY_KERNING,
  addContour,
  contour,
  counterIds,
  fontDocument,
  glyph,
  groupKey,
  kernIndex,
  kernValue,
  node,
  removeGlyph,
  setFeatures,
  setKern,
  setKernGroup,
  setKerning,
} from "@fonteditor/font-model";
import { describe, expect, it } from "vitest";

import { StorageClient } from "../src/client.js";
import { dirtyGlyphs, glyphPath, removedGlyphs } from "../src/project.js";
import { FakeWorker } from "./fake-worker.js";

const ids = counterIds("w");
const at = (x: number, y: number) => ({ x, y });

const square = () =>
  contour(
    ids.contour(),
    [node(ids.node(), at(0, 0)), node(ids.node(), at(400, 0)), node(ids.node(), at(400, 400))],
    true,
  );

const document = () =>
  fontDocument([
    addContour(glyph("o", { unicodes: [0x6f], advance: 600 }), square()),
    glyph("v", { unicodes: [0x76], advance: 480 }),
  ]);

/** A client wired to a worker that really handles the requests. */
async function open(): Promise<{ client: StorageClient; worker: FakeWorker }> {
  const worker = new FakeWorker();
  const client = new StorageClient(worker as unknown as Worker);
  await client.open("project");
  return { client, worker };
}

describe("the client and the worker together", () => {
  it("writes a document and reads it back equal", async () => {
    const { client } = await open();
    const before = document();

    await client.replaceAll(before);
    const loaded = await client.load();

    expect(loaded.kind).toBe("loaded");
    if (loaded.kind === "loaded") expect(loaded.document).toEqual(before);
  });

  it("reports an empty project rather than inventing one", async () => {
    const { client } = await open();
    expect((await client.load()).kind).toBe("empty");
  });

  it("saves only the glyphs that changed", async () => {
    const { client, worker } = await open();
    const before = document();
    await client.replaceAll(before);

    const moved = { ...before.glyphs["v"]!, advance: 500 };
    const after = { ...before, glyphs: { ...before.glyphs, v: moved } };

    worker.requests.length = 0;
    await client.saveGlyphs(dirtyGlyphs(before, after));

    const sent = worker.requests[0];
    expect(sent?.kind).toBe("saveGlyphs");
    if (sent?.kind === "saveGlyphs") expect(sent.glyphs.map((g) => g.name)).toEqual(["v"]);
  });

  it("sends nothing at all when nothing changed", async () => {
    const { client, worker } = await open();
    const before = document();
    await client.replaceAll(before);

    worker.requests.length = 0;
    await client.saveGlyphs(dirtyGlyphs(before, before));
    expect(worker.requests).toEqual([]);
  });
});

describe("deleting a glyph", () => {
  it("removes the file, so it does not come back on the next load", async () => {
    // The bug this pair had: nothing ever deleted a glyph file, and the loader
    // reads every file in the directory and appends the ones the index does not
    // mention. A deleted glyph returned at the end of an order that never
    // named it.
    const { client, worker } = await open();
    const before = document();
    await client.replaceAll(before);

    const after = removeGlyph(before, "v")!;
    await client.saveGlyphs(dirtyGlyphs(before, after));
    await client.removeGlyphs(removedGlyphs(before, after));
    await client.saveFontInfo(after);

    expect(worker.store.has(glyphPath("v"))).toBe(false);

    const loaded = await client.load();
    if (loaded.kind !== "loaded") throw new Error("expected a document");
    expect(loaded.document.glyphOrder).toEqual(["o"]);
  });

  it("takes the old file when a glyph is renamed", async () => {
    const { client, worker } = await open();
    const before = document();
    await client.replaceAll(before);

    const renamed = { ...before.glyphs["v"]!, name: "vee" };
    const after = {
      ...before,
      glyphOrder: ["o", "vee"],
      glyphs: { o: before.glyphs["o"]!, vee: renamed },
    };

    await client.saveGlyphs(dirtyGlyphs(before, after));
    await client.removeGlyphs(removedGlyphs(before, after));
    await client.saveFontInfo(after);

    expect(worker.store.has(glyphPath("vee"))).toBe(true);
    expect(worker.store.has(glyphPath("v"))).toBe(false);
  });

  it("does not mind being asked to remove nothing", async () => {
    const { client, worker } = await open();
    worker.requests.length = 0;
    await client.removeGlyphs([]);
    expect(worker.requests).toEqual([]);
  });

  it("does not mind removing a file that is already gone", async () => {
    // Asking twice leaves the same state either way, and failing a save over it
    // would be worse than doing nothing.
    const { client } = await open();
    await client.replaceAll(document());
    await client.removeGlyphs(["v"]);
    await expect(client.removeGlyphs(["v"])).resolves.toBeDefined();
  });
});

describe("replacing the whole project", () => {
  it("clears out the font being replaced", async () => {
    const { client, worker } = await open();
    await client.replaceAll(document());

    const other = fontDocument([glyph("a", { unicodes: [0x61], advance: 500 })]);
    await client.replaceAll(other);

    expect(worker.store.has(glyphPath("o"))).toBe(false);
    const loaded = await client.load();
    if (loaded.kind !== "loaded") throw new Error("expected a document");
    expect(loaded.document.glyphOrder).toEqual(["a"]);
  });

  it("keeps the order the font was given rather than reordering it", async () => {
    const { client } = await open();
    const ordered = fontDocument([
      glyph("z", { advance: 500 }),
      glyph("a", { advance: 500 }),
      glyph("m", { advance: 500 }),
    ]);
    await client.replaceAll(ordered);

    const loaded = await client.load();
    if (loaded.kind !== "loaded") throw new Error("expected a document");
    expect(loaded.document.glyphOrder).toEqual(["z", "a", "m"]);
  });

  it("carries the feature source across", async () => {
    // The same bug as the kerning below, and found by the same test: the message
    // carried the glyphs and the metrics, and `replaceDocument` writes every
    // file the project has — so anything left out of the message was written
    // over as empty.
    const { client } = await open();
    const text = ["feature liga {", "    sub o v by o;", "} liga;", ""].join(String.fromCharCode(10));
    await client.replaceAll(setFeatures(document(), text));

    const loaded = await client.load();
    if (loaded.kind !== "loaded") throw new Error("expected a document");
    expect(loaded.document.features).toBe(text);
  });

  it("carries the kerning across", async () => {
    const { client } = await open();
    let k = setKernGroup(EMPTY_KERNING, "first", "O", ["o"]);
    k = setKern(k, groupKey("O"), "v", -42);
    await client.replaceAll(setKerning(document(), k));

    const loaded = await client.load();
    if (loaded.kind !== "loaded") throw new Error("expected a document");
    expect(kernValue(kernIndex(loaded.document.kerning), "o", "v")).toBe(-42);
  });
});

describe("every field the document carries", () => {
  /**
   * The one test that will catch the next field to be forgotten.
   *
   * A document is taken apart and put back together in three places along this
   * path — the worker for `replaceAll`, the project for a load from disk, and
   * the client for a load across the wire. Each is a place where a field added
   * to the model gets left behind, and both kerning and the feature source were
   * lost in exactly that way. Comparing whole documents rather than named fields
   * is what makes this test outlive the fields it was written for.
   */
  it("survives a write and a read unchanged, whatever it holds", async () => {
    const { client } = await open();

    let k = setKernGroup(EMPTY_KERNING, "first", "O", ["o"]);
    k = setKernGroup(k, "second", "V", ["v"]);
    k = setKern(k, groupKey("O"), groupKey("V"), -55);
    const full = setFeatures(
      setKerning(document(), k),
      ["feature liga {", "    sub o v by o;", "} liga;", ""].join(String.fromCharCode(10)),
    );

    await client.replaceAll(full);
    const loaded = await client.load();

    if (loaded.kind !== "loaded") throw new Error("expected a document");
    expect(loaded.document).toEqual(full);
  });
});

describe("the journal", () => {
  it("brings back work that was never saved", async () => {
    const { client } = await open();
    const before = document();
    await client.replaceAll(before);

    // Journalled but not saved, which is what a crash mid-edit leaves behind.
    const moved = { ...before.glyphs["o"]!, advance: 999 };
    await client.journal(moved, 1);

    const loaded = await client.load();
    if (loaded.kind !== "loaded") throw new Error("expected a document");
    expect(loaded.document.glyphs["o"]?.advance).toBe(999);
    expect(loaded.recovered).toBe(true);
  });

  it("stops bringing it back once it is cleared", async () => {
    const { client } = await open();
    await client.replaceAll(document());
    await client.journal({ ...document().glyphs["o"]!, advance: 999 }, 1);
    await client.clearJournal();

    const loaded = await client.load();
    if (loaded.kind !== "loaded") throw new Error("expected a document");
    expect(loaded.document.glyphs["o"]?.advance).toBe(600);
    expect(loaded.recovered).toBe(false);
  });
});

describe("the conversation itself", () => {
  it("matches each reply to the request that asked for it", async () => {
    // The client keys promises by id. Replies arriving out of order is not a
    // hypothetical: a large write and a small one are answered when they finish,
    // not in the order they were sent.
    const { client, worker } = await open();
    await client.replaceAll(document());

    worker.paused = true;
    const first = client.load();
    const second = client.saveFontInfo(document());
    await Promise.resolve();
    worker.flushReversed();

    await expect(first).resolves.toBeDefined();
    await expect(second).resolves.toBeUndefined();
  });

  it("rejects the caller when the worker refuses", async () => {
    const { client } = await open();
    // A glyph that cannot be decoded on the way in is refused rather than
    // written, so the bad copy never reaches disk.
    await expect(
      client.saveGlyphs([{ ...glyph("bad", { advance: 1 }), contours: [null] } as never]),
    ).rejects.toThrow();
  });

  it("says what went wrong rather than that something did", async () => {
    const worker = new FakeWorker();
    const client = new StorageClient(worker as unknown as Worker);
    // Every request but `open` needs a store, and saying so is the whole message.
    await expect(client.load()).rejects.toThrow(/not been opened/);
  });

  it("fails everything outstanding when the worker dies", async () => {
    // A dead worker never replies, so anything waiting would hang for ever.
    const { client, worker } = await open();
    worker.paused = true;
    const pending = client.load();
    worker.fail("out of memory");

    await expect(pending).rejects.toThrow(/out of memory/);
  });

  it("ignores a reply for a request it is not waiting on", async () => {
    // A late reply after a rejection, or a duplicate, must not throw.
    const { client, worker } = await open();
    await client.load();
    expect(() => {
      worker.postMessage({ id: 9999, kind: "clearJournal" });
    }).not.toThrow();
  });
});
