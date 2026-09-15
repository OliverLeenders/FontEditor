/**
 * Write `latest.json`, the file the desktop application's updater reads.
 *
 * The release workflow builds each platform's installer on its own runner and
 * brings their signatures together in one directory; this turns them into the
 * manifest Tauri's updater expects, pointing at the installers attached to the
 * same GitHub release. The application asks for it at
 * `releases/latest/download/latest.json`, which GitHub answers from the newest
 * published release — so a draft, and everything in it, is invisible to
 * installed copies until somebody publishes it.
 *
 *   node scripts/updater-manifest.mjs <signatures directory> <tag> <owner/repository> <output>
 *
 * Windows updates through the NSIS installer, which installs for the current
 * user without asking for an administrator; Linux through the AppImage, the
 * one Linux package that can replace itself.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [directory, tag, repository, output] = process.argv.slice(2);
if (output === undefined || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error(
    "Usage: node scripts/updater-manifest.mjs <signatures directory> <vX.Y.Z> <owner/repository> <output>",
  );
  process.exit(1);
}

const PLATFORMS = {
  "windows-x86_64": /-setup\.exe\.sig$/,
  "linux-x86_64": /\.AppImage\.sig$/,
};

const signatures = readdirSync(directory);
const platforms = {};
for (const [platform, pattern] of Object.entries(PLATFORMS)) {
  const found = signatures.filter((name) => pattern.test(name));
  if (found.length !== 1) {
    throw new Error(
      `${platform}: expected one signature matching ${pattern}, found ${found.length}`,
    );
  }
  const installer = found[0].slice(0, -".sig".length);
  platforms[platform] = {
    signature: readFileSync(join(directory, found[0]), "utf8").trim(),
    url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(installer)}`,
  };
}

const manifest = {
  version: tag.slice(1),
  notes: `https://github.com/${repository}/releases/tag/${tag}`,
  pub_date: new Date().toISOString(),
  platforms,
};
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${output} for ${tag}: ${Object.keys(platforms).join(", ")}.`);
