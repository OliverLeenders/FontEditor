import { resolveGlyphComponents } from "./component.js";
import { inkRegions, withInk } from "./stroke.js";
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
const measured = new WeakMap<FontDocument, WeakMap<Glyph, Glyph>>();

export function drawableGlyph(document: FontDocument, glyph: Glyph): Glyph {
  return resolvedWith(document, glyph, drawn, false);
}

/**
 * A glyph as it looks, with each stroke's ink joined into one outline.
 *
 * For the readers that count edges rather than fill them — the ruler laid across a
 * letter, the gap measured beside it. A stroke's ink is drawn as the regions it is
 * made of, which fill exactly as their union does and cost a fraction as much; but
 * a ruler across them would stop at every edge where two regions meet, inside the
 * ink. So these ask for the joined outline, which is remembered per stroke and
 * worked out once for each change to it rather than once a frame.
 */
export function measurableGlyph(document: FontDocument, glyph: Glyph): Glyph {
  return resolvedWith(document, glyph, measured, true);
}

function resolvedWith(
  document: FontDocument,
  glyph: Glyph,
  memo: WeakMap<FontDocument, WeakMap<Glyph, Glyph>>,
  joined: boolean,
): Glyph {
  if (glyph.components.length === 0 && !glyph.contours.some((c) => c.nib !== undefined)) {
    return glyph;
  }

  let known = memo.get(document);
  if (known === undefined) {
    known = new WeakMap();
    memo.set(document, known);
  }
  const remembered = known.get(glyph);
  if (remembered !== undefined) return remembered;

  // Ids for contours nothing selects: they exist to be drawn.
  const ids = counterIds(`drawn-${glyph.name}-`);
  const ink = (g: Glyph): Glyph =>
    joined
      ? withInk(g, ids)
      : g.contours.some((c) => c.nib !== undefined)
        ? { ...g, contours: g.contours.flatMap((c) => inkRegions(c)) }
        : g;
  // A glyph placed as a component draws what it draws, strokes included: the
  // component is asked for its ink, not for its skeletons.
  const source = {
    glyphOf: (name: string) => {
      const found = document.glyphs[name];
      return found === undefined ? null : ink(found);
    },
  };
  const resolved: Glyph = {
    ...glyph,
    contours: [
      ...ink(glyph).contours,
      ...resolveGlyphComponents(source, glyph.name, glyph.components, ids),
    ],
    components: [],
  };
  known.set(glyph, resolved);
  return resolved;
}
