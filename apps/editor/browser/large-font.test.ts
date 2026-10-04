import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  LARGE_FONT,
  LARGE_FONT_GLYPHS,
  glyphs,
  importFont,
  launch,
  opening,
  profile,
  resume,
  saved,
  settle,
  workspace,
} from "./harness.js";

/**
 * A font of four thousand glyphs, which is where the editor was once slow
 * enough to look stopped: brought in from the start page, written to the
 * browser's storage, and read back out of it.
 *
 * The times asked for are several of what it takes, on a machine slower than
 * the one it was measured on. They are there to notice a font that takes a
 * minute again, not one that takes a second longer.
 */

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser.close();
});

describe("a large font, in a browser", () => {
  it("is imported as a font of its own, kept, and opened again with its progress shown", async () => {
    const p = await profile(browser);
    try {
      const page = await p.open();
      await resume(page).waitFor();

      // In from the start page: a new font, the sample left as it was.
      await importFont(page, LARGE_FONT);
      await opening(page).waitFor();
      await glyphs(page, LARGE_FONT_GLYPHS);
      await opening(page).waitFor({ state: "detached" });
      // Shown before it is written, and not called saved until it is: a reload
      // on that word once opened the font that was there before.
      await saved(page);

      // Out of the browser's storage again, with the pane saying how far it is.
      await page.reload();
      await resume(page).waitFor();
      expect(await resume(page).textContent()).toMatch(/^Continue with Material Symbols/);
      expect(await page.getByRole("button", { name: /in a new window$/ }).count()).toBe(1);

      const began = Date.now();
      await resume(page).click();
      const bar = opening(page);
      await bar.waitFor();
      const counted: number[] = [];
      while (await bar.isVisible()) {
        const now = await bar.getAttribute("aria-valuenow").catch(() => null);
        if (now !== null) counted.push(Number(now));
        await page.waitForTimeout(20);
      }
      await glyphs(page, LARGE_FONT_GLYPHS);
      const took = Date.now() - began;

      expect(counted.length, "the pane counted while it read").toBeGreaterThan(0);
      expect(took, "opened in a time nobody would call stopped").toBeLessThan(30_000);

      // The feature file of a font this size: there, and typed into without a wait.
      await workspace(page, "Features");
      const source = page.locator("textarea").first();
      await source.waitFor();
      await source.click();
      const typing = Date.now();
      await page.keyboard.type("# typed here");
      await settle(page);
      expect(await source.inputValue()).toContain("# typed here");
      expect(Date.now() - typing, "twelve keys").toBeLessThan(10_000);

      await saved(page);
      expect(p.problems, "what the pages threw or said was an error").toEqual([]);
    } finally {
      await p.context.close();
    }
  });
});
