/**
 * @typewright/catalog
 *
 * Querying a font's glyphs — which sets a glyph belongs to, what a search
 * matches, what order to show things in. Everything the glyph browser needs to
 * decide *what* to display, with nothing about *how* it looks.
 *
 * Pure and separately testable, for the same reason the tools are: a filter that
 * quietly drops glyphs is a bug you want a failing assertion for, not one you
 * find by counting cells on screen.
 */

export type { UnicodeBlock } from "./blocks.js";
export { UNICODE_BLOCKS, blockOf } from "./blocks.js";

export type { CatalogEntry } from "./catalog.js";
export { catalog } from "./catalog.js";

export type { CatalogOrder, CatalogQuery, GlyphSet } from "./query.js";
export {
  DEFAULT_QUERY,
  GLYPH_SETS,
  codePointsOfSet,
  filterCatalog,
  glyphSet,
  setCounts,
} from "./query.js";

export { loadUnicodeNames, unicodeName, unicodeNamesReady } from "./unicode-names.js";
