/**
 * Set the application's version, or check that everything agrees on it.
 *
 * The version lives in `apps/editor/package.json`. `tauri.conf.json` reads it
 * from there, so the installers and the updater follow it without being told.
 * Cargo cannot: `Cargo.toml` has to hold a version of its own, and `Cargo.lock`
 * repeats it, so both are written here — and checked in CI, so that one edited
 * by hand and not the others fails rather than ships.
 *
 *   node scripts/set-version.mjs 0.2.0            set it everywhere
 *   node scripts/set-version.mjs --check          check everything agrees
 *   node scripts/set-version.mjs --check v0.2.0   …and that a release tag names it
 *
 * A version is three numbers. A pre-release such as `0.2.0-beta.1` is refused:
 * a Windows Installer version is numbers only, and the MSI would not build.
 *
 * Nothing is committed or tagged; that stays a person's decision.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  package: join(app, "package.json"),
  cargo: join(app, "src-tauri", "Cargo.toml"),
  lock: join(app, "src-tauri", "Cargo.lock"),
  tauri: join(app, "src-tauri", "tauri.conf.json"),
};

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const read = (file) => readFileSync(file, "utf8");

/**
 * The one place a version is written in a file, as [before, version, after].
 * Anything other than exactly one is a file this script does not understand,
 * and it stops rather than guess.
 */
function locate(text, pattern, what) {
  const found = [...text.matchAll(pattern)];
  if (found.length !== 1) {
    throw new Error(`${what}: expected one version to change, found ${found.length}`);
  }
  const [whole, version] = found[0];
  const start = found[0].index + whole.lastIndexOf(version);
  return [text.slice(0, start), version, text.slice(start + version.length)];
}

// `version` directly under `[package]`, before the next table.
const cargoVersion = (text) =>
  locate(text, /^\[package\]\r?\n(?:(?!\[).*\r?\n)*?version = "([^"]*)"/gm, "Cargo.toml");
// The lock file's entry for this crate, which names it and then its version.
const lockVersion = (text) =>
  locate(text, /^name = "typewright"\r?\nversion = "([^"]*)"/gm, "Cargo.lock");

const current = JSON.parse(read(files.package)).version;
const [command, argument] = process.argv.slice(2);

if (command === "--check") {
  const problems = [];
  if (JSON.parse(read(files.tauri)).version !== "../package.json") {
    problems.push(`tauri.conf.json should take its version from "../package.json"`);
  }
  const cargo = cargoVersion(read(files.cargo))[1];
  if (cargo !== current) problems.push(`Cargo.toml says ${cargo}`);
  const lock = lockVersion(read(files.lock))[1];
  if (lock !== current) problems.push(`Cargo.lock says ${lock}`);
  if (argument !== undefined && argument !== `v${current}`) {
    problems.push(`the tag ${argument} is not v${current}`);
  }

  if (problems.length > 0) {
    console.error(
      `The version is ${current} in apps/editor/package.json, but:\n` +
        problems.map((problem) => `  - ${problem}\n`).join("") +
        "Set it everywhere with: pnpm version:set <version>",
    );
    process.exit(1);
  }
  console.log(
    `Version ${current} agrees everywhere${argument === undefined ? "" : `, and ${argument} names it`}.`,
  );
} else if (command !== undefined && argument === undefined && VERSION.test(command)) {
  const pkg = JSON.parse(read(files.package));
  pkg.version = command;
  writeFileSync(files.package, `${JSON.stringify(pkg, null, 2)}\n`);

  const [cargoBefore, , cargoAfter] = cargoVersion(read(files.cargo));
  writeFileSync(files.cargo, cargoBefore + command + cargoAfter);

  const [lockBefore, , lockAfter] = lockVersion(read(files.lock));
  writeFileSync(files.lock, lockBefore + command + lockAfter);

  console.log(`Version ${current} → ${command}: package.json, Cargo.toml and Cargo.lock.`);
} else {
  console.error(
    "Usage: pnpm version:set <major.minor.patch>\n" +
      "       node apps/editor/scripts/set-version.mjs --check [tag]",
  );
  process.exit(1);
}
