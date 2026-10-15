import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { remote } from "webdriverio";

/**
 * What the desktop tests share: the application started under tauri-driver,
 * and WebdriverIO talking to the page inside its window.
 *
 * The application is a debug build of the shell made for these tests alone —
 * `pnpm test:desktop` makes it — under an identifier of its own,
 * `dev.typewright.app.test`, and into a target folder of its own. The
 * identifier is where the desktop application keeps what its webview stores,
 * fonts included, so a test never opens the fonts of the copy somebody has
 * installed, nor the debug build they work in. And each start is given an
 * empty profile besides, which goes when the application does.
 *
 * On Windows tauri-driver hands the window to msedgedriver, which has to be the
 * version of the WebView2 that is installed: `msedgedriver-tool` fetches that
 * one. On Linux it is WebKitWebDriver, which comes with the webview.
 */

const SHELL = fileURLToPath(new URL("../src-tauri/", import.meta.url));

/** The test build of the application. */
export const APPLICATION = join(
  SHELL,
  "target",
  "desktop-test",
  "debug",
  process.platform === "win32" ? "typewright.exe" : "typewright",
);

const PORT = 4444;

/** A program from Cargo's folder, where `cargo install` puts tauri-driver. */
function cargoProgram(name: string): string {
  const file = process.platform === "win32" ? `${name}.exe` : name;
  const there = join(process.env["CARGO_HOME"] ?? join(homedir(), ".cargo"), "bin", file);
  return existsSync(there) ? there : file;
}

/** Until something answers on the port, or the time is up. */
async function listening(port: number, within = 20_000): Promise<void> {
  const until = Date.now() + within;
  for (;;) {
    const open = await new Promise<boolean>((done) => {
      const socket = connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        done(true);
      });
      socket.once("error", () => {
        done(false);
      });
    });
    if (open) return;
    if (Date.now() > until) throw new Error(`nothing answered on port ${String(port)}`);
    await new Promise((wake) => setTimeout(wake, 200));
  }
}

export type Application = {
  browser: WebdriverIO.Browser;
  /** The empty profile the webview was given. */
  profile: string;
  /** Close the application and everything that was started for it. */
  close(): Promise<void>;
};

/** The application started, its first window open on the start page. */
export async function start(): Promise<Application> {
  if (!existsSync(APPLICATION)) {
    throw new Error(`no test build at ${APPLICATION}: run pnpm test:desktop, which makes it`);
  }
  const profile = await mkdtemp(join(tmpdir(), "typewright-desktop-"));
  const driver: ChildProcess = spawn(cargoProgram("tauri-driver"), ["--port", String(PORT)], {
    // What the drivers say, on CI, where there is nobody to run them again.
    stdio: ["ignore", process.env["CI"] === undefined ? "ignore" : "inherit", "inherit"],
    // Read by WebView2 in place of the folder the application names: a profile
    // nothing has been kept in.
    env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile },
  });
  try {
    await listening(PORT);
    const browser = await remote({
      hostname: "127.0.0.1",
      port: PORT,
      logLevel: "warn",
      capabilities: {
        // tauri-driver's own: which application to start.
        "tauri:options": { application: APPLICATION },
      } as WebdriverIO.Capabilities,
    });
    return {
      browser,
      profile,
      close: async () => {
        await browser.deleteSession().catch(() => undefined);
        driver.kill();
        // The webview lets go of its profile a moment after its window goes.
        for (let tries = 0; tries < 20; tries++) {
          try {
            await rm(profile, { recursive: true, force: true });
            return;
          } catch {
            await new Promise((wake) => setTimeout(wake, 250));
          }
        }
      },
    };
  } catch (error) {
    driver.kill();
    throw error;
  }
}
