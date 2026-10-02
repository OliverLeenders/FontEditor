import type { SvgFile, SvgGlyphs } from "@typewright/font-io";

/**
 * SVG files on their way into the font: telling them from anything else that
 * is dropped or pasted, reading them, and saying what came of it.
 */

/** Whether a file is an SVG, by its type where the browser gives one and its name where not. */
export function isSvgFile(file: File): boolean {
  return file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
}

/** Whether a drop or a pick is SVG files and nothing else. */
export function areSvgFiles(files: readonly File[]): boolean {
  return files.length > 0 && files.every(isSvgFile);
}

/** Whether pasted text is an SVG rather than this editor's own contours, or a sentence. */
export function looksLikeSvg(text: string): boolean {
  return /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[\s\S]*?>\s*)?<svg[\s>]/i.test(
    text,
  );
}

/** The files read, in the order of their names, which is the order the glyphs are made in. */
export async function readSvgFiles(files: readonly File[]): Promise<SvgFile[]> {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(sorted.map(async (file) => ({ name: file.name, text: await file.text() })));
}

/** What the status bar says about something that just happened, and the detail behind it. */
export type Notice = {
  readonly summary: string;
  /** One line each: what was left out and why, what came in changed. */
  readonly details: readonly string[];
};

const count = (n: number, one: string, many: string): string =>
  n === 1 ? `1 ${one}` : `${String(n)} ${many}`;

/** A set of SVG files brought in, said in a line, with what was left out beneath it. */
export function importNotice(made: SvgGlyphs): Notice {
  const parts: string[] = [];
  if (made.glyphs.length > 0) {
    parts.push(`Imported ${count(made.glyphs.length, "glyph", "glyphs")}`);
  }
  if (made.replaced.length > 0) {
    parts.push(
      `${made.glyphs.length > 0 ? "redrew" : "Redrew"} ${count(made.replaced.length, "icon", "icons")}`,
    );
  }
  if (parts.length === 0) parts.push("No glyphs imported");
  if (made.skipped.length > 0)
    parts.push(`${count(made.skipped.length, "file", "files")} left out`);
  // Warnings repeat across an icon set — every stroked icon says the same
  // thing — so they are counted by glyph rather than by line.
  const warned = new Set(made.warnings.map((w) => w.glyph)).size;
  if (warned > 0) parts.push(`${count(warned, "glyph", "glyphs")} changed on the way in`);

  return {
    summary: parts.join(" · "),
    details: [
      ...made.skipped.map((s) => `${s.file}: ${s.why}`),
      ...made.warnings.map((w) => `${w.glyph}: ${w.message}`),
    ],
  };
}
