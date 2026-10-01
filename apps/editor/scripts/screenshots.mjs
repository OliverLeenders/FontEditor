/**
 * Pictures of each workspace, in the light theme and the dark, to look at after
 * a change to how the editor looks.
 *
 * A change to a stylesheet passes every test whether or not it looks right, so
 * this is how one is checked without anybody's open font: the editor is served
 * on a port of its own, and opened in a headless Chromium with an empty profile,
 * which offers the sample font on the start page. Nothing is compared — the pictures are
 * written to `screenshots/` beside this directory, which git ignores, and read.
 *
 *   node scripts/screenshots.mjs [workspace…] [--light | --dark] [--size 1440x900]
 *
 * Chromium is Playwright's own, kept inside node_modules rather than in a cache
 * shared with everything else on the machine; it is fetched once with
 *
 *   PLAYWRIGHT_BROWSERS_PATH=0 pnpm --filter @typewright/editor exec playwright install chromium --only-shell
 */

import { mkdirSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

// Read when Playwright is loaded, so set before it is.
process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
const { chromium } = await import("playwright");
const { createServer } = await import("vite");

// The start page, then the workspaces in the order of their tabs.
const WORKSPACES = ["start", "font", "glyph", "spacing", "features", "proof"];
const LABELS = {
  font: "Font",
  glyph: "Glyph",
  spacing: "Spacing",
  features: "Features",
  proof: "Proof",
};
// Clear of 5173 to 5179, where the development server a font is being edited in
// runs: this one is a separate origin, with storage of its own.
const PORT = 4317;

const args = process.argv.slice(2);
const wanted = args.filter((arg) => !arg.startsWith("--") && !/^\d+x\d+$/.test(arg));
for (const name of wanted) {
  if (!WORKSPACES.includes(name)) {
    console.error(`No workspace called ${name}: ${WORKSPACES.join(", ")}`);
    process.exit(1);
  }
}
const workspaces = wanted.length > 0 ? wanted : WORKSPACES;
const schemes = args.includes("--light")
  ? ["light"]
  : args.includes("--dark")
    ? ["dark"]
    : ["light", "dark"];
const size = args.find((arg) => /^\d+x\d+$/.test(arg)) ?? "1440x900";
const [width, height] = size.split("x").map(Number);

const root = fileURLToPath(new URL("..", import.meta.url));
const out = fileURLToPath(new URL("../screenshots/", import.meta.url));
mkdirSync(out, { recursive: true });

const server = await createServer({
  root,
  logLevel: "warn",
  server: { host: "127.0.0.1", port: PORT, strictPort: true, hmr: false, watch: null },
});
await server.listen();

const browser = await chromium.launch();
const problems = [];
try {
  for (const scheme of schemes) {
    // A fresh context for each theme: an empty profile, so the sample font,
    // and the theme followed from the system as a new install does.
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: scheme,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`${scheme}: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`${scheme}: ${error.message}`));
    await page.goto(`http://127.0.0.1:${String(PORT)}/`);
    const resume = page.getByRole("button", { name: /^Continue with/ });
    await resume.waitFor();
    if (workspaces.includes("start")) await picture(page, "start", scheme);
    await resume.click();
    const tabs = page.getByRole("navigation", { name: "Workspaces" });
    await tabs.waitFor();
    for (const workspace of workspaces) {
      if (workspace === "start") continue;
      try {
        await tabs
          .getByRole("button", { name: LABELS[workspace] })
          .first()
          .click({ timeout: 5000 });
      } catch (error) {
        // What was in the way is the useful part, so it is kept.
        await page.screenshot({ path: `${out}failed-${workspace}-${scheme}.png` });
        throw error;
      }
      await picture(page, workspace, scheme);
    }
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

async function picture(page, name, scheme) {
  // Two frames, one for React to commit and one for the canvases to draw, and
  // a moment for anything that draws after them. The function runs in the
  // page, where the frames are.
  await page.evaluate(
    () =>
      new Promise((done) => {
        const frame = globalThis.requestAnimationFrame;
        frame(() => frame(() => done()));
      }),
  );
  await page.waitForTimeout(150);
  const file = `${out}${name}-${scheme}.png`;
  await page.screenshot({ path: file });
  console.log(file);
}

if (problems.length > 0) {
  console.error(`\nThe page reported ${String(problems.length)} errors:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exitCode = 1;
}
