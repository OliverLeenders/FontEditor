import { readFile } from "node:fs/promises";

import type { Browser, Locator, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type Profile,
  enter,
  glyphs,
  importFont,
  launch,
  mastersMenu,
  profile,
  resume,
  saved,
  settle,
  workspace,
} from "./harness.js";

/**
 * The built editor in a real browser, doing what a person does.
 *
 * Each of these is something the tests under Node cannot say, because what
 * they stand on is not there: the browser's own storage and what it keeps
 * across a reload, the worker as it is bundled, a tab closed with nothing
 * asked of it, two tabs and the lock between them, a file that is downloaded.
 * Each begins with an empty profile, which is offered the sample font.
 */

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser.close();
});

/** Run with a profile of its own, and ask at the end that no page of it complained. */
async function inProfile(run: (p: Profile) => Promise<void>): Promise<void> {
  const p = await profile(browser);
  try {
    await run(p);
    expect(p.problems, "what the pages threw or said was an error").toEqual([]);
  } finally {
    await p.context.close();
  }
}

/** The advance of the glyph being drawn, as the inspector has it. */
function advance(page: Page): Locator {
  return page.getByRole("textbox", { name: "Advance", exact: true });
}

async function setAdvance(page: Page, value: number): Promise<void> {
  await advance(page).fill(String(value));
  await advance(page).press("Enter");
  await expect.poll(() => advance(page).inputValue()).toBe(String(value));
}

/** Into the sample font and to the glyph it opens on, whose advance is 600. */
async function drawing(page: Page): Promise<void> {
  await enter(page);
  await workspace(page, "Glyph");
  await advance(page).waitFor();
}

/**
 * Open the Masters menu, press one thing in it, and come back to the drawing.
 *
 * The menu is the Font workspace's, and the advance is the Glyph workspace's.
 */
async function inMasters(page: Page, press: () => Promise<void>): Promise<void> {
  await workspace(page, "Font");
  await mastersMenu(page).click();
  await press();
  await page.keyboard.press("Escape");
}

async function masterDrawn(page: Page): Promise<string | null> {
  await workspace(page, "Font");
  return mastersMenu(page).textContent();
}

async function drawMaster(page: Page, name: string): Promise<void> {
  await inMasters(page, async () => {
    await page.getByTitle(`Draw ${name}`, { exact: true }).click();
    await page.getByText(new RegExp(`^${name} · \\d+ glyphs`)).waitFor();
  });
  await expect.poll(() => mastersMenu(page).textContent()).toBe(`Masters · ${name}`);
  await workspace(page, "Glyph");
  await advance(page).waitFor();
}

describe("the editor, in a browser", () => {
  it("opens the sample font, and every workspace of it", async () => {
    await inProfile(async (p) => {
      const page = await p.open();
      await enter(page);
      await glyphs(page, 9);
      for (const name of ["Font", "Glyph", "Spacing", "Features", "Proof"]) {
        await workspace(page, name);
        await settle(page);
      }
      // The proof sets text with HarfBuzz, fetched when it is first wanted:
      // under the policy the page is served with, or not at all.
      await page.waitForLoadState("networkidle");
      await saved(page);
    });
  });

  it("keeps an edit across a reload", async () => {
    await inProfile(async (p) => {
      const page = await p.open();
      await drawing(page);
      expect(await advance(page).inputValue()).toBe("600");
      await setAdvance(page, 777);
      await saved(page);

      await page.reload();
      await drawing(page);
      expect(await advance(page).inputValue()).toBe("777");
    });
  });

  it("has an edit back that was made a moment before the tab was closed", async () => {
    await inProfile(async (p) => {
      const first = await p.open();
      await drawing(first);
      await setAdvance(first, 555);
      // Less than the second a save waits for: what keeps this is the journal.
      await first.waitForTimeout(300);
      await first.close();

      const again = await p.open();
      await drawing(again);
      expect(await advance(again).inputValue()).toBe("555");
    });
  });

  it("lets only one tab save a font, and tells the other", async () => {
    await inProfile(async (p) => {
      const first = await p.open();
      await drawing(first);

      const second = await p.open();
      await enter(second);
      const told = second.getByText(/open in another tab, which is the one saving/);
      await told.waitFor();

      // Taken over, it is the second that saves and the first that is told.
      await second.getByRole("button", { name: "Edit here instead" }).click();
      await told.waitFor({ state: "detached" });
      await first.getByText(/open in another tab, which is the one saving/).waitFor();
    });
  });

  it("keeps each master its own drawing, between them and across a reload", async () => {
    await inProfile(async (p) => {
      const page = await p.open();
      await drawing(page);

      await inMasters(page, async () => {
        await page.getByRole("button", { name: "Add…" }).click();
        await page.getByText(/^Added, drawn from/).waitFor();
      });
      await drawMaster(page, "Bold");
      await expect.poll(() => advance(page).inputValue()).toBe("600");
      await setAdvance(page, 720);

      await drawMaster(page, "Regular");
      await expect.poll(() => advance(page).inputValue()).toBe("600");
      await drawMaster(page, "Bold");
      await expect.poll(() => advance(page).inputValue()).toBe("720");
      await saved(page);

      // The reload is where one master was once written over the other.
      await page.reload();
      await enter(page);
      expect(await masterDrawn(page)).toBe("Masters · Bold");
      await workspace(page, "Glyph");
      await expect.poll(() => advance(page).inputValue()).toBe("720");
      await drawMaster(page, "Regular");
      await expect.poll(() => advance(page).inputValue()).toBe("600");
      await drawMaster(page, "Bold");
      await expect.poll(() => advance(page).inputValue()).toBe("720");
    });
  });

  it("says on the status line what failed with nobody waiting for it", async () => {
    const p = await profile(browser);
    try {
      const page = await p.open();
      await enter(page);

      // Begun and left, as a dozen things in the editor are.
      await page.evaluate(() => {
        void Promise.reject(new Error("That place is taken."));
      });
      const said = page.getByRole("alert").filter({ hasText: "That place is taken." });
      await said.waitFor();

      // Still on the console, with where it came from; and put away by a click.
      expect(p.problems).toEqual(["That place is taken."]);
      await said.click();
      await said.waitFor({ state: "detached" });

      // And what is thrown at once, by something clicked, is said as well.
      await page.evaluate(() => {
        setTimeout(() => {
          throw new Error("That glyph is gone.");
        }, 0);
      });
      await page.getByRole("alert").filter({ hasText: "That glyph is gone." }).waitFor();
      expect(p.problems).toEqual(["That place is taken.", "That glyph is gone."]);
    } finally {
      await p.context.close();
    }
  });

  it("exports a font file that it can open again, as a font of its own", async () => {
    await inProfile(async (p) => {
      const page = await p.open();
      await enter(page);

      await page.getByRole("button", { name: "Export", exact: true }).click();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("menuitemcheckbox", { name: /^TTF/ }).first().click(),
      ]);
      const path = await download.path();
      const bytes = await readFile(path);
      // A TrueType font begins with its version, 1.0.
      expect([...bytes.subarray(0, 4)]).toEqual([0, 1, 0, 0]);

      await importFont(page, path);
      await page.getByText(/· 9 glyphs/).waitFor();
      await saved(page);

      // Two fonts now, and neither took the other's place.
      await page.reload();
      await resume(page).waitFor();
      expect(await page.getByRole("button", { name: /in a new window$/ }).count()).toBe(1);
    });
  });
});
