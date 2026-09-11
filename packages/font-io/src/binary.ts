/**
 * The part of this package that needs a font parser, as an entry point of its own.
 *
 * Reading an OTF or TTF and writing one both go through opentype.js, which is a
 * quarter of a megabyte of the editor's JavaScript — more than React. Nothing
 * at startup needs it: a font is exported at the end of a session and a binary
 * one imported now and then, and both are something somebody clicks. So the
 * editor loads this when they do, and the bundle it starts with does not carry
 * a parser it may never use.
 *
 * Everything here is also exported from the package's main entry, which is
 * what tests and other packages keep using; this only exists so that importing
 * it lazily is possible at all. It works because the package declares itself
 * free of side effects — without that, the main entry re-exporting these would
 * pull the parser into every bundle that imports anything from this package.
 */

export type { ExportResult } from "./export.js";
export { FontExportError, exportFont } from "./export.js";
export type { ImportResult, ImportWarning } from "./import.js";
export { importFont } from "./import.js";
export { exportInstances } from "./instances.js";
export { exportTrueType } from "./truetype.js";
export { exportVariableFont } from "./variable.js";
export { exportVariableTrueType } from "./variable-truetype.js";
