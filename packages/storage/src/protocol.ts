import type { StoredLayer } from "./layers.js";
import type { StoredKerning, StoredFontInfo, StoredGlyph } from "./schema.js";
import type { StoredSnapshot } from "./snapshots.js";

/**
 * What the main thread and the storage worker say to each other.
 *
 * Only plain data crosses — no model objects, no handles. Everything the worker
 * receives is already-encoded stored form, and everything it sends back is
 * either stored form or a plain report, so `structuredClone` handles it and
 * neither side needs the other's types at runtime.
 *
 * Every request carries an id and gets exactly one reply, which is what lets the
 * client hand back a promise per call.
 */
export type StorageRequest =
  | { readonly id: number; readonly kind: "open"; readonly directory: string }
  | { readonly id: number; readonly kind: "load" }
  | { readonly id: number; readonly kind: "saveGlyphs"; readonly glyphs: readonly StoredGlyph[] }
  | {
      /**
       * Delete glyph files by name.
       *
       * A separate message rather than something `saveGlyphs` infers, because a
       * save is told what a document *has* and could never work out from that
       * what it no longer has.
       */
      readonly id: number;
      readonly kind: "removeGlyphs";
      readonly names: readonly string[];
    }
  | { readonly id: number; readonly kind: "saveFontInfo"; readonly info: StoredFontInfo }
  | { readonly id: number; readonly kind: "saveKerning"; readonly kerning: StoredKerning }
  /**
   * Replace the whole project in one round trip. What an import sends: writing
   * a few thousand glyphs as separate messages would serialise and post each
   * one on its own, and would leave the project half-replaced if any failed.
   */
  | {
      readonly id: number;
      readonly kind: "replaceAll";
      /**
       * Carried with the glyphs rather than sent after them.
       *
       * `replaceDocument` writes every file the project has, kerning included,
       * so anything not in this message is written over as empty. Sending it
       * afterwards would leave a window in which the font on disk had lost it.
       */
      readonly kerning: StoredKerning;
      readonly glyphs: readonly StoredGlyph[];
      readonly info: StoredFontInfo;
      /** The master these glyphs are, written with them. `null` for a font with one. */
      readonly master: string | null;
    }
  | {
      readonly id: number;
      readonly kind: "journal";
      readonly glyph: StoredGlyph;
      readonly at: number;
    }
  /** Note a commit in the journal: the glyphs it changed, and the ones it took away. */
  | {
      readonly id: number;
      readonly kind: "journalCommit";
      readonly glyphs: readonly StoredGlyph[];
      readonly removed: readonly string[];
      /** The order of the glyphs after it, where it changed it. */
      readonly order: readonly string[] | null;
      readonly at: number;
    }
  | { readonly id: number; readonly kind: "clearJournal" }
  /**
   * Keep a copy of the whole font, and drop the oldest copies.
   *
   * The whole document in one message, unlike a save, which sends only what
   * changed: a snapshot is a copy of everything or it is not a copy.
   */
  | { readonly id: number; readonly kind: "snapshot"; readonly snapshot: StoredSnapshot }
  | { readonly id: number; readonly kind: "snapshots" }
  | {
      readonly id: number;
      readonly kind: "readSnapshot";
      readonly at: number;
      /** The master it is a copy of, where the time alone may not say which. */
      readonly master?: string | null;
    }
  /**
   * The pictures a font is traced from.
   *
   * Bytes rather than text, and posted as `ArrayBuffer` because that is what
   * crosses a thread boundary without being copied twice.
   */
  | {
      readonly id: number;
      readonly kind: "putImage";
      readonly name: string;
      readonly bytes: ArrayBuffer;
    }
  | { readonly id: number; readonly kind: "getImage"; readonly name: string }
  | { readonly id: number; readonly kind: "images" }
  | { readonly id: number; readonly kind: "removeImage"; readonly name: string }
  /**
   * The layers of the source this editor does not edit, kept whole.
   *
   * Written once when a font is opened and read once when one is saved, so
   * there is no message for a part of them: they arrive and leave together.
   */
  | { readonly id: number; readonly kind: "putLayers"; readonly layers: readonly StoredLayer[] }
  | { readonly id: number; readonly kind: "layers" }
  /**
   * The masters that are not being drawn: parked whole, one file each.
   *
   * The open one goes through the ordinary save path, a glyph at a time; these
   * are written when you leave a master and read when you go back.
   */
  | {
      readonly id: number;
      readonly kind: "putMaster";
      readonly master: string;
      readonly snapshot: StoredSnapshot;
    }
  | { readonly id: number; readonly kind: "getMaster"; readonly master: string }
  | { readonly id: number; readonly kind: "dropMaster"; readonly master: string }
  | {
      readonly id: number;
      readonly kind: "putDesignspace";
      readonly designspace: {
        axes: unknown;
        masters: unknown;
        current: string;
        instances: unknown;
        rules: unknown;
        rulesProcessing: string;
        kept: unknown;
      };
    }
  | { readonly id: number; readonly kind: "getDesignspace" }
  | { readonly id: number; readonly kind: "wipe" };

export type LoadedPayload = {
  /**
   * The glyphs in their stored form, as one piece of JSON text.
   *
   * Text rather than the objects themselves, because of what crossing costs:
   * four thousand glyphs as objects are copied node by node on the way out and
   * built again node by node on the way in, the second on the page's own
   * thread, and a string is copied as a block. Writing the text and parsing it
   * takes about half the time the copy did.
   */
  readonly glyphs: string;
  readonly info: StoredFontInfo | null;
  /**
   * Carried across explicitly, like everything else.
   *
   * The worker reads it from disk, but a document does not survive being posted
   * between threads — only plain data does — so anything left out here is
   * silently dropped on the way back.
   */
  readonly kerning: StoredKerning | null;
  readonly recovered: boolean;
  readonly problems: readonly string[];
  /** The master the working copy says its glyphs are, or `null` where it does not say. */
  readonly master: string | null;
  /** Glyphs the journal says were removed, whose files may still be there. */
  readonly gone: readonly string[];
};

export type StorageResponse =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly reason: string };

/**
 * How far a request has got, said before its reply.
 *
 * The one thing that crosses without being a reply: a font of four thousand
 * glyphs takes seconds to read, and the page has nothing to show for them
 * unless it is told. Any number may come for a request, or none; the reply
 * still comes once, after them.
 */
export type StorageProgress = {
  readonly id: number;
  readonly progress: { readonly done: number; readonly total: number };
};
