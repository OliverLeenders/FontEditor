import type { Browser, Locator, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type Profile,
  engine,
  enter,
  launch,
  profile,
  resume,
  saved,
  workspace,
} from "./harness.js";

/**
 * A font saved to a folder and opened from one, in a real browser.
 *
 * Saving to a folder is asked of the browser's own picker, which is a window of
 * the operating system's and cannot be pressed from here; so this was the one
 * thing the browser tests did not do, and the one the editor does to files that
 * are somebody's own. What stands in for the picker hands back a folder all the
 * same, and a real one: a directory of the browser's private file system, which
 * is the same kind of handle with the same things to ask of it. Everything
 * after the picker is the editor's own — the UFO it makes inside the folder,
 * the files it writes and the ones it leaves, the handle it keeps for next
 * time, and reading a font back out of what it wrote.
 *
 * In Chromium, which is where a folder can be saved to at all — and in the
 * Chrome or Edge that is installed, not the one Playwright fetches. That one is
 * a browser with the window taken off, and it goes down when a folder of the
 * private file system is read back out of the database the editor remembers
 * folders in, which a whole browser does without trouble. `FOLDER_BROWSER`
 * names another: `chrome`, `msedge`, or any channel Playwright knows.
 */
const CHANNEL =
  process.env["FOLDER_BROWSER"] ?? (process.platform === "win32" ? "msedge" : "chrome");

/** Where the stand-in looks for which folder to hand back. */
const PICK = "typewright.test.pick";

// Only where these are run at all: the channel is a Chromium's, and asking
// another engine for it is refused before any test is skipped.
const here = engine() === "chromium";

let browser: Browser;
beforeAll(async () => {
  if (here) browser = await launch(CHANNEL);
});
afterAll(async () => {
  if (here) await browser.close();
});

/** A profile whose folder picker is the stand-in. */
async function withPicker(): Promise<Profile> {
  const p = await profile(browser);
  await p.context.addInitScript((key) => {
    const picked = async (): Promise<FileSystemDirectoryHandle> => {
      const root = await navigator.storage.getDirectory();
      let folder = await root.getDirectoryHandle("picked", { create: true });
      // A path inside it, where a test wants a folder the editor made handed back.
      for (const part of (localStorage.getItem(key) ?? "").split("/")) {
        if (part !== "") folder = await folder.getDirectoryHandle(part);
      }
      return folder;
    };
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = picked;
  }, PICK);
  return p;
}

/** Every file under what the picker hands out, by its path, with what it holds. */
async function onDisk(page: Page): Promise<Record<string, string>> {
  return await page.evaluate(async () => {
    const out: Record<string, string> = {};
    const walk = async (folder: FileSystemDirectoryHandle, base: string): Promise<void> => {
      const entries = folder as unknown as AsyncIterable<[string, FileSystemHandle]>;
      for await (const [name, handle] of entries) {
        const path = base === "" ? name : `${base}/${name}`;
        if (handle.kind === "directory") await walk(handle as FileSystemDirectoryHandle, path);
        else out[path] = await (await (handle as FileSystemFileHandle).getFile()).text();
      }
    };
    const root = await navigator.storage.getDirectory();
    await walk(await root.getDirectoryHandle("picked", { create: true }), "");
    return out;
  });
}

/**
 * The menu's Save, which is what Ctrl-S does. The item and not the key: the
 * headless browser these run in takes the key for its own, and goes down with
 * it before the page is given it.
 */
const SAVE = /^Save(?! to)/;

function menu(page: Page): Locator {
  return page.getByRole("button", { name: /^File/ }).first();
}

async function choose(page: Page, item: RegExp): Promise<void> {
  await workspace(page, "Font");
  await menu(page).click();
  await page.getByRole("menuitemcheckbox", { name: item }).click();
}

/** Wait until some glyph's file in the folder has this advance: the save has landed. */
async function written(page: Page, width: number): Promise<void> {
  await expect
    .poll(
      async () =>
        Object.values(await onDisk(page)).some((file) => file.includes(`width="${String(width)}"`)),
      { timeout: 20_000, interval: 200 },
    )
    .toBe(true);
}

function advance(page: Page): Locator {
  return page.getByRole("textbox", { name: "Advance", exact: true });
}

/** The inspector's Glyph tab, where the advance is. */
async function glyphTab(page: Page): Promise<void> {
  await page
    .getByRole("tablist", { name: "What the inspector shows" })
    .getByRole("tab", { name: "Glyph" })
    .click();
}

async function setAdvance(page: Page, value: number): Promise<void> {
  await workspace(page, "Glyph");
  await glyphTab(page);
  await advance(page).fill(String(value));
  await advance(page).press("Enter");
  await expect.poll(() => advance(page).inputValue()).toBe(String(value));
}

describe.runIf(here)("a font and a folder, in a browser", () => {
  it("is saved as a UFO of its own in the folder picked, and written to again without asking", async () => {
    const p = await withPicker();
    try {
      const page = await p.open();
      await enter(page);
      await saved(page);

      await choose(page, /^Save to folder…/);
      await page.getByText(/^Saved \d+ files to /).waitFor();

      // The UFO the editor makes inside what was picked, named for the font.
      const first = await onDisk(page);
      const ufo = Object.keys(first)
        .find((path) => path.endsWith(".ufo/metainfo.plist"))
        ?.replace(/\/metainfo\.plist$/, "");
      expect(ufo, "a .ufo inside the folder picked").toMatch(/^[^/]+\.ufo$/);
      expect(first[`${ufo ?? ""}/fontinfo.plist`]).toContain("<key>unitsPerEm</key>");
      expect(first[`${ufo ?? ""}/glyphs/contents.plist`]).toContain(".glif");
      const glifs = Object.keys(first).filter((path) => path.endsWith(".glif"));
      expect(glifs.length).toBeGreaterThan(5);

      // An edit, and Save: written to the same UFO, and nothing asked.
      await setAdvance(page, 777);
      await choose(page, SAVE);
      await written(page, 777);
      const second = await onDisk(page);
      expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());
      // Only the glyph that changed is another file than it was.
      const changed = Object.keys(second).filter((path) => second[path] !== first[path]);
      expect(changed.filter((path) => path.endsWith(".glif"))).toHaveLength(1);

      expect(p.problems, "what the pages threw or said was an error").toEqual([]);
    } finally {
      await p.context.close();
    }
  });

  it("is remembered across a reload, and saved to again from there", async () => {
    const p = await withPicker();
    try {
      const page = await p.open();
      await enter(page);
      await choose(page, /^Save to folder…/);
      await page.getByText(/^Saved \d+ files to /).waitFor();

      await page.reload();
      await resume(page).click();
      await workspace(page, "Glyph");
      await glyphTab(page);
      await advance(page).waitFor();

      // No folder to choose: the item is Save, and writes where it wrote.
      await setAdvance(page, 654);
      await choose(page, SAVE);
      await written(page, 654);
      await workspace(page, "Font");
      await menu(page).click();
      expect(await page.getByRole("menuitemcheckbox", { name: /^Save to folder…/ }).count()).toBe(
        0,
      );

      expect(p.problems, "what the pages threw or said was an error").toEqual([]);
    } finally {
      await p.context.close();
    }
  });

  it("is opened from the folder it was saved to, as it was written there", async () => {
    const p = await withPicker();
    try {
      const page = await p.open();
      await enter(page);
      await setAdvance(page, 512);
      await choose(page, /^Save to folder…/);
      await page.getByText(/^Saved \d+ files to /).waitFor();
      const ufo = Object.keys(await onDisk(page))
        .find((path) => path.endsWith(".ufo/metainfo.plist"))
        ?.replace(/\/metainfo\.plist$/, "");

      // Changed here and not saved there: what is opened is what the folder has.
      await setAdvance(page, 999);
      await page.evaluate(
        ([key, path]) => {
          localStorage.setItem(key ?? "", path ?? "");
        },
        [PICK, ufo ?? ""],
      );
      await choose(page, /^Open UFO folder…/);
      await page.getByText(/ glyphs from /).waitFor();

      await workspace(page, "Glyph");
      await glyphTab(page);
      await expect.poll(() => advance(page).inputValue()).toBe("512");

      expect(p.problems, "what the pages threw or said was an error").toEqual([]);
    } finally {
      await p.context.close();
    }
  });
});
