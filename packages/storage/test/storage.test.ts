import { IDENTITY_AFFINE, vec } from "@typewright/geometry";
import {
  setGuides,
  horizontalGuide,
  verticalGuide,
  addGuide,
  setKept,
  type Contour,
  type FontDocument,
  type Glyph,
  addAnchor,
  addContour,
  addGlyphComponent,
  anchor,
  component,
  contour,
  DEFAULT_FONT_INFO,
  counterIds,
  fontDocument,
  renameGlyph,
  removeGlyph,
  glyph,
  node,
  orderedGlyphs,
  setNodePoint,
  updateContour,
  glyphFileName,
  EMPTY_KERNING,
  groupKey,
  kernIndex,
  kernValue,
  putGlyph,
  setKern,
  setKernGroup,
  setKerning,
} from "@typewright/font-model";
import { describe, expect, it, vi } from "vitest";

import { Autosave } from "../src/autosave.js";
import { MemoryFileStore } from "../src/file-store.js";

import {
  FONT_INFO_PATH,
  JOURNAL_PATH,
  KERNING_PATH,
  appendJournal,
  clearJournal,
  dirtyGlyphs,
  glyphPath,
  loadDocument,
  readJournal,
  replaceDocument,
  saveDocument,
} from "../src/project.js";
import {
  SCHEMA_VERSION,
  decodeFontInfo,
  decodeGlyph,
  encodeFontInfo,
  encodeGlyph,
  migrate,
} from "../src/schema.js";

/** The document holds many glyphs now; these tests each work with one. */
const firstGlyph = (d: FontDocument): Glyph => orderedGlyphs(d)[0]!;

function ring(): Contour {
  const ids = counterIds();
  const k = 140;
  return contour(
    ids.contour(),
    [
      node(ids.node(), vec(0, 250), { type: "smooth", in: vec(-k, 250), out: vec(k, 250) }),
      node(ids.node(), vec(250, 0), { type: "smooth", in: vec(250, k), out: vec(250, -k) }),
      node(ids.node(), vec(0, -250), { type: "smooth", in: vec(k, -250), out: vec(-k, -250) }),
      node(ids.node(), vec(-250, 0), { type: "smooth", in: vec(-250, -k), out: vec(-250, k) }),
    ],
    true,
  );
}

function document(): FontDocument {
  return fontDocument([addContour(glyph("o", { unicodes: [0x6f], advance: 600 }), ring())]);
}

describe("serialization", () => {
  it("round-trips a glyph exactly", () => {
    const g = firstGlyph(document());
    const decoded = decodeGlyph(JSON.parse(JSON.stringify(encodeGlyph(g))) as unknown);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value).toEqual(g);
  });

  it("keeps a straight segment straight through a round trip", () => {
    const ids = counterIds("t");
    const line = contour(ids.contour(), [
      node(ids.node(), vec(0, 0)),
      node(ids.node(), vec(100, 0)),
    ]);
    const g = addContour(glyph("hyphen"), line);
    const decoded = decodeGlyph(encodeGlyph(g));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.contours[0]!.nodes[0]!.out).toBeNull();
      expect(decoded.value.contours[0]!.nodes[1]!.in).toBeNull();
    }
  });

  // Points are pairs, not objects — most of a glyph file is coordinates, and a
  // font has thousands of glyphs.
  it("writes points as pairs", () => {
    const encoded = encodeGlyph(firstGlyph(document()));
    expect(encoded.contours[0]!.nodes[0]!.pt).toEqual([0, 250]);
  });

  it("omits hvLock when it is false", () => {
    const encoded = encodeGlyph(firstGlyph(document()));
    expect("hvLock" in encoded.contours[0]!.nodes[0]!).toBe(false);
  });

  it("stamps every file with a schema version", () => {
    expect(encodeGlyph(firstGlyph(document())).schema).toBe(SCHEMA_VERSION);
  });

  it("keeps the anchors, which autosave used to drop on the floor", () => {
    const g = addAnchor(firstGlyph(document()), anchor("k1", "top", vec(300, 700)));
    const decoded = decodeGlyph(JSON.parse(JSON.stringify(encodeGlyph(g))) as unknown);

    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.anchors).toEqual(g.anchors);
  });

  it("keeps the components, transform and all", () => {
    const g = addGlyphComponent(
      firstGlyph(document()),
      component("k2", "acute", { ...IDENTITY_AFFINE, xOffset: 40, yOffset: -10 }),
    );
    const decoded = decodeGlyph(JSON.parse(JSON.stringify(encodeGlyph(g))) as unknown);

    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.components).toEqual(g.components);
  });

  it("reads a glyph written before anchors existed", () => {
    // The field is optional on the way in: a file saved by an older build has
    // no `anchors` key at all, and must still open.
    const encoded = encodeGlyph(firstGlyph(document())) as Record<string, unknown>;
    delete encoded["anchors"];

    const decoded = decodeGlyph(encoded);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.anchors).toEqual([]);
  });
});

describe("what the font carries and this editor does not model", () => {
  // The reader keeps it and the writer puts it back, so autosave has to carry
  // it too: a reload that dropped it would put the loss back exactly where it
  // was taken out, one save to disk later.
  const kept = {
    fontInfo: { openTypeOS2Panose: [2, 11, 5] as const, note: "on a train" },
    lib: { "com.someone.tool": { version: "3" } },
  };

  it("carries a font's kept keys through a save and a load", async () => {
    const store = new MemoryFileStore();
    await saveDocument(store, setKept(document(), kept));

    const result = await loadDocument(store);
    expect(result.kind).toBe("loaded");
    if (result.kind === "loaded") expect(result.document.kept).toEqual(kept);
  });

  it("carries a glyph's kept elements through a round trip", () => {
    const g = glyph("a", { kept: ["	<note>hello</note>"] });
    const decoded = decodeGlyph(JSON.parse(JSON.stringify(encodeGlyph(g))) as unknown);

    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.kept).toEqual(["	<note>hello</note>"]);
  });

  it("writes nothing for a font that has nothing to keep", () => {
    const encoded: Record<string, unknown> = { ...encodeFontInfo(document()) };
    expect("kept" in encoded).toBe(false);
    expect("kept" in { ...encodeGlyph(glyph("a")) }).toBe(false);
  });

  it("carries the font's guides and a glyph's through a save and a load", async () => {
    const store = new MemoryFileStore();
    const guided = setGuides(document(), [horizontalGuide("fg1", 512, "x-height")]);
    const withGlyphGuide = putGlyph(
      guided,
      addGuide(guided.glyphs["o"]!, verticalGuide("gg1", 60, "stem")),
    );
    await saveDocument(store, withGlyphGuide);

    const result = await loadDocument(store);
    expect(result.kind).toBe("loaded");
    if (result.kind !== "loaded") return;

    expect(result.document.guides).toEqual([horizontalGuide("fg1", 512, "x-height")]);
    expect(result.document.glyphs["o"]?.guides).toEqual([verticalGuide("gg1", 60, "stem")]);
  });

  it("writes no guides for a font that has none", () => {
    const encoded: Record<string, unknown> = { ...encodeFontInfo(document()) };
    expect("guides" in encoded).toBe(false);
    expect("guides" in { ...encodeGlyph(glyph("a")) }).toBe(false);
  });

  it("survives a file that says something absurd about it", () => {
    const info = decodeFontInfo({ familyName: "T", kept: "not a record" });
    expect(info.kept).toEqual({ fontInfo: {}, lib: {} });
  });
});

describe("decoding untrusted files", () => {
  // Everything read back is untrusted: corrupt, hand-edited, or from a version
  // that does not exist yet. A reason beats an exception.
  it("reports a reason rather than throwing", () => {
    for (const bad of [null, 42, "text", [], {}]) {
      const decoded = decodeGlyph(bad);
      expect(decoded.ok).toBe(false);
    }
  });

  it("refuses a file with no schema stamp", () => {
    const { schema: _schema, ...unstamped } = encodeGlyph(firstGlyph(document()));
    const decoded = decodeGlyph(unstamped);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.reason).toContain("schema");
  });

  it("refuses a file from a newer build, and says so", () => {
    const future = { ...encodeGlyph(firstGlyph(document())), schema: SCHEMA_VERSION + 5 };
    const decoded = decodeGlyph(future);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.reason).toContain("newer version");
  });

  it("rejects a node with a broken point", () => {
    const encoded = JSON.parse(JSON.stringify(encodeGlyph(firstGlyph(document()))));
    encoded.contours[0].nodes[0].pt = [0, "up"];
    expect(decodeGlyph(encoded).ok).toBe(false);
  });

  it("rejects non-finite coordinates", () => {
    const encoded = JSON.parse(JSON.stringify(encodeGlyph(firstGlyph(document()))));
    encoded.contours[0].nodes[0].pt = [0, null];
    expect(decodeGlyph(encoded).ok).toBe(false);
  });

  it("passes a current-version file through migration untouched", () => {
    const encoded = encodeGlyph(firstGlyph(document()));
    const migrated = migrate(encoded);
    expect(migrated.ok).toBe(true);
  });
});

describe("glyph filenames", () => {
  // A and a are distinct glyphs but the same filename on Windows and macOS.
  it("keeps case-different names apart", () => {
    expect(glyphFileName("A")).not.toBe(glyphFileName("a"));
    expect(glyphFileName("A")).toBe("A_.json");
    expect(glyphFileName("a")).toBe("a.json");
  });

  it("marks every uppercase letter, not just the first", () => {
    expect(glyphFileName("ABC")).toBe("A_B_C_.json");
  });

  it("leaves ordinary lowercase names readable", () => {
    expect(glyphFileName("adieresis")).toBe("adieresis.json");
    expect(glyphFileName("a.alt")).toBe("a.alt.json");
  });

  it("escapes characters a filesystem will not take", () => {
    expect(glyphFileName("a/b")).toBe("a%2Fb.json");
    expect(glyphFileName("a:b")).toBe("a%3Ab.json");
    expect(glyphFileName("a*b")).toBe("a%2Ab.json");
  });

  // Windows still cannot create a file called nul, forty years on.
  it("sidesteps reserved device names", () => {
    expect(glyphFileName("nul")).toBe("_nul.json");
    expect(glyphFileName("com1")).toBe("_com1.json");
  });

  it("truncates a very long name without letting two collide", () => {
    const a = glyphFileName("x".repeat(400));
    const b = glyphFileName(`${"x".repeat(399)}y`);
    expect(a.length).toBeLessThan(230);
    expect(a).not.toBe(b);
  });
});

describe("saving and loading", () => {
  it("writes one file per glyph, plus an index", async () => {
    const store = new MemoryFileStore();
    await saveDocument(store, document());

    expect(store.has(glyphPath("o"))).toBe(true);
    expect(store.has("fontinfo.json")).toBe(true);
    expect(glyphPath("o")).toBe("glyphs/o.json");
  });

  it("reads a project back to an equal document", async () => {
    const store = new MemoryFileStore();
    const original = document();
    await saveDocument(store, original);

    const result = await loadDocument(store);
    expect(result.kind).toBe("loaded");
    if (result.kind === "loaded") {
      expect(result.document).toEqual(original);
      expect(result.recovered).toBe(false);
      expect(result.problems).toEqual([]);
    }
  });

  it("reports an empty store rather than inventing a document", async () => {
    expect((await loadDocument(new MemoryFileStore())).kind).toBe("empty");
  });

  // Losing one glyph to a corrupt file is bad. Losing the project because one
  // glyph is corrupt is worse.
  it("skips a corrupt glyph and keeps the rest", async () => {
    const store = new MemoryFileStore();
    await saveDocument(store, document());
    await store.write("glyphs/broken.json", "{ this is not json");

    const result = await loadDocument(store);
    expect(result.kind).toBe("loaded");
    if (result.kind === "loaded") {
      expect(firstGlyph(result.document).name).toBe("o");
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]).toContain("broken.json");
    }
  });

  it("writes nothing when nothing changed", async () => {
    const store = new MemoryFileStore();
    const doc = document();
    await saveDocument(store, doc);
    store.clearWrites();

    await saveDocument(store, doc, doc);
    expect(store.writes).toEqual([]);
  });

  it("writes the glyph that changed", async () => {
    const store = new MemoryFileStore();
    const before = document();
    await saveDocument(store, before);
    store.clearWrites();

    const moved = updateContour(firstGlyph(before), firstGlyph(before).contours[0]!.id, (c) =>
      setNodePoint(c, c.nodes[0]!.id, vec(0, 300)),
    )!;
    await saveDocument(store, fontDocument([moved]), before);
    expect(store.writes).toContain(glyphPath("o"));
  });
});

describe("dirtyGlyphs", () => {
  // Reference comparison is exact here, not approximate: the model is
  // persistent, so an untouched glyph is the very same object.
  it("finds nothing when the document is unchanged", () => {
    const doc = document();
    expect(dirtyGlyphs(doc, doc)).toEqual([]);
  });

  it("finds the glyph after an edit", () => {
    const before = document();
    const moved = fontDocument([
      updateContour(firstGlyph(before), firstGlyph(before).contours[0]!.id, (c) =>
        setNodePoint(c, c.nodes[0]!.id, vec(0, 300)),
      )!,
    ]);
    expect(dirtyGlyphs(before, moved)).toHaveLength(1);
  });

  it("treats a first save as everything", () => {
    expect(dirtyGlyphs(null, document())).toHaveLength(1);
  });
});

describe("the journal", () => {
  it("appends records and reads them back in order", async () => {
    const store = new MemoryFileStore();
    await appendJournal(store, firstGlyph(document()), 100);
    await appendJournal(store, firstGlyph(document()), 200);

    const records = await readJournal(store);
    expect(records).toHaveLength(2);
    expect(records[0]!.at).toBe(100);
    expect(records[1]!.at).toBe(200);
  });

  // The expected failure: the tab died mid-append. Losing that one record is
  // right; refusing to read the rest would throw away what the journal existed
  // for.
  it("keeps every whole record when the last line is truncated", async () => {
    const store = new MemoryFileStore();
    await appendJournal(store, firstGlyph(document()), 100);
    await store.append(JOURNAL_PATH, '{"at":200,"glyph":{"sche');

    expect(await readJournal(store)).toHaveLength(1);
  });

  it("applies journal records over the saved files on load", async () => {
    const store = new MemoryFileStore();
    const saved = document();
    await saveDocument(store, saved);

    const newer = updateContour(firstGlyph(saved), firstGlyph(saved).contours[0]!.id, (c) =>
      setNodePoint(c, c.nodes[0]!.id, vec(0, 999)),
    )!;
    await appendJournal(store, newer, 5000);

    const result = await loadDocument(store);
    expect(result.kind).toBe("loaded");
    if (result.kind === "loaded") {
      expect(result.recovered).toBe(true);
      expect(firstGlyph(result.document).contours[0]!.nodes[0]!.pt).toEqual(vec(0, 999));
    }
  });

  it("is empty once cleared", async () => {
    const store = new MemoryFileStore();
    await appendJournal(store, firstGlyph(document()), 100);
    await clearJournal(store);
    expect(await readJournal(store)).toEqual([]);
  });
});

describe("autosave", () => {
  function harness(debounceMs = 1000, saveImpl: () => Promise<void> = async () => {}) {
    const timer: { fire: (() => void) | null } = { fire: null };
    const journal = vi.fn(async () => {});
    const save = vi.fn(saveImpl);
    const failed = vi.fn();

    const autosave = new Autosave(
      { journal, save, failed },
      {
        debounceMs,
        setTimer: (fn) => {
          timer.fire = fn;
          return 1;
        },
        clearTimer: () => {
          timer.fire = null;
        },
      },
    );

    return { autosave, journal, save, failed, tick: () => timer.fire?.() };
  }

  /** Let the microtask queue drain, so an async save has actually landed. */
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it("journals immediately and saves after the quiet period", async () => {
    const { autosave, journal, save, tick } = harness();
    autosave.commit(document());

    expect(journal).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(autosave.status).toBe("pending");

    tick();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  // The whole point of debouncing: a burst of edits is one round of writes.
  it("collapses a burst into a single save", async () => {
    const { autosave, journal, save, tick } = harness();
    let doc = document();
    for (let i = 0; i < 4; i++) {
      doc = fontDocument([
        updateContour(firstGlyph(doc), firstGlyph(doc).contours[0]!.id, (c) =>
          setNodePoint(c, c.nodes[0]!.id, vec(0, 250 + i)),
        )!,
      ]);
      autosave.commit(doc);
    }

    expect(journal).toHaveBeenCalledTimes(4);
    tick();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("ignores a commit that changed nothing", () => {
    const { autosave, journal } = harness();
    const doc = document();
    autosave.markSaved(doc);
    autosave.commit(doc);
    expect(journal).not.toHaveBeenCalled();
    expect(autosave.dirty).toBe(false);
  });

  it("knows when there is unwritten work", async () => {
    const { autosave, tick } = harness();
    autosave.commit(document());
    expect(autosave.dirty).toBe(true);

    tick();
    await settle();
    expect(autosave.dirty).toBe(false);
  });

  it("flushes on demand without waiting", async () => {
    const { autosave, save } = harness();
    autosave.commit(document());
    await autosave.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  // Autosave must never take the app down with it.
  it("reports a failed save instead of throwing", async () => {
    const { autosave, failed, tick } = harness(1000, async () => {
      throw new Error("disk full");
    });

    autosave.commit(document());
    tick();
    await settle();

    expect(failed).toHaveBeenCalled();
    expect(autosave.status).toBe("failed");
  });

  it("does not re-save a document that came straight off disk", () => {
    const { autosave, journal } = harness();
    const loaded = document();
    autosave.markLoaded(loaded, false);
    autosave.commit(loaded);
    expect(journal).not.toHaveBeenCalled();
    expect(autosave.dirty).toBe(false);
  });

  // Two ways to be unwritten, both of which leave disk behind for good if
  // adopted as saved: recovered from the journal, and a starter document shown
  // because the store was empty.
  it("treats an unwritten document as needing a save", async () => {
    const { autosave, save } = harness();
    autosave.markLoaded(document(), true);

    expect(autosave.dirty).toBe(true);
    expect(autosave.status).toBe("pending");

    await autosave.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.dirty).toBe(false);
  });

  it("writes every glyph of a starter font, not just one that gets touched", async () => {
    const store = new MemoryFileStore();
    const starter = fontDocument([
      addContour(glyph("o", { unicodes: [0x6f] }), ring()),
      glyph("l", { unicodes: [0x6c] }),
      glyph("e", { unicodes: [0x65] }),
    ]);

    // Nothing is on disk, so everything is dirty.
    expect(dirtyGlyphs(null, starter)).toHaveLength(3);
    await saveDocument(store, starter, null);

    expect(store.has(glyphPath("o"))).toBe(true);
    expect(store.has(glyphPath("l"))).toBe(true);
    expect(store.has(glyphPath("e"))).toBe(true);
  });
});

describe("replaceDocument", () => {
  const font = (names: string[]) =>
    fontDocument(
      names.map((n) => glyph(n, { advance: 500 })),
      DEFAULT_FONT_INFO,
    );

  it("writes every glyph and the font info", async () => {
    const store = new MemoryFileStore();
    const report = await replaceDocument(store, font(["A", "B", "C"]));

    expect(report.written).toBe(3);
    expect(store.has(glyphPath("A"))).toBe(true);
    expect(store.has(glyphPath("C"))).toBe(true);
    expect(store.has(FONT_INFO_PATH)).toBe(true);
  });

  it("removes glyphs belonging to the font it replaced", async () => {
    const store = new MemoryFileStore();
    await replaceDocument(store, font(["A", "B", "C"]));
    const report = await replaceDocument(store, font(["A", "X"]));

    expect(report.removed).toBe(2);
    expect(store.has(glyphPath("A"))).toBe(true);
    expect(store.has(glyphPath("X"))).toBe(true);
    expect(store.has(glyphPath("B"))).toBe(false);
    expect(store.has(glyphPath("C"))).toBe(false);
  });

  it("leaves nothing of the old font that a load could pick up", async () => {
    const store = new MemoryFileStore();
    await replaceDocument(store, font(["A", "B"]));
    await replaceDocument(store, font(["Z"]));

    const loaded = await loadDocument(store);
    expect(loaded.kind === "loaded" ? loaded.document.glyphOrder : null).toEqual(["Z"]);
  });

  it("drops a journal that describes the superseded document", async () => {
    const store = new MemoryFileStore();
    await appendJournal(store, glyph("A", { advance: 1 }), 1);
    expect(await readJournal(store)).toHaveLength(1);

    await replaceDocument(store, font(["Z"]));
    expect(await readJournal(store)).toHaveLength(0);
  });

  it("keeps the font's own glyph order rather than sorting it", async () => {
    const store = new MemoryFileStore();
    await replaceDocument(store, font(["zeta", "alpha", "mu"]));

    const loaded = await loadDocument(store);
    expect(loaded.kind === "loaded" ? loaded.document.glyphOrder : null).toEqual([
      "zeta",
      "alpha",
      "mu",
    ]);
  });
});

describe("abandoning a save when the project is replaced", () => {
  const doc = (names: string[]) =>
    fontDocument(
      names.map((n) => glyph(n, { advance: 500 })),
      DEFAULT_FONT_INFO,
    );

  /** An autosave whose save blocks until released, like a slow worker call. */
  function blockingAutosave(): {
    autosave: Autosave;
    written: string[][];
    release: () => void;
  } {
    const written: string[][] = [];
    let release: () => void = () => {};
    const autosave = new Autosave(
      {
        journal: async () => {},
        save: async (document) => {
          written.push([...document.glyphOrder]);
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      },
      {
        debounceMs: 0,
        setTimer: (fn) => {
          fn();
          return 0;
        },
        clearTimer: () => {},
      },
    );
    return { autosave, written, release: () => release() };
  }

  it("waits for an in-flight save, so it cannot land after the replacement", async () => {
    const { autosave, written, release } = blockingAutosave();

    autosave.markSaved(doc([]));
    autosave.commit(doc(["A", "B", "C"])); // begins a save, then blocks

    let finished = false;
    const abandoned = autosave.abandon().then(() => {
      finished = true;
    });

    // Still running, so abandon has not resolved: the caller must not start
    // replacing files while a write of the old font is in the air.
    await new Promise((r) => setTimeout(r, 0));
    expect(finished).toBe(false);

    release();
    await abandoned;
    expect(finished).toBe(true);
    expect(written).toEqual([["A", "B", "C"]]);
  });

  it("drops a scheduled save that has not started", async () => {
    const written: string[][] = [];
    let fire: (() => void) | null = null;
    const autosave = new Autosave(
      { journal: async () => {}, save: async (d) => void written.push([...d.glyphOrder]) },
      {
        debounceMs: 1000,
        setTimer: (fn) => {
          fire = fn;
          return 1;
        },
        clearTimer: () => {
          fire = null;
        },
      },
    );

    autosave.markSaved(doc([]));
    autosave.commit(doc(["A", "B", "C"]));
    expect(fire).not.toBeNull();

    await autosave.abandon();
    expect(fire).toBeNull();

    // Nothing queued, so a later flush writes nothing of the old font.
    await autosave.flush();
    expect(written).toEqual([]);
  });

  it("adopts the replacement cleanly, and the next edit measures against it", async () => {
    const written: string[][] = [];
    const autosave = new Autosave(
      { journal: async () => {}, save: async (d) => void written.push([...d.glyphOrder]) },
      {
        debounceMs: 0,
        setTimer: (fn) => {
          fn();
          return 0;
        },
        clearTimer: () => {},
      },
    );

    autosave.markSaved(doc(["A", "B", "C"]));
    await autosave.abandon();

    const replacement = doc([".notdef"]);
    autosave.markLoaded(replacement, false);
    expect(autosave.dirty).toBe(false);

    // An edit after the replacement writes the new font, never the old one.
    const edited = doc([".notdef", "X"]);
    autosave.commit(edited);
    await autosave.flush();
    expect(written).toEqual([[".notdef", "X"]]);
  });
});

describe("kerning on disk", () => {
  const kerned = () => {
    let k = setKernGroup(EMPTY_KERNING, "first", "O", ["O", "Q"]);
    k = setKernGroup(k, "second", "A", ["A"]);
    k = setKern(k, groupKey("O"), groupKey("A"), -40);
    k = setKern(k, "T", "A", -95);
    return setKerning(fontDocument([glyph("O", { advance: 500 })], DEFAULT_FONT_INFO), k);
  };

  it("survives a save and load", async () => {
    const store = new MemoryFileStore();
    await replaceDocument(store, kerned());

    const loaded = await loadDocument(store);
    const back = loaded.kind === "loaded" ? loaded.document.kerning : null;
    expect(back).not.toBeNull();
    expect(kernValue(kernIndex(back!), "Q", "A")).toBe(-40);
    expect(kernValue(kernIndex(back!), "T", "A")).toBe(-95);
  });

  it("goes in its own file, as it does in a UFO", async () => {
    const store = new MemoryFileStore();
    await replaceDocument(store, kerned());
    expect(store.has(KERNING_PATH)).toBe(true);
  });

  it("is written by an incremental save only when it changed", async () => {
    const store = new MemoryFileStore();
    const document = kerned();
    await saveDocument(store, document, null);

    const before = store.snapshot()[KERNING_PATH];
    // An edit that leaves kerning alone must not rewrite the table.
    const moved = putGlyph(document, glyph("O", { advance: 600 }));
    await saveDocument(store, moved, document);
    expect(store.snapshot()[KERNING_PATH]).toBe(before);

    const rekerned = setKerning(moved, setKern(moved.kerning, "T", "A", -50));
    await saveDocument(store, rekerned, moved);
    expect(store.snapshot()[KERNING_PATH]).not.toBe(before);
  });

  it("loads a project written before kerning existed", async () => {
    const store = new MemoryFileStore();
    await replaceDocument(store, fontDocument([glyph("A", { advance: 500 })], DEFAULT_FONT_INFO));
    await store.remove(KERNING_PATH);

    const loaded = await loadDocument(store);
    expect(loaded.kind).toBe("loaded");
    expect(loaded.kind === "loaded" ? loaded.document.kerning : null).toEqual(EMPTY_KERNING);
  });

  it("drops a malformed pair rather than failing the load", async () => {
    const store = new MemoryFileStore();
    await replaceDocument(store, kerned());
    await store.write(
      KERNING_PATH,
      JSON.stringify({ pairs: { T: { A: "not a number", V: -20 } }, firstGroups: 7 }),
    );

    const loaded = await loadDocument(store);
    const back = loaded.kind === "loaded" ? loaded.document.kerning : null;
    expect(kernValue(kernIndex(back!), "T", "V")).toBe(-20);
    expect(kernValue(kernIndex(back!), "T", "A")).toBe(0);
  });
});

describe("a glyph that is no longer in the font", () => {
  /** Two glyphs, so one can go and leave the other behind. */
  const pair = () =>
    fontDocument([firstGlyph(document()), glyph("v", { unicodes: [0x76], advance: 480 })]);

  it("has its file removed, not merely dropped from the index", async () => {
    const store = new MemoryFileStore();
    const before = pair();
    await saveDocument(store, before);

    await saveDocument(store, removeGlyph(before, "v")!, before);
    expect(store.has(glyphPath("v"))).toBe(false);
  });

  it("stays gone after a reload", async () => {
    // The whole point. `loadDocument` reads every file in the directory and
    // appends any the index does not mention, so a file left behind is a glyph
    // that comes back — silently, at the end of an order that never named it.
    const store = new MemoryFileStore();
    const before = pair();
    await saveDocument(store, before);
    await saveDocument(store, removeGlyph(before, "v")!, before);

    const result = await loadDocument(store);
    expect(result.kind).toBe("loaded");
    if (result.kind === "loaded") {
      expect(result.document.glyphOrder).toEqual(["o"]);
      expect(result.document.glyphs["v"]).toBeUndefined();
    }
  });

  it("takes the old file with it when a glyph is renamed", async () => {
    const store = new MemoryFileStore();
    const before = pair();
    await saveDocument(store, before);

    const after = renameGlyph(before, "v", "vee")!;
    await saveDocument(store, after, before);

    expect(store.has(glyphPath("vee"))).toBe(true);
    expect(store.has(glyphPath("v"))).toBe(false);
  });

  it("does not bring the old name back on the next load", async () => {
    const store = new MemoryFileStore();
    const before = pair();
    await saveDocument(store, before);
    await saveDocument(store, renameGlyph(before, "v", "vee")!, before);

    const result = await loadDocument(store);
    if (result.kind !== "loaded") throw new Error("expected a document");
    expect(result.document.glyphOrder).toEqual(["o", "vee"]);
  });
});
