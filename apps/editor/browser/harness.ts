import { fileURLToPath } from "node:url";

import type { Browser, BrowserContext, Locator, Page } from "playwright";

/**
 * What the browser tests share: a Chromium, a profile, and the handful of
 * things a person does in the editor said once.
 */

// Clear of 5173 to 5179, where the development server a font is being edited in
// runs: this is a separate origin, with storage of its own.
export const PORT = 4317;
const ORIGIN = `http://127.0.0.1:${String(PORT)}/`;

/** Material Symbols Outlined: 4,042 glyphs, which is what a large font is here. */
export const LARGE_FONT = fileURLToPath(
  new URL("./fixtures/MaterialSymbolsOutlined_28pt-Regular.ttf", import.meta.url),
);
export const LARGE_FONT_GLYPHS = 4042;

/** Playwright's own Chromium, kept inside node_modules as the screenshots' is. */
export async function launch(): Promise<Browser> {
  // Read when Playwright is loaded, so set before it is.
  process.env["PLAYWRIGHT_BROWSERS_PATH"] = "0";
  const { chromium } = await import("playwright");
  return chromium.launch();
}

/**
 * A profile of its own, and what went wrong in it.
 *
 * A context is an empty profile: storage nobody has written to, so the start
 * page offers the sample font as a new install does. Pages opened in it share
 * that storage, which is how a reload, a second tab and a window closed and
 * opened again are each done.
 */
export type Profile = {
  context: BrowserContext;
  /** Everything a page of this profile threw, or said on the console as an error. */
  problems: string[];
  /** A new tab, at the start page. */
  open(): Promise<Page>;
};

export async function profile(browser: Browser): Promise<Profile> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  const problems: string[] = [];
  return {
    context,
    problems,
    open: async () => {
      const page = await context.newPage();
      page.on("pageerror", (error) => problems.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") problems.push(message.text());
      });
      await page.goto(ORIGIN);
      return page;
    },
  };
}

/** The button on the start page that goes on with the font last open. */
export function resume(page: Page): Locator {
  return page.getByRole("button", { name: /^Continue with/ });
}

/** From the start page into the font last open. */
export async function enter(page: Page): Promise<void> {
  await resume(page).click();
  await tabs(page).waitFor();
}

export function tabs(page: Page): Locator {
  return page.getByRole("navigation", { name: "Workspaces" });
}

export async function workspace(page: Page, name: string): Promise<void> {
  await tabs(page).getByRole("button", { name }).first().click();
}

/** Give the editor a font file, as the button on the start page and File → Import do. */
export async function importFont(page: Page, path: string): Promise<void> {
  await page.locator('input[type="file"][accept*=".ttf"]').first().setInputFiles(path);
}

/** The pane that covers the stage while a font is on its way in. */
export function opening(page: Page): Locator {
  return page.getByRole("progressbar", { name: "Opening the font" });
}

/** The status line says how many glyphs the open font has. */
export async function glyphs(page: Page, count: number, timeout = 60_000): Promise<void> {
  await page
    .getByText(new RegExp(`^${String(count)} glyphs$`))
    .first()
    .waitFor({ timeout });
}

/**
 * Everything written: the status line says `saved`.
 *
 * It says so before an edit has been noticed too, so this is only an answer
 * once the edit has been seen to land — `settle` first, where it was just made.
 */
export async function saved(page: Page, timeout = 60_000): Promise<void> {
  await page.getByText("saved", { exact: true }).first().waitFor({ timeout });
}

/** Two frames: one for React to commit, one for whatever draws after it. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }),
  );
}

/** The Masters menu, by whatever its label says is being drawn. */
export function mastersMenu(page: Page): Locator {
  return page.getByRole("button", { name: /^Masters/ }).first();
}
