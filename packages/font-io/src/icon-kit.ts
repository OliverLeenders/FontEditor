import {
  type Contour,
  type FontDocument,
  type Glyph,
  PRIVATE_USE_FIRST,
  PRIVATE_USE_LAST,
  glyphFileName,
  orderedGlyphs,
  segments,
} from "@typewright/font-model";

import { flattenedGlyphs } from "./export.js";
import { fontFileStem } from "./file-name.js";
import { nameLigatureCount } from "./name-ligatures.js";
import type { ZipEntry } from "./zip.js";

/**
 * An icon font as what a web page is given: the font, a stylesheet with a class
 * for each icon, a page showing every icon with its name and code point, and
 * the names and code points as data.
 *
 * A font file alone is not usable as icons. Its glyphs are at private-use code
 * points nobody can type, so every icon font ships with the stylesheet that
 * says which class draws which — and with a page to look an icon up on, since
 * a font's icons cannot be seen without one. These are written from the font
 * as it stands, so they cannot disagree with it.
 */

/** One icon: the glyph's name, and the private-use code point it is typed as. */
export type IconEntry = { readonly name: string; readonly code: number };

/** The font's icons, in font order: the glyphs with a private-use code point. */
export function iconEntries(document: FontDocument): IconEntry[] {
  const out: IconEntry[] = [];
  for (const g of orderedGlyphs(document)) {
    const code = g.unicodes.find((c) => c >= PRIVATE_USE_FIRST && c <= PRIVATE_USE_LAST);
    if (code !== undefined) out.push({ name: g.name, code });
  }
  return out;
}

const hex = (code: number): string => code.toString(16).padStart(4, "0");

/** The class every icon has, from the family's name: `My Icons` is `my-icons`. */
export function iconClass(document: FontDocument): string {
  const slug = document.info.familyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // A class may not start with a digit.
  return slug === "" ? "icons" : /^[0-9]/.test(slug) ? `icons-${slug}` : slug;
}

/** One icon's own class: the shared one, a hyphen, and its name made safe for a selector. */
const classOf = (base: string, name: string): string =>
  `${base}-${name.replace(/[^A-Za-z0-9_-]/g, "-")}`;

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A family name inside a CSS string. */
const cssString = (text: string): string => `"${text.replace(/["\\]/g, "\\$&")}"`;

/**
 * The stylesheet: the font, the class that sets it, and a class per icon.
 *
 * The shared class resets what an icon would otherwise inherit from the text
 * around it — a weight, a letter spacing, a transform — because each of those
 * changes which glyph is drawn or where. `font-display: block` holds the text
 * back until the font is there, since the fallback for an icon is a box.
 */
export function iconStylesheet(document: FontDocument, fontFile: string): string {
  const family = cssString(document.info.familyName);
  const base = iconClass(document);
  const ligatures = document.nameLigatures ? `  font-feature-settings: "liga";\n` : "";
  const lines = [
    `@font-face {`,
    `  font-family: ${family};`,
    `  src: url(${cssString(fontFile)}) format("woff2");`,
    `  font-weight: normal;`,
    `  font-style: normal;`,
    `  font-display: block;`,
    `}`,
    ``,
    `.${base} {`,
    `  font-family: ${family};`,
    `  font-weight: normal;`,
    `  font-style: normal;`,
    `  font-variant: normal;`,
    `  line-height: 1;`,
    `  letter-spacing: normal;`,
    `  text-transform: none;`,
    `  white-space: nowrap;`,
    `  direction: ltr;`,
    `  display: inline-block;`,
    `  speak: never;`,
    `  -webkit-font-smoothing: antialiased;`,
    `  -moz-osx-font-smoothing: grayscale;`,
    `${ligatures}}`,
    ``,
  ];
  for (const icon of iconEntries(document)) {
    lines.push(`.${classOf(base, icon.name)}::before { content: "\\${hex(icon.code)}"; }`);
  }
  return `${lines.join("\n")}\n`;
}

/** The names and code points as data: `{ "home": "e000" }`, in font order. */
export function iconCodepoints(document: FontDocument): string {
  const map: Record<string, string> = {};
  for (const icon of iconEntries(document)) map[icon.name] = hex(icon.code);
  return `${JSON.stringify(map, null, 2)}\n`;
}

/**
 * The page: every icon, with its name and code point, and how to use one.
 *
 * Self-contained apart from the stylesheet beside it, and plain: it is a thing
 * to look an icon up on and to copy a class from, opened from a folder.
 */
export function iconCheatSheet(document: FontDocument, stylesheet: string): string {
  const base = iconClass(document);
  const icons = iconEntries(document);
  const title = escapeHtml(`${document.info.familyName} ${document.info.styleName}`.trim());
  const sample = icons[0];
  const sampleClass = sample === undefined ? `${base}-name` : classOf(base, sample.name);

  const cells = icons
    .map((icon) => {
      const own = classOf(base, icon.name);
      return (
        `    <li><button type="button" data-copy="${escapeHtml(`${base} ${own}`)}">` +
        `<i class="${escapeHtml(`${base} ${own}`)}" aria-hidden="true"></i>` +
        `<span class="name">${escapeHtml(icon.name)}</span>` +
        `<span class="code">U+${hex(icon.code).toUpperCase()}</span></button></li>`
      );
    })
    .join("\n");

  const byName =
    document.nameLigatures && nameLigatureCount(document) > 0 && sample !== undefined
      ? `\n    <p>Or by name, which the font spells as a ligature:</p>\n` +
        `    <pre>&lt;span class="${escapeHtml(base)}"&gt;${escapeHtml(sample.name)}&lt;/span&gt;</pre>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="${escapeHtml(stylesheet)}">
  <style>
    :root { color-scheme: light dark; --ink: #18202a; --soft: #5d6b7a; --rule: #d9e0e8; --ground: #ffffff; --hover: #eef3f8; }
    @media (prefers-color-scheme: dark) {
      :root { --ink: #e5ebf2; --soft: #8b99a8; --rule: #2a3542; --ground: #10171f; --hover: #1a2430; }
    }
    body { margin: 0; padding: 2rem; background: var(--ground); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; }
    h1 { margin: 0; font-size: 1.4rem; }
    p { margin: 0.4rem 0; color: var(--soft); }
    pre { margin: 0.4rem 0 1rem; padding: 0.6rem 0.8rem; border: 1px solid var(--rule); border-radius: 6px; overflow-x: auto; font: 13px/1.5 ui-monospace, monospace; color: var(--ink); }
    ul { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: 0.5rem; margin: 1.5rem 0 0; padding: 0; list-style: none; }
    button { display: grid; justify-items: center; gap: 0.3rem; width: 100%; padding: 1rem 0.4rem 0.7rem; border: 1px solid var(--rule); border-radius: 6px; background: none; color: inherit; font: inherit; cursor: pointer; }
    button:hover { background: var(--hover); }
    button i { font-size: 2rem; }
    .name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8rem; }
    .code { font: 0.72rem ui-monospace, monospace; color: var(--soft); }
    #said { position: fixed; left: 50%; bottom: 1.5rem; transform: translateX(-50%); padding: 0.4rem 0.8rem; border-radius: 6px; background: var(--ink); color: var(--ground); font-size: 0.85rem; opacity: 0; transition: opacity 0.15s; pointer-events: none; }
    #said.shown { opacity: 1; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${String(icons.length)} ${icons.length === 1 ? "icon" : "icons"}. Click one to copy its classes.</p>
  <pre>&lt;link rel="stylesheet" href="${escapeHtml(stylesheet)}"&gt;
&lt;i class="${escapeHtml(`${base} ${sampleClass}`)}"&gt;&lt;/i&gt;</pre>${byName}
  <ul>
${cells}
  </ul>
  <div id="said" role="status"></div>
  <script>
    const said = document.getElementById("said");
    let hide = 0;
    document.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-copy]");
      if (button === null) return;
      const text = button.dataset.copy;
      navigator.clipboard?.writeText(text);
      said.textContent = "Copied " + text;
      said.classList.add("shown");
      clearTimeout(hide);
      hide = setTimeout(() => said.classList.remove("shown"), 1400);
    });
  </script>
</body>
</html>
`;
}

/**
 * The kit's files, around a font already compiled to WOFF2: the font, the
 * stylesheet, the page and the code points, all named for the font.
 */
export function iconKitFiles(document: FontDocument, woff2: Uint8Array): ZipEntry[] {
  const stem = fontFileStem(document);
  return [
    { path: `${stem}.woff2`, bytes: woff2 },
    { path: `${stem}.css`, text: iconStylesheet(document, `${stem}.woff2`) },
    { path: `${stem}.html`, text: iconCheatSheet(document, `${stem}.css`) },
    { path: `${stem}.json`, text: iconCodepoints(document) },
  ];
}

/** A number in path data: whole where it is whole, and short where not. */
const n = (value: number): string => String(Math.round(value * 100) / 100);

/** Contours as SVG path data, y turned over to run down from `top`. */
function pathData(contours: readonly Contour[], top: number): string {
  const parts: string[] = [];
  for (const c of contours) {
    const spans = segments(c);
    const first = spans[0];
    if (first === undefined) continue;
    parts.push(`M${n(first.a.x)} ${n(top - first.a.y)}`);
    for (const s of spans) {
      if (s.kind === "line") {
        parts.push(`L${n(s.b.x)} ${n(top - s.b.y)}`);
      } else {
        const out = s.out ?? s.a;
        const into = s.in ?? s.b;
        parts.push(
          `C${n(out.x)} ${n(top - out.y)} ${n(into.x)} ${n(top - into.y)} ${n(s.b.x)} ${n(top - s.b.y)}`,
        );
      }
    }
    if (c.closed) parts.push("Z");
  }
  return parts.join("");
}

/**
 * One glyph as an SVG, in the box a line of text gives it: as wide as its
 * advance, and from the ascender to the descender. The outlines are the ones
 * the font is compiled with — components resolved, strokes turned to ink,
 * overlaps joined — so the picture is the glyph and not the drawing of it.
 */
export function glyphSvg(g: Glyph, document: FontDocument): string {
  const { ascender, descender } = document.info;
  const width = Math.max(1, Math.round(g.advance));
  const height = Math.round(ascender - descender);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(height)}">` +
    `<path d="${pathData(g.contours, ascender)}"/></svg>\n`
  );
}

/**
 * Every glyph that draws something, as an SVG file each: an icon set going
 * back out as the pictures it came in as. Named for the glyph, in a way that is
 * safe on every file system.
 */
export function glyphSvgFiles(document: FontDocument): ZipEntry[] {
  const out: ZipEntry[] = [];
  for (const g of flattenedGlyphs(document)) {
    if (g.contours.length === 0) continue;
    out.push({ path: glyphFileName(g.name, ".svg"), text: glyphSvg(g, document) });
  }
  return out;
}
