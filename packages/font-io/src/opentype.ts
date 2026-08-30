/// <reference path="./opentype-js.d.ts" />

import * as module from "opentype.js";
import type { OpenType } from "opentype.js";

/**
 * The parser, however this environment managed to load it.
 *
 * opentype.js publishes a CommonJS bundle and an ESM one with different shapes.
 * Node resolves the CommonJS build, where everything hangs off a default export;
 * Vite resolves the ESM build, which has named exports and no default at all. So
 * `import opentype from "opentype.js"` works in tests and fails in the browser,
 * and `import * as opentype` does the reverse — a discrepancy no amount of
 * typechecking catches, because both builds satisfy the same declaration.
 *
 * Resolved once, here, so no other file has to know.
 */
export const opentype: OpenType =
  (module as { default?: OpenType }).default ?? (module as unknown as OpenType);
