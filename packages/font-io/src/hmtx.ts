import { readTablesOf, withTable } from "./sfnt.js";

/**
 * Left sidebearings written into `hmtx`, from where each outline actually starts.
 *
 * opentype.js writes the sidebearing it was given and nothing else, and it was
 * given none, so every glyph of every font this editor exported said its outline
 * began at the origin. For the CFF flavour that is a lie nothing draws by. For
 * the TrueType one it is the instruction: FreeType, and the rasterisers that
 * follow the TrueType model, move the outline until its leftmost point sits at
 * the sidebearing — so an `H` drawn forty units in was drawn at the origin, and
 * an `l` a hundred units in drew beside where it was meant to be.
 *
 * `xMins` by glyph id, `null` for a glyph with no outline, whose sidebearing is
 * zero. The table is only rewritten where something changes, so a font that
 * already agrees comes back as the same bytes.
 */
export function withLeftSideBearings(
  font: Uint8Array,
  xMins: readonly (number | null)[],
): Uint8Array {
  const tables = readTablesOf(font);
  const hhea = tables.find((t) => t.tag === "hhea")?.data;
  const hmtx = tables.find((t) => t.tag === "hmtx")?.data;
  if (hhea === undefined || hmtx === undefined || hhea.length < 36) return font;

  // How many glyphs have an advance of their own; the rest share the last one
  // and are listed by sidebearing alone.
  const metrics = new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength).getUint16(34);
  const table = hmtx.slice();
  const view = new DataView(table.buffer);

  let changed = false;
  for (const [glyph, xMin] of xMins.entries()) {
    const at = glyph < metrics ? glyph * 4 + 2 : metrics * 4 + (glyph - metrics) * 2;
    if (at + 2 > table.length) continue;
    const sidebearing = xMin ?? 0;
    if (view.getInt16(at) === sidebearing) continue;
    view.setInt16(at, sidebearing);
    changed = true;
  }

  return changed ? withTable(font, "hmtx", table) : font;
}
