/**
 * Fetch ttfautohint for the desktop app's hinted TrueType export.
 *
 * The desktop app hints a font by running ttfautohint beside itself, and
 * ttfautohint is a C program with no build for this repository to depend on
 * from npm. The fontTools project publishes it inside the `ttfautohint-py`
 * wheels on PyPI, built statically with FreeType and HarfBuzz for Windows,
 * Linux and macOS, so that is where it comes from: one pinned version, each
 * wheel checked against the SHA-256 recorded here before anything is taken
 * out of it, and only the executable kept.
 *
 * It lands in `src-tauri/binaries`, named the way Tauri names a bundled
 * program — `ttfautohint-<target triple>` — which the directory is ignored by
 * git for. Nothing is fetched when the file is already there.
 *
 *   node scripts/fetch-ttfautohint.mjs            the host's target, from rustc
 *   node scripts/fetch-ttfautohint.mjs <triple>   a given target
 *
 * ttfautohint is under the FreeType License (or GPL version 2, at the choice of
 * whoever distributes it); this project distributes it under the FreeType
 * License, and says so in the README's credits.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const VERSION = "0.6.1";

const MACOS = {
  file: "ttfautohint_py-0.6.1-py3-none-macosx_10_9_universal2.whl",
  sha256: "a7d621dcdebd5a6ca09f8068e8192e624514d503029dc6dd3d63837bf3891c2e",
  suffix: "",
};

/** Which wheel carries the program for each target Tauri can build. */
const WHEELS = {
  "x86_64-pc-windows-msvc": {
    file: "ttfautohint_py-0.6.1-py3-none-win_amd64.whl",
    sha256: "5eb9448184c1d53ff891f1b09c388bf69578e5f66321474f17a93e8cd96eebd3",
    suffix: ".exe",
  },
  "x86_64-unknown-linux-gnu": {
    file: "ttfautohint_py-0.6.1-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl",
    sha256: "90250631e8646c96a01fdae1736191b021811e41923a7b8259b07690466b7e7d",
    suffix: "",
  },
  "aarch64-apple-darwin": MACOS,
  "x86_64-apple-darwin": MACOS,
};

function fail(message) {
  console.error(`fetch-ttfautohint: ${message}`);
  process.exit(1);
}

const triple =
  process.argv[2] ??
  /^host: (.+)$/m.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1]?.trim();
const wheel = WHEELS[triple];
if (wheel === undefined) fail(`no ttfautohint is published for ${String(triple)}`);

const binaries = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "binaries");
const target = join(binaries, `ttfautohint-${triple}${wheel.suffix}`);
if (existsSync(target)) {
  console.log(`ttfautohint is already at ${target}`);
  process.exit(0);
}

const release = await fetch(`https://pypi.org/pypi/ttfautohint-py/${VERSION}/json`);
if (!release.ok) fail(`PyPI answered ${String(release.status)}`);
const url = (await release.json()).urls.find((u) => u.filename === wheel.file)?.url;
if (url === undefined) fail(`PyPI lists no ${wheel.file}`);

const response = await fetch(url);
if (!response.ok) fail(`${wheel.file}: download answered ${String(response.status)}`);
const bytes = Buffer.from(await response.arrayBuffer());

const digest = createHash("sha256").update(bytes).digest("hex");
if (digest !== wheel.sha256) {
  fail(`${wheel.file} has SHA-256 ${digest}, not the ${wheel.sha256} recorded here`);
}

const executable = extract(bytes, (name) => /(^|\/)ttfautohint(\.exe)?$/.test(name));
mkdirSync(binaries, { recursive: true });
writeFileSync(target, executable);
if (wheel.suffix === "") chmodSync(target, 0o755);
console.log(`ttfautohint from ${wheel.file} is at ${target}`);

/**
 * One file out of a zip archive, which a wheel is.
 *
 * Read from the central directory at the end, which is where a zip says what it
 * holds; stored and deflated entries are the only two a wheel uses.
 */
function extract(zip, wanted) {
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--) {
    if (zip.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) fail("the wheel is not a zip archive");

  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const names = [];

  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) fail("the wheel's directory is damaged");
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    names.push(name);

    if (wanted(name)) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      fail(`${name} is compressed with method ${String(method)}, which this cannot read`);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }

  fail(`no ttfautohint executable in the wheel; it holds:\n  ${names.join("\n  ")}`);
}
