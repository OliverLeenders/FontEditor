import type { StoredGlyph } from "./schema.js";

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
  | { readonly id: number; readonly kind: "saveFontInfo"; readonly glyphOrder: readonly string[] }
  | { readonly id: number; readonly kind: "journal"; readonly glyph: StoredGlyph; readonly at: number }
  | { readonly id: number; readonly kind: "clearJournal" }
  | { readonly id: number; readonly kind: "wipe" };

export type LoadedPayload = {
  readonly glyph: StoredGlyph | null;
  readonly recovered: boolean;
  readonly problems: readonly string[];
};

export type StorageResponse =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly reason: string };
