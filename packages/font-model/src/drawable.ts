import { resolveGlyphComponents } from "./component.js";
import type { FontDocument } from "./document.js";
import type { Glyph } from "./glyph.js";
import { counterIds } from "./ids.js";

/**
 * A glyph as it looks: its components drawn into it as contours.
 *
 * For everything that shows a glyph without editing it — the browser's cells,
 * the spacing line, the proof, the neighbours beside the canvas. A composite is
 * nothing but references, and a renderer that draws a glyph's own contours draws
 * nothing for one: an `ä` built from `a` and a dieresis showed as an empty cell
 * and a gap in the line. Resolving here keeps every renderer ignorant of the
 * document, which is what lets each of them be handed a glyph and nothing else.
 *
 * Remembered per document, then per glyph. The document is a new value after
 * every edit, so an answer never outlives the letters it was drawn from —
 * correcting the `a` redraws the `ä` — and there is nothing to invalidate by
 * hand. Keyed on the glyph itself rather than its name, so a glyph that is not
 * the document's own, such as an interpolated one, is never answered for another.
 */
const drawn = new WeakMap<FontDocument, WeakMap<Glyph, Glyph>>();

export function drawableGlyph(document: FontDocument, glyph: Glyph): Glyph {
  if (glyph.components.length === 0) return glyph;

  let known = drawn.get(document);
  if (known === undefined) {
    known = new WeakMap();
    drawn.set(document, known);
  }
  const remembered = known.get(glyph);
  if (remembered !== undefined) return remembered;

  const source = { glyphOf: (name: string) => document.glyphs[name] ?? null };
  const resolved: Glyph = {
    ...glyph,
    contours: [
      ...glyph.contours,
      ...resolveGlyphComponents(
        source,
        glyph.name,
        glyph.components,
        // Ids for contours nothing selects: they exist to be drawn.
        counterIds(`drawn-${glyph.name}-`),
      ),
    ],
    components: [],
  };
  known.set(glyph, resolved);
  return resolved;
}
