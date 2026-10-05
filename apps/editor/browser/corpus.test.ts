import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { zip } from "@typewright/font-io";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  glyphs,
  importFont,
  launch,
  opening,
  profile,
  resume,
  saved,
  settle,
  workspace,
} from "./harness.js";

/**
 * The real fonts, each opened in the editor as somebody would open it.
 *
 * `packages/font-io` takes these round as data: in, out, and set beside the
 * font each came from. Here each is brought into the built editor in a real
 * browser and looked at in every workspace — the grid of its glyphs, a glyph
 * to draw, the spacing, the feature file, a proof — which is where a font of
 * three thousand glyphs and a feature file of a hundred thousand characters
 * finds what a starter font of nine does not.
 *
 * What is asked of each: that it arrives with every glyph, that no workspace
 * throws or says anything on the console, that nothing is said to have failed,
 * that it can be written out as a font file, and that it is all kept — closed
 * and opened again, the same font is there.
 */

const FONTS = fileURLToPath(new URL("../../../fixtures/fonts/", import.meta.url));

/** A family's folder as the archive of it somebody would be sent. */
function archiveOf(folder: string): string {
  const files: { path: string; bytes: Uint8Array }[] = [];
  const walk = (prefix: string): void => {
    for (const name of readdirSync(join(FONTS, folder, prefix))) {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      if (statSync(join(FONTS, folder, path)).isDirectory()) walk(path);
      else files.push({ path, bytes: new Uint8Array(readFileSync(join(FONTS, folder, path))) });
    }
  };
  walk("");
  const out = join(mkdtempSync(join(tmpdir(), "typewright-corpus-")), `${folder}.zip`);
  writeFileSync(out, zip(files));
  return out;
}

type Case = {
  readonly name: string;
  /** The file given to the editor. */
  readonly file: () => string;
  readonly glyphs: number;
  /** What the list of fonts calls it afterwards. */
  readonly listed: RegExp;
};

const CASES: readonly Case[] = [
  {
    name: "Source Sans 3",
    file: () => join(FONTS, "source-sans/SourceSans3-Regular.otf"),
    glyphs: 2478,
    listed: /Source Sans 3/,
  },
  {
    name: "Noto Sans",
    file: () => join(FONTS, "noto-sans/NotoSans-Regular.ttf"),
    glyphs: 3884,
    listed: /Noto Sans/,
  },
  {
    name: "EB Garamond",
    file: () => join(FONTS, "eb-garamond/EBGaramond[wght].ttf"),
    glyphs: 3247,
    listed: /EB Garamond/,
  },
  {
    name: "Latin Modern Roman",
    file: () => join(FONTS, "latin-modern/lmroman10-regular.otf"),
    glyphs: 821,
    listed: /LM Roman|Latin Modern/,
  },
  {
    name: "MutatorSans, from its sources",
    file: () => archiveOf("mutator-sans"),
    glyphs: 49,
    listed: /MutatorSans/,
  },
];

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser.close();
});

describe.each(CASES)("$name, in a browser", ({ file, glyphs: count, listed }) => {
  it("is brought in, looked at in every workspace, and kept", { timeout: 420_000 }, async () => {
    const p = await profile(browser);
    try {
      const page = await p.open();
      await resume(page).waitFor();

      await importFont(page, file());
      await glyphs(page, count, 120_000);
      await opening(page).waitFor({ state: "detached" });

      // Each workspace in turn, and a moment in each for whatever it draws
      // or fetches once it is on screen.
      for (const name of ["Glyph", "Spacing", "Features", "Proof", "Font"]) {
        await workspace(page, name);
        await settle(page);
        await page.waitForLoadState("networkidle");
        await settle(page);
        expect(
          await page.getByRole("alert").allTextContents(),
          `nothing said to have failed in ${name}`,
        ).toEqual([]);
      }

      // Written out as a font file, away from the window, and said to be on
      // the status line: every one of these has tables past what one offset
      // reaches, or kerning by class, or accents, and is compiled here as it
      // is in the tests of the compiler — but in a worker, as it is bundled.
      await page.getByRole("button", { name: "Export", exact: true }).click();
      const arrived = page.waitForEvent("download", { timeout: 240_000 });
      await page.getByRole("menuitemcheckbox", { name: /^OTF/ }).first().click();
      const made = await readFile(await (await arrived).path());
      expect(String.fromCharCode(...made.subarray(0, 4))).toBe("OTTO");
      await page.getByRole("button", { name: /^Exported .+\.otf/ }).waitFor();

      // Written, which for a font this size is seconds after it is shown.
      await saved(page, 180_000);

      // And kept: opened again, the same font with every glyph.
      await page.reload();
      await resume(page).waitFor();
      expect(await resume(page).textContent()).toMatch(listed);
      await resume(page).click();
      await glyphs(page, count, 120_000);

      expect(p.problems, "what the pages threw or said was an error").toEqual([]);
    } finally {
      await p.context.close();
    }
  });
});
