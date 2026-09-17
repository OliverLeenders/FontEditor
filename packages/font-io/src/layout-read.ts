/**
 * Reading GSUB, GPOS and GDEF out of a font, as they are.
 *
 * The other half of `layout.ts`, `gsub.ts`, `gpos.ts` and `gdef.ts`. The font
 * parser this package uses for outlines reads substitutions but stops at pair
 * positioning, and a font opened here should come in with everything it does:
 * its ligatures and alternates, its contextual rules, its mark attachment. So
 * the three tables are read here, into plain structures in glyph ids, every
 * lookup type of both tables, and turned into feature source and anchors by
 * `layout-source.ts`.
 *
 * Every offset is checked before it is followed. A font from somewhere else is
 * not a font this editor wrote, and one lookup it cannot read costs that lookup
 * — named in what comes back — rather than the whole import.
 */

/** A glyph set at one position of a rule, as glyph ids. */
export type GlyphSet = readonly number[];

export type ValueRecord = {
  readonly xPlacement: number;
  readonly yPlacement: number;
  readonly xAdvance: number;
  readonly yAdvance: number;
  /** Whether the record points at device or variation tables, which are not read. */
  readonly device: boolean;
};

export type AnchorPoint = {
  readonly x: number;
  readonly y: number;
  /** A contour point it is tied to, for format 2, which is read as its x and y alone. */
  readonly point: number | null;
  readonly device: boolean;
};

/** A rule of a contextual lookup, whatever format it was written in. */
export type ContextRule = {
  /** Nearest first, as the format stores it. */
  readonly backtrack: readonly GlyphSet[];
  readonly input: readonly GlyphSet[];
  readonly lookahead: readonly GlyphSet[];
  /** Which lookup applies at which input position, in the order they are applied. */
  readonly lookups: readonly { readonly at: number; readonly lookup: number }[];
};

export type Subtable =
  | { readonly kind: "single"; readonly pairs: readonly (readonly [number, number])[] }
  | { readonly kind: "multiple"; readonly pairs: readonly (readonly [number, readonly number[]])[] }
  | {
      readonly kind: "alternate";
      readonly pairs: readonly (readonly [number, readonly number[]])[];
    }
  | {
      readonly kind: "ligature";
      readonly ligatures: readonly { readonly glyphs: readonly number[]; readonly to: number }[];
    }
  | { readonly kind: "context"; readonly rules: readonly ContextRule[] }
  | {
      readonly kind: "reverse";
      readonly backtrack: readonly GlyphSet[];
      readonly lookahead: readonly GlyphSet[];
      readonly pairs: readonly (readonly [number, number])[];
    }
  | {
      readonly kind: "singlePos";
      readonly values: readonly (readonly [number, ValueRecord])[];
    }
  | {
      readonly kind: "pairPos";
      /** Each pair of sets and what the two glyphs are adjusted by. Class 0 is left out. */
      readonly pairs: readonly {
        readonly first: GlyphSet;
        readonly second: GlyphSet;
        readonly one: ValueRecord;
        readonly two: ValueRecord;
        /** Whether it came from a class-based subtable, which is how kerning groups are kept. */
        readonly classes: boolean;
      }[];
    }
  | {
      readonly kind: "cursive";
      readonly glyphs: readonly {
        readonly glyph: number;
        readonly entry: AnchorPoint | null;
        readonly exit: AnchorPoint | null;
      }[];
    }
  | {
      readonly kind: "markBase" | "markMark";
      readonly classCount: number;
      readonly marks: readonly {
        readonly glyph: number;
        readonly klass: number;
        readonly anchor: AnchorPoint;
      }[];
      readonly bases: readonly {
        readonly glyph: number;
        readonly anchors: readonly (AnchorPoint | null)[];
      }[];
    }
  | {
      readonly kind: "markLigature";
      readonly classCount: number;
      readonly marks: readonly {
        readonly glyph: number;
        readonly klass: number;
        readonly anchor: AnchorPoint;
      }[];
      readonly ligatures: readonly {
        readonly glyph: number;
        /** For each component, an anchor per class. */
        readonly components: readonly (readonly (AnchorPoint | null)[])[];
      }[];
    };

export type ReadLookup = {
  /** After extensions are unwrapped: the type the subtables really are. */
  readonly type: number;
  readonly flags: number;
  readonly markFilteringSet: number | null;
  readonly subtables: readonly Subtable[];
};

export type LangSys = {
  readonly required: number | null;
  readonly features: readonly number[];
};

export type ReadScript = {
  readonly tag: string;
  readonly fallback: LangSys | null;
  readonly languages: readonly { readonly tag: string; readonly system: LangSys }[];
};

export type ReadFeature = {
  readonly tag: string;
  readonly lookups: readonly number[];
  /** Whether it carries parameters: a stylistic set's name, a size range. */
  readonly params: boolean;
};

export type ReadLayout = {
  readonly scripts: readonly ReadScript[];
  readonly features: readonly ReadFeature[];
  readonly lookups: readonly (ReadLookup | null)[];
  /** Whether the table varies its features across a designspace. */
  readonly variations: boolean;
  /** What could not be read, lookup by lookup. */
  readonly problems: readonly string[];
};

export type ReadGdef = {
  /** Glyph id to class: 1 base, 2 ligature, 3 mark, 4 component. */
  readonly classes: ReadonlyMap<number, number>;
  readonly attach: ReadonlyMap<number, number>;
  readonly markSets: readonly GlyphSet[];
  /** Ligature carets given as coordinates. */
  readonly carets: ReadonlyMap<number, readonly number[]>;
  readonly problems: readonly string[];
};

class OutOfBounds extends Error {}

/** A view over a table that refuses to read past its end. */
class Reader {
  private readonly view: DataView;

  constructor(
    readonly bytes: Uint8Array,
    /** How many glyphs the font has, which a class 0 needs spelled out. */
    private readonly glyphCount = 0,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Every glyph id in the font. */
  universe(): number[] {
    return Array.from({ length: this.glyphCount }, (_, i) => i);
  }

  private check(at: number, size: number): void {
    if (at < 0 || at + size > this.bytes.length) throw new OutOfBounds(`offset ${String(at)}`);
  }

  u16(at: number): number {
    this.check(at, 2);
    return this.view.getUint16(at);
  }

  i16(at: number): number {
    this.check(at, 2);
    return this.view.getInt16(at);
  }

  u32(at: number): number {
    this.check(at, 4);
    return this.view.getUint32(at);
  }

  tag(at: number): string {
    this.check(at, 4);
    return String.fromCharCode(...this.bytes.subarray(at, at + 4));
  }
}

const GSUB = "GSUB";
const GPOS = "GPOS";

/**
 * Read GSUB or GPOS. `null` where the table is not there or not one at all.
 *
 * `glyphCount` is how many glyphs the font has: a rule written against class
 * 0 means every glyph a class definition does not name, and only the count can
 * say which those are.
 */
export function readLayout(
  bytes: Uint8Array,
  table: "GSUB" | "GPOS",
  glyphCount: number,
): ReadLayout | null {
  if (bytes.length < 10) return null;
  const r = new Reader(bytes, glyphCount);
  const problems: string[] = [];

  try {
    const major = r.u16(0);
    const minor = r.u16(2);
    if (major !== 1) return null;
    const scriptList = r.u16(4);
    const featureList = r.u16(6);
    const lookupList = r.u16(8);
    const variations = minor >= 1 && bytes.length >= 14 && r.u32(10) !== 0;

    const scripts = scriptList === 0 ? [] : readScripts(r, scriptList);
    const features = featureList === 0 ? [] : readFeatures(r, featureList);

    const lookups: (ReadLookup | null)[] = [];
    const count = lookupList === 0 ? 0 : r.u16(lookupList);
    for (let i = 0; i < count; i++) {
      try {
        lookups.push(readLookup(r, lookupList + r.u16(lookupList + 2 + i * 2), table));
      } catch (error) {
        problems.push(`${table} lookup ${String(i)} could not be read: ${describe(error)}`);
        lookups.push(null);
      }
    }

    return { scripts, features, lookups, variations, problems };
  } catch (error) {
    return {
      scripts: [],
      features: [],
      lookups: [],
      variations: false,
      problems: [`${table} could not be read: ${describe(error)}`],
    };
  }
}

function describe(error: unknown): string {
  if (error instanceof OutOfBounds) return `it points past the end of the table (${error.message})`;
  return error instanceof Error ? error.message : String(error);
}

function readScripts(r: Reader, at: number): ReadScript[] {
  const out: ReadScript[] = [];
  const count = r.u16(at);
  for (let i = 0; i < count; i++) {
    const record = at + 2 + i * 6;
    const tag = r.tag(record);
    const script = at + r.u16(record + 4);
    const fallbackAt = r.u16(script);
    const languages: { tag: string; system: LangSys }[] = [];
    const langCount = r.u16(script + 2);
    for (let j = 0; j < langCount; j++) {
      const lang = script + 4 + j * 6;
      languages.push({ tag: r.tag(lang), system: readLangSys(r, script + r.u16(lang + 4)) });
    }
    out.push({
      tag,
      fallback: fallbackAt === 0 ? null : readLangSys(r, script + fallbackAt),
      languages,
    });
  }
  return out;
}

function readLangSys(r: Reader, at: number): LangSys {
  const required = r.u16(at + 2);
  const count = r.u16(at + 4);
  const features: number[] = [];
  for (let i = 0; i < count; i++) features.push(r.u16(at + 6 + i * 2));
  return { required: required === 0xffff ? null : required, features };
}

function readFeatures(r: Reader, at: number): ReadFeature[] {
  const out: ReadFeature[] = [];
  const count = r.u16(at);
  for (let i = 0; i < count; i++) {
    const record = at + 2 + i * 6;
    const feature = at + r.u16(record + 4);
    const lookupCount = r.u16(feature + 2);
    const lookups: number[] = [];
    for (let j = 0; j < lookupCount; j++) lookups.push(r.u16(feature + 4 + j * 2));
    out.push({ tag: r.tag(record), lookups, params: r.u16(feature) !== 0 });
  }
  return out;
}

function readLookup(r: Reader, at: number, table: "GSUB" | "GPOS"): ReadLookup {
  const declared = r.u16(at);
  const flags = r.u16(at + 2);
  const count = r.u16(at + 4);
  const markFilteringSet = (flags & 0x10) !== 0 ? r.u16(at + 6 + count * 2) : null;

  const extension = table === GSUB ? 7 : 9;
  let type = declared;
  const subtables: Subtable[] = [];
  for (let i = 0; i < count; i++) {
    let sub = at + r.u16(at + 6 + i * 2);
    // An extension is a lookup of another type, written further away: the
    // type and the real subtable are inside each of its subtables.
    if (declared === extension) {
      type = r.u16(sub + 2);
      sub = sub + r.u32(sub + 4);
    }
    const read = table === GSUB ? readSubstitution(r, sub, type) : readPositioning(r, sub, type);
    if (read !== null) subtables.push(read);
  }
  return { type, flags, markFilteringSet, subtables };
}

// ---- coverage and classes ----------------------------------------------------

function readCoverage(r: Reader, at: number): number[] {
  const format = r.u16(at);
  const out: number[] = [];
  if (format === 1) {
    const count = r.u16(at + 2);
    for (let i = 0; i < count; i++) out.push(r.u16(at + 4 + i * 2));
  } else if (format === 2) {
    const count = r.u16(at + 2);
    for (let i = 0; i < count; i++) {
      const range = at + 4 + i * 6;
      const start = r.u16(range);
      const end = r.u16(range + 2);
      for (let g = start; g <= end; g++) out.push(g);
    }
  } else {
    throw new Error(`coverage format ${String(format)}`);
  }
  return out;
}

/** Glyph id to class. Glyphs in class 0 are the ones it does not mention. */
function readClassDef(r: Reader, at: number): Map<number, number> {
  const out = new Map<number, number>();
  const format = r.u16(at);
  if (format === 1) {
    const start = r.u16(at + 2);
    const count = r.u16(at + 4);
    for (let i = 0; i < count; i++) {
      const klass = r.u16(at + 6 + i * 2);
      if (klass !== 0) out.set(start + i, klass);
    }
  } else if (format === 2) {
    const count = r.u16(at + 2);
    for (let i = 0; i < count; i++) {
      const range = at + 4 + i * 6;
      const klass = r.u16(range + 4);
      if (klass === 0) continue;
      for (let g = r.u16(range); g <= r.u16(range + 2); g++) out.set(g, klass);
    }
  } else {
    throw new Error(`class definition format ${String(format)}`);
  }
  return out;
}

/**
 * The glyphs of one class. Class 0 is every glyph a definition does not name,
 * which only a glyph count can say; `universe` is every glyph id there is.
 */
function membersOf(
  classes: ReadonlyMap<number, number>,
  klass: number,
  universe: readonly number[],
): number[] {
  if (klass === 0) return universe.filter((g) => !classes.has(g));
  const out: number[] = [];
  for (const [g, k] of classes) if (k === klass) out.push(g);
  return out.sort((a, b) => a - b);
}

// ---- GSUB -----------------------------------------------------------------------

function readSubstitution(r: Reader, at: number, type: number): Subtable | null {
  const format = r.u16(at);
  switch (type) {
    case 1: {
      const covered = readCoverage(r, at + r.u16(at + 2));
      if (format === 1) {
        const delta = r.i16(at + 4);
        return { kind: "single", pairs: covered.map((g) => [g, (g + delta) & 0xffff] as const) };
      }
      const count = r.u16(at + 4);
      const pairs: (readonly [number, number])[] = [];
      for (let i = 0; i < count && i < covered.length; i++) {
        pairs.push([covered[i]!, r.u16(at + 6 + i * 2)]);
      }
      return { kind: "single", pairs };
    }
    case 2:
    case 3: {
      const covered = readCoverage(r, at + r.u16(at + 2));
      const count = r.u16(at + 4);
      const pairs: (readonly [number, number[]])[] = [];
      for (let i = 0; i < count && i < covered.length; i++) {
        const seq = at + r.u16(at + 6 + i * 2);
        const n = r.u16(seq);
        const glyphs: number[] = [];
        for (let j = 0; j < n; j++) glyphs.push(r.u16(seq + 2 + j * 2));
        pairs.push([covered[i]!, glyphs]);
      }
      return type === 2 ? { kind: "multiple", pairs } : { kind: "alternate", pairs };
    }
    case 4: {
      const covered = readCoverage(r, at + r.u16(at + 2));
      const setCount = r.u16(at + 4);
      const ligatures: { glyphs: number[]; to: number }[] = [];
      for (let i = 0; i < setCount && i < covered.length; i++) {
        const set = at + r.u16(at + 6 + i * 2);
        const n = r.u16(set);
        for (let j = 0; j < n; j++) {
          const lig = set + r.u16(set + 2 + j * 2);
          const to = r.u16(lig);
          const components = r.u16(lig + 2);
          const glyphs = [covered[i]!];
          for (let k = 1; k < components; k++) glyphs.push(r.u16(lig + 4 + (k - 1) * 2));
          ligatures.push({ glyphs, to });
        }
      }
      return { kind: "ligature", ligatures };
    }
    case 5:
      return { kind: "context", rules: readContext(r, at) };
    case 6:
      return { kind: "context", rules: readChainContext(r, at) };
    case 8: {
      const covered = readCoverage(r, at + r.u16(at + 2));
      const backCount = r.u16(at + 4);
      const backtrack: number[][] = [];
      for (let i = 0; i < backCount; i++)
        backtrack.push(readCoverage(r, at + r.u16(at + 6 + i * 2)));
      const aheadAt = at + 6 + backCount * 2;
      const aheadCount = r.u16(aheadAt);
      const lookahead: number[][] = [];
      for (let i = 0; i < aheadCount; i++) {
        lookahead.push(readCoverage(r, at + r.u16(aheadAt + 2 + i * 2)));
      }
      const substAt = aheadAt + 2 + aheadCount * 2;
      const n = r.u16(substAt);
      const pairs: (readonly [number, number])[] = [];
      for (let i = 0; i < n && i < covered.length; i++) {
        pairs.push([covered[i]!, r.u16(substAt + 2 + i * 2)]);
      }
      return { kind: "reverse", backtrack, lookahead, pairs };
    }
    default:
      throw new Error(`GSUB lookup type ${String(type)}`);
  }
}

// ---- contexts, shared by both tables -------------------------------------------

function readLookupRecords(r: Reader, at: number, count: number): { at: number; lookup: number }[] {
  const out: { at: number; lookup: number }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ at: r.u16(at + i * 4), lookup: r.u16(at + 2 + i * 4) });
  }
  return out;
}

function readContext(r: Reader, at: number): ContextRule[] {
  const format = r.u16(at);
  const rules: ContextRule[] = [];

  if (format === 1) {
    const covered = readCoverage(r, at + r.u16(at + 2));
    const setCount = r.u16(at + 4);
    for (let i = 0; i < setCount && i < covered.length; i++) {
      const setOffset = r.u16(at + 6 + i * 2);
      if (setOffset === 0) continue;
      const set = at + setOffset;
      const n = r.u16(set);
      for (let j = 0; j < n; j++) {
        const rule = set + r.u16(set + 2 + j * 2);
        const glyphCountHere = r.u16(rule);
        const lookupCount = r.u16(rule + 2);
        const input: number[][] = [[covered[i]!]];
        for (let k = 1; k < glyphCountHere; k++) input.push([r.u16(rule + 4 + (k - 1) * 2)]);
        const records = rule + 4 + (glyphCountHere - 1) * 2;
        rules.push({
          backtrack: [],
          input,
          lookahead: [],
          lookups: readLookupRecords(r, records, lookupCount),
        });
      }
    }
  } else if (format === 2) {
    const covered = new Set(readCoverage(r, at + r.u16(at + 2)));
    const classes = readClassDef(r, at + r.u16(at + 4));
    const setCount = r.u16(at + 6);
    for (let c = 0; c < setCount; c++) {
      const setOffset = r.u16(at + 8 + c * 2);
      if (setOffset === 0) continue;
      const set = at + setOffset;
      const n = r.u16(set);
      for (let j = 0; j < n; j++) {
        const rule = set + r.u16(set + 2 + j * 2);
        const glyphCountHere = r.u16(rule);
        const lookupCount = r.u16(rule + 2);
        const first = membersOf(classes, c, r.universe()).filter((g) => covered.has(g));
        const input: number[][] = [first];
        for (let k = 1; k < glyphCountHere; k++) {
          input.push(membersOf(classes, r.u16(rule + 4 + (k - 1) * 2), r.universe()));
        }
        const records = rule + 4 + (glyphCountHere - 1) * 2;
        rules.push({
          backtrack: [],
          input,
          lookahead: [],
          lookups: readLookupRecords(r, records, lookupCount),
        });
      }
    }
  } else if (format === 3) {
    const glyphCountHere = r.u16(at + 2);
    const lookupCount = r.u16(at + 4);
    const input: number[][] = [];
    for (let k = 0; k < glyphCountHere; k++)
      input.push(readCoverage(r, at + r.u16(at + 6 + k * 2)));
    const records = at + 6 + glyphCountHere * 2;
    rules.push({
      backtrack: [],
      input,
      lookahead: [],
      lookups: readLookupRecords(r, records, lookupCount),
    });
  } else {
    throw new Error(`context format ${String(format)}`);
  }
  return rules;
}

function readChainContext(r: Reader, at: number): ContextRule[] {
  const format = r.u16(at);
  const rules: ContextRule[] = [];

  const sequence = (from: number, read: (value: number) => number[]) => {
    const n = r.u16(from);
    const out: number[][] = [];
    for (let i = 0; i < n; i++) out.push(read(r.u16(from + 2 + i * 2)));
    return { sets: out, next: from + 2 + n * 2 };
  };

  if (format === 1 || format === 2) {
    const covered = readCoverage(r, at + r.u16(at + 2));
    const coveredSet = new Set(covered);
    let setsAt = at + 4;
    let backClasses = new Map<number, number>();
    let inputClasses = new Map<number, number>();
    let aheadClasses = new Map<number, number>();
    if (format === 2) {
      backClasses = readClassDef(r, at + r.u16(at + 4));
      inputClasses = readClassDef(r, at + r.u16(at + 6));
      aheadClasses = readClassDef(r, at + r.u16(at + 8));
      setsAt = at + 10;
    }
    const setCount = r.u16(setsAt);
    for (let s = 0; s < setCount; s++) {
      const setOffset = r.u16(setsAt + 2 + s * 2);
      if (setOffset === 0) continue;
      if (format === 1 && s >= covered.length) break;
      const set = at + setOffset;
      const n = r.u16(set);
      for (let j = 0; j < n; j++) {
        const rule = set + r.u16(set + 2 + j * 2);
        const pick =
          format === 1
            ? () => (value: number) => [value]
            : (classes: Map<number, number>) => (value: number) =>
                membersOf(classes, value, r.universe());

        const back = sequence(rule, pick(backClasses));
        const inputCount = r.u16(back.next);
        const first =
          format === 1
            ? [covered[s]!]
            : membersOf(inputClasses, s, r.universe()).filter((g) => coveredSet.has(g));
        const input: number[][] = [first];
        for (let k = 1; k < inputCount; k++) {
          input.push(pick(inputClasses)(r.u16(back.next + 2 + (k - 1) * 2)));
        }
        const ahead = sequence(back.next + 2 + (inputCount - 1) * 2, pick(aheadClasses));
        const lookupCount = r.u16(ahead.next);
        rules.push({
          backtrack: back.sets,
          input,
          lookahead: ahead.sets,
          lookups: readLookupRecords(r, ahead.next + 2, lookupCount),
        });
      }
    }
  } else if (format === 3) {
    const coverageAt = (value: number) => readCoverage(r, at + value);
    const back = sequence(at + 2, coverageAt);
    const input = sequence(back.next, coverageAt);
    const ahead = sequence(input.next, coverageAt);
    const lookupCount = r.u16(ahead.next);
    rules.push({
      backtrack: back.sets,
      input: input.sets,
      lookahead: ahead.sets,
      lookups: readLookupRecords(r, ahead.next + 2, lookupCount),
    });
  } else {
    throw new Error(`chained context format ${String(format)}`);
  }
  return rules;
}

// ---- GPOS -----------------------------------------------------------------------

function valueSize(format: number): number {
  let size = 0;
  for (let bit = 0; bit < 8; bit++) if ((format & (1 << bit)) !== 0) size += 2;
  return size;
}

function readValue(r: Reader, at: number, format: number): ValueRecord {
  let offset = at;
  const next = (): number => {
    const value = r.i16(offset);
    offset += 2;
    return value;
  };
  const xPlacement = (format & 0x1) !== 0 ? next() : 0;
  const yPlacement = (format & 0x2) !== 0 ? next() : 0;
  const xAdvance = (format & 0x4) !== 0 ? next() : 0;
  const yAdvance = (format & 0x8) !== 0 ? next() : 0;
  let device = false;
  for (const bit of [0x10, 0x20, 0x40, 0x80]) {
    if ((format & bit) !== 0 && r.u16(offset) !== 0) device = true;
    if ((format & bit) !== 0) offset += 2;
  }
  return { xPlacement, yPlacement, xAdvance, yAdvance, device };
}

function readAnchor(r: Reader, at: number): AnchorPoint {
  const format = r.u16(at);
  const x = r.i16(at + 2);
  const y = r.i16(at + 4);
  if (format === 2) return { x, y, point: r.u16(at + 6), device: false };
  if (format === 3)
    return { x, y, point: null, device: r.u16(at + 6) !== 0 || r.u16(at + 8) !== 0 };
  return { x, y, point: null, device: false };
}

function readMarkArray(
  r: Reader,
  at: number,
  covered: readonly number[],
): { glyph: number; klass: number; anchor: AnchorPoint }[] {
  const count = r.u16(at);
  const out: { glyph: number; klass: number; anchor: AnchorPoint }[] = [];
  for (let i = 0; i < count && i < covered.length; i++) {
    const record = at + 2 + i * 4;
    out.push({
      glyph: covered[i]!,
      klass: r.u16(record),
      anchor: readAnchor(r, at + r.u16(record + 2)),
    });
  }
  return out;
}

function readPositioning(r: Reader, at: number, type: number): Subtable | null {
  const format = r.u16(at);
  switch (type) {
    case 1: {
      const covered = readCoverage(r, at + r.u16(at + 2));
      const valueFormat = r.u16(at + 4);
      if (format === 1) {
        const value = readValue(r, at + 6, valueFormat);
        return { kind: "singlePos", values: covered.map((g) => [g, value] as const) };
      }
      const count = r.u16(at + 6);
      const size = valueSize(valueFormat);
      const values: (readonly [number, ValueRecord])[] = [];
      for (let i = 0; i < count && i < covered.length; i++) {
        values.push([covered[i]!, readValue(r, at + 8 + i * size, valueFormat)]);
      }
      return { kind: "singlePos", values };
    }
    case 2: {
      const covered = readCoverage(r, at + r.u16(at + 2));
      const format1 = r.u16(at + 4);
      const format2 = r.u16(at + 6);
      const size1 = valueSize(format1);
      const size2 = valueSize(format2);
      const pairs: {
        first: number[];
        second: number[];
        one: ValueRecord;
        two: ValueRecord;
        classes: boolean;
      }[] = [];
      if (format === 1) {
        const setCount = r.u16(at + 8);
        for (let i = 0; i < setCount && i < covered.length; i++) {
          const set = at + r.u16(at + 10 + i * 2);
          const n = r.u16(set);
          for (let j = 0; j < n; j++) {
            const record = set + 2 + j * (2 + size1 + size2);
            pairs.push({
              first: [covered[i]!],
              second: [r.u16(record)],
              one: readValue(r, record + 2, format1),
              two: readValue(r, record + 2 + size1, format2),
              classes: false,
            });
          }
        }
      } else if (format === 2) {
        const classes1 = readClassDef(r, at + r.u16(at + 8));
        const classes2 = readClassDef(r, at + r.u16(at + 10));
        const count1 = r.u16(at + 12);
        const count2 = r.u16(at + 14);
        const coveredSet = new Set(covered);
        for (let c1 = 0; c1 < count1; c1++) {
          const first = membersOf(classes1, c1, covered).filter((g) => coveredSet.has(g));
          if (first.length === 0) continue;
          for (let c2 = 0; c2 < count2; c2++) {
            const record = at + 16 + (c1 * count2 + c2) * (size1 + size2);
            const one = readValue(r, record, format1);
            const two = readValue(r, record + size1, format2);
            if (isEmpty(one) && isEmpty(two)) continue;
            // Class 0 of the second glyph is everything else in the font: a
            // rule against it is a rule against every glyph, which is written
            // out only when it says something.
            const second = membersOf(classes2, c2, r.universe());
            if (second.length === 0) continue;
            pairs.push({ first, second, one, two, classes: true });
          }
        }
      } else {
        throw new Error(`pair positioning format ${String(format)}`);
      }
      return { kind: "pairPos", pairs };
    }
    case 3: {
      const covered = readCoverage(r, at + r.u16(at + 2));
      const count = r.u16(at + 4);
      const glyphs: { glyph: number; entry: AnchorPoint | null; exit: AnchorPoint | null }[] = [];
      for (let i = 0; i < count && i < covered.length; i++) {
        const entry = r.u16(at + 6 + i * 4);
        const exit = r.u16(at + 8 + i * 4);
        glyphs.push({
          glyph: covered[i]!,
          entry: entry === 0 ? null : readAnchor(r, at + entry),
          exit: exit === 0 ? null : readAnchor(r, at + exit),
        });
      }
      return { kind: "cursive", glyphs };
    }
    case 4:
    case 6: {
      const marks = readCoverage(r, at + r.u16(at + 2));
      const bases = readCoverage(r, at + r.u16(at + 4));
      const classCount = r.u16(at + 6);
      const markArray = readMarkArray(r, at + r.u16(at + 8), marks);
      const baseArray = at + r.u16(at + 10);
      const n = r.u16(baseArray);
      const baseRecords: { glyph: number; anchors: (AnchorPoint | null)[] }[] = [];
      for (let i = 0; i < n && i < bases.length; i++) {
        const anchors: (AnchorPoint | null)[] = [];
        for (let c = 0; c < classCount; c++) {
          const offset = r.u16(baseArray + 2 + (i * classCount + c) * 2);
          anchors.push(offset === 0 ? null : readAnchor(r, baseArray + offset));
        }
        baseRecords.push({ glyph: bases[i]!, anchors });
      }
      return {
        kind: type === 4 ? "markBase" : "markMark",
        classCount,
        marks: markArray,
        bases: baseRecords,
      };
    }
    case 5: {
      const marks = readCoverage(r, at + r.u16(at + 2));
      const ligs = readCoverage(r, at + r.u16(at + 4));
      const classCount = r.u16(at + 6);
      const markArray = readMarkArray(r, at + r.u16(at + 8), marks);
      const ligArray = at + r.u16(at + 10);
      const n = r.u16(ligArray);
      const ligatures: { glyph: number; components: (AnchorPoint | null)[][] }[] = [];
      for (let i = 0; i < n && i < ligs.length; i++) {
        const attach = ligArray + r.u16(ligArray + 2 + i * 2);
        const componentCount = r.u16(attach);
        const components: (AnchorPoint | null)[][] = [];
        for (let k = 0; k < componentCount; k++) {
          const row: (AnchorPoint | null)[] = [];
          for (let c = 0; c < classCount; c++) {
            const offset = r.u16(attach + 2 + (k * classCount + c) * 2);
            row.push(offset === 0 ? null : readAnchor(r, attach + offset));
          }
          components.push(row);
        }
        ligatures.push({ glyph: ligs[i]!, components });
      }
      return { kind: "markLigature", classCount, marks: markArray, ligatures };
    }
    case 7:
      return { kind: "context", rules: readContext(r, at) };
    case 8:
      return { kind: "context", rules: readChainContext(r, at) };
    default:
      throw new Error(`GPOS lookup type ${String(type)}`);
  }
}

const isEmpty = (v: ValueRecord): boolean =>
  v.xPlacement === 0 && v.yPlacement === 0 && v.xAdvance === 0 && v.yAdvance === 0 && !v.device;

// ---- GDEF -----------------------------------------------------------------------

export function readGdef(bytes: Uint8Array): ReadGdef | null {
  if (bytes.length < 12) return null;
  const r = new Reader(bytes);
  const problems: string[] = [];
  const at = (field: number): number => {
    const offset = r.u16(field);
    return offset;
  };

  try {
    if (r.u16(0) !== 1) return null;
    const minor = r.u16(2);
    const classesAt = at(4);
    const caretsAt = at(8);
    const attachAt = at(10);

    const classes = classesAt === 0 ? new Map<number, number>() : readClassDef(r, classesAt);
    const attach = attachAt === 0 ? new Map<number, number>() : readClassDef(r, attachAt);

    const carets = new Map<number, number[]>();
    if (caretsAt !== 0) {
      const covered = readCoverage(r, caretsAt + r.u16(caretsAt));
      const count = r.u16(caretsAt + 2);
      for (let i = 0; i < count && i < covered.length; i++) {
        const lig = caretsAt + r.u16(caretsAt + 4 + i * 2);
        const n = r.u16(lig);
        const positions: number[] = [];
        for (let j = 0; j < n; j++) {
          const caret = lig + r.u16(lig + 2 + j * 2);
          const format = r.u16(caret);
          if (format === 1 || format === 3) positions.push(r.i16(caret + 2));
          else problems.push("a ligature caret placed on a contour point was not read");
        }
        if (positions.length > 0) carets.set(covered[i]!, positions);
      }
    }

    const markSets: number[][] = [];
    if (minor >= 2 && bytes.length >= 14) {
      const setsAt = r.u16(12);
      if (setsAt !== 0) {
        const count = r.u16(setsAt + 2);
        for (let i = 0; i < count; i++) {
          markSets.push(readCoverage(r, setsAt + r.u32(setsAt + 4 + i * 4)));
        }
      }
    }

    return { classes, attach, markSets, carets, problems };
  } catch (error) {
    return {
      classes: new Map(),
      attach: new Map(),
      markSets: [],
      carets: new Map(),
      problems: [`GDEF could not be read: ${describe(error)}`],
    };
  }
}

export { GPOS, GSUB };
