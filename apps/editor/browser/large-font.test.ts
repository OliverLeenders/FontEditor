import { readFile } from "node:fs/promises";

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

      // Shown, and seconds from written. A reload now would open the sample
      // under this font's name, so the browser is asked to ask — which it only
      // does of a page somebody has touched.
      await page.locator("body").click({ position: { x: 5, y: 5 } });
      const asked: string[] = [];
      page.on("dialog", (dialog) => {
        asked.push(dialog.type());
        void dialog.dismiss();
      });
      await page.evaluate(() => {
        location.reload();
      });
      await expect.poll(() => asked).toEqual(["beforeunload"]);
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

  it(
    "is exported with the window still answering, and says how far it has got",
    { timeout: 420_000 },
    async () => {
      const p = await profile(browser);
      try {
        const page = await p.open();
        await resume(page).waitFor();
        await importFont(page, LARGE_FONT);
        await glyphs(page, LARGE_FONT_GLYPHS);

        await page.getByRole("button", { name: "Export", exact: true }).click();
        const arrived = page.waitForEvent("download", { timeout: 360_000 });
        await page.getByRole("menuitemcheckbox", { name: /^OTF/ }).first().click();

        // Counted as it goes: so many of four thousand and some glyphs.
        const said = page.getByText(/^Exporting… [\d,]+ of [\d,]+ glyphs$/);
        await said.waitFor({ timeout: 60_000 });

        // And the window answers while it does. Half a minute of this was once
        // half a minute of a page that would not: the font is compiled on
        // another thread now. Asked of the page itself, by how long it goes
        // between one frame and the next for two seconds of the export.
        const longest = await page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const began = performance.now();
              let last = began;
              let gap = 0;
              const frame = (now: number): void => {
                gap = Math.max(gap, now - last);
                last = now;
                if (now - began < 2000) requestAnimationFrame(frame);
                else resolve(gap);
              };
              requestAnimationFrame(frame);
            }),
        );
        expect(await said.isVisible(), "still exporting while the frames were counted").toBe(true);
        expect(longest, "the longest the page went without drawing, in milliseconds").toBeLessThan(
          500,
        );

        // Said on the status line, so still said from another workspace: the
        // Export menu is only in the font view, and took its word with it.
        await workspace(page, "Glyph");
        await page.getByRole("textbox", { name: "Advance", exact: true }).waitFor();
        expect(await said.isVisible(), "still said, away from the menu").toBe(true);

        const download = await arrived;
        const bytes = await readFile(await download.path());
        // An OpenType font with CFF outlines begins with OTTO.
        expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("OTTO");
        expect(bytes.length).toBeGreaterThan(500_000);
        await said.waitFor({ state: "detached" });
        await page.getByRole("button", { name: /^Exported .+\.otf/ }).waitFor();

        expect(p.problems, "what the pages threw or said was an error").toEqual([]);
      } finally {
        await p.context.close();
      }
    },
  );
});
