import { afterEach, describe, expect, it } from "vitest";

import { type Application, start } from "./harness.js";
import { NATIVE_CLOSE, pressClose, windowTitles } from "./native.js";

/**
 * The desktop application, driven: what it does that a browser does not.
 *
 * The page inside the window is the same editor the browser tests try. What
 * only the shell does is here — windows of its own, a close it holds until the
 * page has answered, and ttfautohint run beside it — each through the page as
 * somebody uses it, so the commands are reached the way the editor reaches
 * them and not called on their own.
 */

let app: Application | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function begin(): Promise<WebdriverIO.Browser> {
  app = await start();
  const browser = app.browser;
  const resume = browser.$("button*=Continue with");
  await resume.waitForClickable({ timeout: 30_000 });
  await resume.click();
  await browser.$("aria/Workspaces").waitForExist();
  return browser;
}

/** A button or menu item by the words it begins with. */
function control(
  browser: WebdriverIO.Browser,
  words: string,
): ReturnType<WebdriverIO.Browser["$"]> {
  return browser.$(
    `//*[(self::button or @role="menuitem" or @role="menuitemcheckbox") and starts-with(normalize-space(.), "${words}")]`,
  );
}

async function press(browser: WebdriverIO.Browser, words: string): Promise<void> {
  const it = control(browser, words);
  await it.waitForClickable({ timeout: 30_000 });
  await it.click();
}

async function workspace(browser: WebdriverIO.Browser, name: string): Promise<void> {
  const tab = browser
    .$("aria/Workspaces")
    .$(`.//button[starts-with(normalize-space(.), "${name}")]`);
  await tab.waitForClickable();
  await tab.click();
}

describe("the desktop application", () => {
  it("opens another window of its own, on the list of fonts", async () => {
    const browser = await begin();
    const first = await browser.getWindowHandle();
    expect(await browser.getWindowHandles()).toHaveLength(1);

    await browser.keys(["Control", "Shift", "n"]);
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2, {
      timeout: 20_000,
      timeoutMsg: "no second window",
    });

    const second = (await browser.getWindowHandles()).find((handle) => handle !== first)!;
    await browser.switchToWindow(second);
    // A window of the whole editor, on the list of fonts and on no font yet.
    await control(browser, "Continue with").waitForExist({ timeout: 30_000 });
  });

  it("hints a TrueType with the ttfautohint beside it", async () => {
    const browser = await begin();
    // What the page downloads is kept in the page instead: a test has no
    // business in somebody's Downloads folder.
    await browser.execute(() => {
      const blobs = new Map<string, Blob>();
      const make = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob: Blob | MediaSource) => {
        const url = make(blob);
        if (blob instanceof Blob) blobs.set(url, blob);
        return url;
      };
      const kept: { file: string; blob: Blob }[] = [];
      (window as unknown as { kept: typeof kept }).kept = kept;
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        const blob = blobs.get(this.href);
        if (this.download !== "" && blob !== undefined) kept.push({ file: this.download, blob });
      };
    });

    await workspace(browser, "Font");
    await press(browser, "Export");
    await press(browser, "TTF, hinted");

    await browser.waitUntil(
      () => browser.execute(() => (window as unknown as { kept: unknown[] }).kept.length > 0),
      { timeout: 60_000, timeoutMsg: "nothing was downloaded" },
    );
    const got = await browser.execute(async () => {
      const { file, blob } = (window as unknown as { kept: { file: string; blob: Blob }[] })
        .kept[0]!;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const view = new DataView(bytes.buffer);
      const tables: string[] = [];
      for (let i = 0; i < view.getUint16(4); i++) {
        tables.push(String.fromCharCode(...bytes.slice(12 + i * 16, 16 + i * 16)));
      }
      return { file, version: view.getUint32(0), tables };
    });

    expect(got.file).toMatch(/-hinted\.ttf$/);
    expect(got.version).toBe(0x00010000);
    // What ttfautohint adds: the programs a hinted TrueType runs.
    expect(got.tables).toEqual(expect.arrayContaining(["fpgm", "prep", "cvt "]));
  });
});

/**
 * A folder for the picker to hand back: one of the webview's private file
 * system, which is a real folder handle with the same things to ask of it.
 * The picker itself is a window of the operating system's, and nothing here
 * can press it.
 */
async function standInPicker(browser: WebdriverIO.Browser): Promise<void> {
  await browser.execute(() => {
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () =>
      await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("picked", {
        create: true,
      });
  });
}

/** The font saved to a folder, and then changed: the folder is behind. */
async function behind(browser: WebdriverIO.Browser): Promise<void> {
  await standInPicker(browser);
  await workspace(browser, "Font");
  await press(browser, "File");
  await press(browser, "Save to folder…");
  await browser
    .$(`//*[starts-with(normalize-space(.), "Saved ") and contains(., " files to ")]`)
    .waitForExist({ timeout: 30_000 });

  await workspace(browser, "Glyph");
  const advance = browser.$(`input[aria-label="Advance"]`);
  await advance.waitForClickable();
  await advance.setValue("777");
  await browser.keys("Enter");
  // Written to the working copy: what is left is the folder.
  await browser.$(`//*[normalize-space(.)="saved"]`).waitForExist({ timeout: 30_000 });
}

/** The window's own title, once the page has named it for its font. */
async function named(): Promise<string> {
  let title = "";
  await expect
    .poll(
      async () => {
        title = (await windowTitles()).find((each) => each.endsWith("— Typewright")) ?? "";
        return title;
      },
      { timeout: 20_000 },
    )
    .not.toBe("");
  return title;
}

describe.runIf(NATIVE_CLOSE)("closing the desktop window, as its close button does", () => {
  it("asks first when the folder is behind, and stays open on Cancel", async () => {
    const browser = await begin();
    await behind(browser);
    const title = await named();

    await pressClose(title);
    // Named for the UFO the editor made in the folder picked.
    const dialog = browser.$(
      `//*[@role="alertdialog" and .//h2[starts-with(., "Save to ") and contains(., ".ufo before closing?")]]`,
    );
    await dialog.waitForExist({ timeout: 20_000 });
    await press(browser, "Cancel");
    await dialog.waitForExist({ reverse: true });
    expect(await windowTitles()).toContain(title);

    // Asked again the next time, and not let through as a second press.
    await pressClose(title);
    await dialog.waitForExist({ timeout: 20_000 });
    await press(browser, "Close without saving");
    await expect.poll(windowTitles, { timeout: 20_000 }).not.toContain(title);
  });

  it("closes without asking when the folder has everything", async () => {
    const browser = await begin();
    const title = await named();
    await pressClose(title);
    await expect.poll(windowTitles, { timeout: 20_000 }).not.toContain(title);
    expect(browser).toBeDefined();
  });

  it("closes on the second press when the page never answers", async () => {
    const browser = await begin();
    await behind(browser);
    const title = await named();
    // A page that is stuck: the shell's question never reaches it.
    await browser.execute(() => {
      window.dispatchEvent = () => true;
    });

    await pressClose(title);
    await new Promise((wake) => setTimeout(wake, 1000));
    expect(await windowTitles()).toContain(title);
    await pressClose(title);
    await expect.poll(windowTitles, { timeout: 20_000 }).not.toContain(title);
  });
});
