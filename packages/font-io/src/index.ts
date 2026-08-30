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

export type { ImportResult, ImportWarning } from "./import.js";
export { documentFrom, importFont } from "./import.js";
