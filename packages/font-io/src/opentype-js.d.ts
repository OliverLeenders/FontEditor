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
 * The package ships both a CommonJS bundle and an ESM one, and they do not agree
 * on shape: Node resolves the CommonJS build and sees only a default export,
 * while a bundler resolves the ESM build and sees only named ones. Both are
 * declared here, and `opentype.ts` picks whichever actually exists at runtime.
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

  /** A TrueType composite reference, as the `glyf` parser produces it. */
  export interface OtComponent {
    readonly glyphIndex: number;
    readonly xScale: number;
    readonly scale01: number;
    readonly scale10: number;
    readonly yScale: number;
    readonly dx: number;
    readonly dy: number;
    /** Point-matching placement, which carries no offsets. Rare, and not read. */
    readonly matchedPoints?: readonly number[];
  }

  export interface OtGlyph {
    readonly index?: number;
    readonly isComposite?: boolean;
    readonly components?: readonly OtComponent[];
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

  export interface OtPosition {
    init(): void;
    readonly defaultKerningTables?: unknown;
  }

  export interface OtFont {
    /** Reading GPOS is supported even though writing it is not. */
    getKerningValue(left: number | OtGlyph, right: number | OtGlyph): number;
    charToGlyph(character: string): OtGlyph;
    readonly position: OtPosition;
    readonly kerningPairs?: Readonly<Record<string, number>>;
    readonly unitsPerEm: number;
    readonly ascender: number;
    readonly descender: number;
    readonly glyphs: OtGlyphSet;
    names: OtNames;
    readonly outlinesFormat: string;
    readonly tables: {
      readonly os2?: { readonly sxHeight?: number; readonly sCapHeight?: number };
      /** Parsed GPOS, typed as loosely and for the same reason as GSUB below. */
      readonly gpos?: {
        readonly features: readonly { readonly tag: string }[];
        readonly lookups: readonly {
          readonly lookupType: number;
          readonly subtables: readonly unknown[];
        }[];
      };
      /**
       * Parsed GSUB, when the font has one. Typed loosely on purpose: what the
       * tests ask of it is that the lookups our writer produced come back with the
       * types and tags we gave them, and pinning the whole shape of somebody
       * else's parse tree would be a second specification to maintain.
       */
      readonly gsub?: {
        readonly features: readonly { readonly tag: string }[];
        readonly lookups: readonly {
          readonly lookupType: number;
          /** Loosely typed for the same reason: only a contextual rule looks inside one. */
          readonly subtables: readonly unknown[];
        }[];
      };
    };
  }

  export interface OtFontInit {
    familyName: string;
    styleName: string;
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: OtGlyph[];

    /**
     * What a released font says about itself.
     *
     * All optional, all verified against the installed build: the constructor
     * turns each into a `name` record, and the three numeric ones into `OS/2`
     * and `post`. `fsSelection` is passed explicitly because the default
     * derives it from the italic angle and the weight, and a font's style-map
     * style is a decision rather than a deduction.
     */
    fullName?: string;
    postScriptName?: string;
    version?: string;
    copyright?: string;
    trademark?: string;
    designer?: string;
    designerURL?: string;
    manufacturer?: string;
    manufacturerURL?: string;
    license?: string;
    licenseURL?: string;
    description?: string;
    italicAngle?: number;
    weightClass?: number;
    widthClass?: number;
    fsSelection?: number;
    tables?: { os2?: OtOS2Init };
  }

  /**
   * What `OS/2` is told rather than left to work out.
   *
   * Verified against the installed build: the constructor merges these over its
   * own defaults, and the table writer merges them again over what it derives
   * from the glyphs — so each one set here is the one written. `version` is
   * among them because bits 7 to 9 of `fsSelection` mean nothing before 4.
   */
  export interface OtOS2Init {
    achVendID?: string;
    version?: number;
    sTypoAscender?: number;
    sTypoDescender?: number;
    sTypoLineGap?: number;
    usWinAscent?: number;
    usWinDescent?: number;
  }

  /** One name record's translations. Only English is ever written here. */
  export type OtNameRecord = { en: string };

  export interface OtGlyphInit {
    name: string;
    unicode?: number;
    /** Several code points may map to one glyph. */
    unicodes?: number[];
    advanceWidth: number;
    path: OtPath;
  }

  export interface OpenType {
    parse(buffer: ArrayBuffer): OtFont;
    Font: new (init: OtFontInit) => OtFont & { toArrayBuffer(): ArrayBuffer };
    Glyph: new (init: OtGlyphInit) => OtGlyph;
    Path: new () => OtPath;
  }

  const opentype: OpenType;
  export default opentype;

  export const parse: OpenType["parse"];
  export const Font: OpenType["Font"];
  export const Glyph: OpenType["Glyph"];
  export const Path: OpenType["Path"];
}
