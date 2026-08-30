import type { FontDocument, Glyph } from "@fonteditor/font-model";
import { fontDocument, setGlyphOrder } from "@fonteditor/font-model";

import type { LoadedPayload, StorageRequest, StorageResponse } from "./protocol.js";
import { decodeFontInfo, decodeGlyph, encodeFontInfo, encodeGlyph } from "./schema.js";

/**
 * `Omit<StorageRequest, "id">` looks right and is not: applied to a union, Omit
 * keeps only the keys every member shares, so every payload field vanished and
 * the client was typed to reject its own messages. The conditional distributes
 * over the union first, which is what was meant.
 */
type WithoutId<T> = T extends { id: number } ? Omit<T, "id"> : never;

export type LoadedProject =
  | { readonly kind: "empty" }
  | {
      readonly kind: "loaded";
      readonly document: FontDocument;
      readonly recovered: boolean;
      readonly problems: readonly string[];
    };

/**
 * The main thread's handle on the storage worker.
 *
 * One promise per request, matched by id. The worker is constructed by the
 * caller rather than here, because how a worker URL is spelled is a bundler
 * question and this package should not have an opinion about it.
 */
export class StorageClient {
  private nextId = 1;
  private readonly waiting = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();

  constructor(private readonly worker: Worker) {
    this.worker.addEventListener("message", (event: MessageEvent<StorageResponse>) => {
      const response = event.data;
      const pending = this.waiting.get(response.id);
      if (pending === undefined) return;
      this.waiting.delete(response.id);
      if (response.ok) pending.resolve(response.value);
      else pending.reject(new Error(response.reason));
    });

    this.worker.addEventListener("error", (event) => {
      // A worker that has died will never reply, so anything outstanding has to
      // be failed rather than left hanging forever.
      const error = new Error(`Storage worker failed: ${event.message}`);
      for (const pending of this.waiting.values()) pending.reject(error);
      this.waiting.clear();
    });
  }

  async open(directory = "project"): Promise<void> {
    await this.send({ kind: "open", directory });
  }

  async load(): Promise<LoadedProject> {
    const payload = (await this.send({ kind: "load" })) as LoadedPayload;
    if (payload.glyphs.length === 0) return { kind: "empty" };

    const glyphs = [];
    const problems = [...payload.problems];
    for (const stored of payload.glyphs) {
      const decoded = decodeGlyph(stored);
      if (decoded.ok) glyphs.push(decoded.value);
      else problems.push(`${stored.name}: ${decoded.reason}`);
    }
    if (glyphs.length === 0) return { kind: "empty" };

    const { info } = decodeFontInfo(payload.info);
    const document = setGlyphOrder(fontDocument(glyphs, info), glyphs.map((g) => g.name));

    return { kind: "loaded", document, recovered: payload.recovered, problems };
  }

  async saveGlyphs(glyphs: readonly Glyph[]): Promise<readonly string[]> {
    if (glyphs.length === 0) return [];
    const written = await this.send({ kind: "saveGlyphs", glyphs: glyphs.map(encodeGlyph) });
    return written as readonly string[];
  }

  async saveFontInfo(document: FontDocument): Promise<void> {
    await this.send({ kind: "saveFontInfo", info: encodeFontInfo(document) });
  }

  async journal(glyph: Glyph, at: number = Date.now()): Promise<void> {
    await this.send({ kind: "journal", glyph: encodeGlyph(glyph), at });
  }

  async clearJournal(): Promise<void> {
    await this.send({ kind: "clearJournal" });
  }

  async wipe(): Promise<void> {
    await this.send({ kind: "wipe" });
  }

  terminate(): void {
    this.worker.terminate();
  }

  private send(request: WithoutId<StorageRequest>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id } as StorageRequest);
    });
  }
}
