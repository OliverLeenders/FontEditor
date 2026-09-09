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

export { toWoff } from "./woff.js";
export type { Woff2Result } from "./woff2.js";
export { toWoff2 } from "./woff2.js";

export type { UfoExport } from "./ufo.js";
export { contourPoints, exportUfo, glif, ufoFiles } from "./ufo.js";

export type { ZipEntry } from "./zip.js";
export { crc32, entryBytes, entryText, zip } from "./zip.js";

export type { ImportResult, ImportWarning } from "./import.js";
export { documentFrom, importFont } from "./import.js";

export type { UfoImport, UfoImportError, UfoWarning } from "./ufo-import.js";
export { importUfo, looksLikeArchive, looksLikeUfo, readUfo } from "./ufo-import.js";
export type { ExtraLayer, LayerFile } from "./ufo-layers.js";
export {
  DEFAULT_LAYER_DIRECTORY,
  defaultLayer,
  extraLayers,
  layerContentsPlist,
  parseLayerContents,
} from "./ufo-layers.js";
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

export type { Designspace, DesignspaceInstance, Source } from "./designspace.js";
export { designspaceFileName, designspaceXml, parseDesignspace } from "./designspace.js";

export type {
  FamilyExport,
  FamilyImport,
  FamilyInstance,
  FamilyMaster,
  FamilyProblem,
} from "./family.js";
export { exportFamily, familyFiles, looksLikeFamily, readFamily } from "./family.js";

export type { InstanceFont, InstanceMaster, InstancesExport, NamedPlace } from "./instances.js";
export { exportInstances, instanceFonts } from "./instances.js";

export { Bytes } from "./bytes.js";
export type { Cff2Font, Cff2Result } from "./cff2.js";
export { cff2Table } from "./cff2.js";
export type { NamedInstance } from "./fvar.js";
export { fvarTable, statTable } from "./fvar.js";
export type { NameRecord } from "./names.js";
export { nameTable, readNames, withNames } from "./names.js";
export { deltaMasters, hvarTable, itemVariationStore, regionsOf } from "./varstore.js";
export type { VariableMaster, VariableResult } from "./variable.js";
export { exportVariableFont } from "./variable.js";

export type { GlyfResult } from "./glyf.js";
export { glyfTable } from "./glyf.js";
export { exportTrueType } from "./truetype.js";
