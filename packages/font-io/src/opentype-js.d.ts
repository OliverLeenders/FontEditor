/**
 * Types for opentype.js 2.0, which ships none of its own.
 *
 * `@types/opentype.js` tracks the 1.x API and disagrees with 2.0 in places that
 * matter — `names` gained a platform level, for one. Rather than take a
 * dependency that is wrong in ways the compiler cannot see, this declares the
 * exact surface we use and nothing else. Everything here was verified against
 * the installed build rather than written from memory.
 *
 * Deliberately narrow. If a field is not declared, we do not read it, and
 * anything we do start reading has to be added here first — which is the check
 * that keeps the parser's shape from spreading past `source.ts`.
 *
 * The package is a UMD bundle exposing a single default export; named imports
 * do not survive the CommonJS interop.
 */
declare module "opentype.js" {
  export type OtCommand =
    | { type: "M"; x: number; y: number }
    | { type: "L"; x: number; y: number }
    | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: "Q"; x1: number; y1: number; x: number; y: number }
    | { type: "Z" };

  export interface OtPath {
    commands: OtCommand[];
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
    quadraticCurveTo(x1: number, y1: number, x: number, y: number): void;
    close(): void;
  }

  export interface OtGlyph {
    readonly index?: number;
    readonly name?: string;
    readonly unicode?: number;
    readonly unicodes?: number[];
    readonly advanceWidth?: number;
    readonly path: OtPath;
  }

  export interface OtGlyphSet {
    readonly length: number;
    get(index: number): OtGlyph;
  }

  /** Localised name records, keyed by platform then by name then by language. */
  export type OtNames = Record<string, Record<string, Record<string, string>> | undefined>;

  export interface OtFont {
    readonly unitsPerEm: number;
    readonly ascender: number;
    readonly descender: number;
    readonly glyphs: OtGlyphSet;
    readonly names: OtNames;
    readonly outlinesFormat: string;
    readonly tables: {
      readonly os2?: { readonly sxHeight?: number; readonly sCapHeight?: number };
    };
  }

  export interface OtFontInit {
    familyName: string;
    styleName: string;
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: OtGlyph[];
  }

  export interface OtGlyphInit {
    name: string;
    unicode?: number;
    advanceWidth: number;
    path: OtPath;
  }

  interface OpenType {
    parse(buffer: ArrayBuffer): OtFont;
    /** Used by tests to build a font to parse back; not part of the import path. */
    Font: new (init: OtFontInit) => OtFont & { toArrayBuffer(): ArrayBuffer };
    Glyph: new (init: OtGlyphInit) => OtGlyph;
    Path: new () => OtPath;
  }

  const opentype: OpenType;
  export default opentype;
}
