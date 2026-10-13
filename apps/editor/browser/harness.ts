import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  new URL(
    "../../../fixtures/fonts/material-symbols/MaterialSymbolsOutlined_28pt-Regular.ttf",
    import.meta.url,
  ),
);
export const LARGE_FONT_GLYPHS = 4042;

/** The browsers the editor is tried in: Chromium unless `BROWSER` names another. */
const ENGINES = ["chromium", "firefox", "webkit"] as const;
export type Engine = (typeof ENGINES)[number];

/** Which of them this run is in. */
export function engine(): Engine {
  const asked = process.env["BROWSER"] ?? "chromium";
  const found = ENGINES.find((each) => each === asked);
  if (found === undefined) throw new Error(`BROWSER is ${asked}: not one of ${ENGINES.join(", ")}`);
  return found;
}

/**
 * Playwright's own browser, kept inside node_modules as the screenshots' is —
 * unless the run says where its browsers are, which is how one fetched into
 * Playwright's own cache is used.
 */
export async function launch(
  /**
   * A browser that is installed on the machine instead, by the name Playwright
   * has for it — `chrome`, `msedge` — for what the fetched one cannot do.
   */
  channel?: string,
): Promise<Browser> {
  // Read when Playwright is loaded, so set before it is.
  process.env["PLAYWRIGHT_BROWSERS_PATH"] ??= "0";
  const playwright = await import("playwright");
  return playwright[engine()].launch(channel === undefined ? {} : { channel });
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
  const options = {
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    acceptDownloads: true,
  } as const;
  const context = engine() === "webkit" ? await kept(options) : await browser.newContext(options);
  const problems: string[] = [];
  return {
    context,
    problems,
    open: async () => {
      const page = await context.newPage();
      // What was thrown, as it was said. WebKit hands a promise nobody caught
      // over with the kind of error in front of its words, "Error: …", where
      // the others hand over the words; the words are what is compared.
      page.on("pageerror", (error) => problems.push(error.message.replace(/^Error: /, "")));
      page.on("console", (message) => {
        if (message.type() === "error") problems.push(message.text());
      });
      await page.goto(ORIGIN);
      return page;
    },
  };
}

/**
 * A profile kept in a folder, which is the only kind WebKit gives a file system
 * of its own to: in one that is not kept, as a private window is not, asking
 * for it fails. The folder is new each time and goes when the profile does, so
 * it is as empty as any other.
 */
async function kept(options: Parameters<Browser["newContext"]>[0]): Promise<BrowserContext> {
  const { webkit } = await import("playwright");
  const folder = await mkdtemp(join(tmpdir(), "typewright-webkit-"));
  const context = await webkit.launchPersistentContext(folder, options);
  context.on("close", () => {
    void rm(folder, { recursive: true, force: true }).catch(() => undefined);
  });
  return context;
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
