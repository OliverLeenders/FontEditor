/**
 * Build the desktop application for its tests, and run them.
 *
 * The build is a debug one, under the identifier `dev.typewright.app.test` and
 * into `src-tauri/target/desktop-test`, so the fonts kept by an installed copy
 * or by the debug build somebody works in are never the ones a test opens, and
 * neither build is replaced by this one. See `desktop/harness.ts` for what has
 * to be installed besides.
 *
 *   node scripts/desktop-test.mjs                 build, then every test
 *   node scripts/desktop-test.mjs --no-build      the tests on the last build
 *   node scripts/desktop-test.mjs <vitest args>   passed on to Vitest
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const build = !args.includes("--no-build");
const rest = args.filter((arg) => arg !== "--no-build");

/** Run a command of this package's, through pnpm, and stop if it fails. */
function run(command, env = {}) {
  const result = spawnSync("pnpm", command, {
    cwd: here,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (build) {
  run(["tauri", "build", "--debug", "--no-bundle", "--config", "src-tauri/tauri.test.conf.json"], {
    CARGO_TARGET_DIR: join(here, "src-tauri", "target", "desktop-test"),
  });
}
run(["exec", "vitest", "run", "--config", "vitest.desktop.config.ts", ...rest]);
