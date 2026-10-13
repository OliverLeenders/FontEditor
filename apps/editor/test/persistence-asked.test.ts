import { fontDocument, glyph } from "@typewright/font-model";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Persistence, type PersistenceReport } from "../src/persistence.js";

/**
 * Asking the browser to keep the working copy, which is a question.
 *
 * Chromium answers it at once and without asking anybody. Firefox puts it to
 * the person and answers when they do, which is never where the question is
 * dismissed. A font was read and ready behind the pane that says it is being
 * opened for as long as that went unanswered: in Firefox, for good.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a font that has been read", () => {
  it("is shown without waiting to hear whether its storage will be kept", async () => {
    let asked = 0;
    vi.stubGlobal("navigator", {
      storage: {
        // Never answered, as a question nobody has pressed anything on is not.
        persist: () => {
          asked += 1;
          return new Promise<boolean>(() => undefined);
        },
      },
    });

    const said: PersistenceReport[] = [];
    const disk = new Persistence((changes) => said.push(changes));
    const settled = await Promise.race([
      disk.settle(fontDocument([glyph("a", { advance: 500 })]), false).then(() => "settled"),
      new Promise<string>((done) => setTimeout(() => done("still waiting"), 500)),
    ]);

    expect(settled).toBe("settled");
    expect(asked).toBe(1);
    expect(said.some((changes) => changes.storage === "ready")).toBe(true);
  });
});
