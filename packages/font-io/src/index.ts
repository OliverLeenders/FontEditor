/**
 * @fonteditor/font-io
 *
 * Font binaries in, model out. The one package that knows a font parser exists,
 * and the boundary that keeps `opentype.js` from becoming load-bearing anywhere
 * else — the model, the tools and the editor all see only our own types.
 *
 * Reading only, for now. Writing a font back out is a larger job than it looks:
 * opentype.js builds a fresh binary rather than patching the original, so tables
 * the editor never touches — OpenType features, hinting — would not survive a
 * round trip. That deserves to be designed rather than bolted on here.
 */

export type { PathCommand } from "./commands.js";
export { contoursFromCommands } from "./commands.js";

export type { SourceFont, SourceGlyph } from "./source.js";
export { FontParseError, parseFont } from "./source.js";

export {
  buildKerningGpos,
  classDef,
  coverage,
  gposTable,
  pairPosClasses,
  pairPosGlyphs,
} from "./gpos.js";
export { tableChecksum, withTable } from "./sfnt.js";

export type { ExportResult } from "./export.js";
export { FontExportError, exportFileName, exportFont } from "./export.js";

export type { UfoExport } from "./ufo.js";
export { contourPoints, exportUfo, glif, ufoFiles } from "./ufo.js";

export type { ZipEntry } from "./zip.js";
export { crc32, zip } from "./zip.js";

export type { ImportResult, ImportWarning } from "./import.js";
export { documentFrom, importFont } from "./import.js";

export type { UfoImport, UfoImportError, UfoWarning } from "./ufo-import.js";
export { importUfo, looksLikeUfo, readUfo } from "./ufo-import.js";
export type { ZipFile } from "./unzip.js";
export { fileText, unzip } from "./unzip.js";

export type { FeaFeature, FeaProblem, FeaRule, FeaSource } from "./fea.js";
export { parseFea } from "./fea.js";
export type { CompiledFeatures } from "./features.js";
export { NO_FEATURES, compileFeatures } from "./features.js";

export type { Positioner, Shaper } from "./shaping.js";
export {
  DEFAULT_FEATURES,
  NO_POSITIONING,
  NO_SHAPING,
  featureTags,
  positionerFor,
  positionerForParsed,
  shaperFor,
  shaperForParsed,
} from "./shaping.js";
