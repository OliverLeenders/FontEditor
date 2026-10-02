import {
  type FontDocument,
  type Glyph,
  PRIVATE_USE_FIRST,
  PRIVATE_USE_LAST,
  glyph,
  glyphNameForCodePoint,
  orderedGlyphs,
  putGlyph,
} from "@typewright/font-model";

/**
 * An icon's name as the way to type it.
 *
 * An icon has a private-use code point, which nobody can type and which means
 * nothing to a screen reader or to anybody reading the page's source. So icon
 * fonts carry a ligature for each icon that spells its name: the text says
 * `home`, the font draws the house, and where the font fails to load the word
 * is still there to read.
 *
 * That takes two things a font drawn as icons does not have. A rule for each
 * icon, replacing the letters of its name with it; and a glyph for each of
 * those letters, since a rule can only replace glyphs the font has, and a text
 * shaper drops a character with no glyph before any rule sees it. Both are made
 * here, on the way out, for a font that asks for them: the letters as blank
 * glyphs with no width, the rules as a \`liga\` feature after whatever the font
 * wrote itself.
 *
 * Made at export rather than written into the source because they are derived
 * from the glyph names, and a copy of something derived goes stale: an icon
 * renamed or added would need the feature file edited to match, and the blank
 * letters would sit in the glyph grid among the icons.
 *
 * Returns the document itself where the font does not ask, and a document that
 * no longer asks where it does — so preparing a font twice adds the rules once.
 */
export function withNameLigatures(document: FontDocument): FontDocument {
  if (!document.nameLigatures) return document;

  const icons = iconsOf(document);
  let out: FontDocument = { ...document, nameLigatures: false };
  if (icons.length === 0) return out;

  // Which glyph each character is, as the font stands and as it grows.
  const glyphOf = new Map<number, string>();
  for (const g of orderedGlyphs(document)) {
    for (const code of g.unicodes) if (!glyphOf.has(code)) glyphOf.set(code, g.name);
  }

  const rules: { from: string[]; to: string }[] = [];
  for (const icon of icons) {
    const from: string[] = [];
    for (const char of icon.name) {
      const code = char.codePointAt(0)!;
      let name = glyphOf.get(code);
      if (name === undefined) {
        name = freeName(out, glyphNameForCodePoint(code));
        out = putGlyph(out, glyph(name, { advance: 0, unicodes: [code] }));
        glyphOf.set(code, name);
      }
      from.push(name);
    }
    rules.push({ from, to: icon.name });
  }

  // The longest first: a shaper takes the first rule that fits, and \`arrow\`
  // ahead of \`arrow_left\` would leave \`_left\` standing beside the wrong icon.
  rules.sort((a, b) => b.from.length - a.from.length || (a.to < b.to ? -1 : 1));
  const body = rules.map((r) => `  sub ${r.from.join(" ")} by ${r.to};`).join("\n");
  const feature = `feature liga {\n${body}\n} liga;\n`;
  const before = out.features.trimEnd();
  return { ...out, features: before === "" ? feature : `${before}\n\n${feature}` };
}

/**
 * The glyphs that are icons: those with a private-use code point, which is
 * what an icon is given and a letter never is. A name of one character is left
 * out, since typing it is already typing that character.
 */
function iconsOf(document: FontDocument): Glyph[] {
  return orderedGlyphs(document).filter(
    (g) =>
      [...g.name].length > 1 &&
      g.unicodes.some((code) => code >= PRIVATE_USE_FIRST && code <= PRIVATE_USE_LAST),
  );
}

/** How many glyphs of a font {@link withNameLigatures} would write a rule for. */
export function nameLigatureCount(document: FontDocument): number {
  return iconsOf(document).length;
}

/** A glyph name nothing in the font has: the one asked for, or it with a suffix. */
function freeName(document: FontDocument, wanted: string): string {
  let name = wanted;
  for (let n = 1; document.glyphs[name] !== undefined; n++) name = `${wanted}.liga${String(n)}`;
  return name;
}
