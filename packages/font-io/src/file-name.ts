import type { FontDocument } from "@typewright/font-model";

/**
 * A filename for the exported font.
 *
 * `PostScript`-ish: the family and style joined without spaces, which is what
 * every other tool produces and what people expect to find in their downloads.
 */
export function exportFileName(document: FontDocument): string {
  const clean = (s: string): string => s.replace(/[^A-Za-z0-9]/g, "");
  const family = clean(document.info.familyName) || "Untitled";
  const style = clean(document.info.styleName) || "Regular";
  return `${family}-${style}.otf`;
}
