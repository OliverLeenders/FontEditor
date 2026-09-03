/**
 * Reading kerning out of a font.
 *
 * Two places to look, and both are worth looking in. Modern fonts put kerning in
 * GPOS; older ones use the legacy `kern` table, and plenty of perfectly good
 * fonts still only have that. A font with neither simply has no kerning, which
 * is not an error.
 *
 * Everything here works in glyph *indices*, because that is what the file
 * contains. Names are settled by the importer, which is the only place that
 * knows what each glyph ended up called.
 */

export type SourceKernSide =
  | { readonly kind: "glyph"; readonly glyph: number }
  | { readonly kind: "group"; readonly group: number };

export type SourceKerning = {
  /** Groups as lists of glyph indices, referred to by position. */
  readonly firstGroups: ReadonlyArray<readonly number[]>;
  readonly secondGroups: ReadonlyArray<readonly number[]>;
  readonly pairs: ReadonlyArray<{
    readonly first: SourceKernSide;
    readonly second: SourceKernSide;
    readonly value: number;
  }>;
};

export const NO_KERNING: SourceKerning = { firstGroups: [], secondGroups: [], pairs: [] };

// The parsed shapes opentype.js produces, named here rather than trusted as
// `any`: this walks a structure it does not own, so what is expected is written
// down and anything else is skipped.
type Coverage =
  | { format: 1; glyphs: number[] }
  | { format: 2; ranges: Array<{ start: number; end: number; index: number }> };

type ClassDef =
  | { format: 1; startGlyph: number; classes: number[] }
  | { format: 2; ranges: Array<{ start: number; end: number; classId: number }> };

type ValueRecord = { xAdvance?: number } | undefined;

type PairPos =
  | {
      posFormat: 1;
      coverage: Coverage;
      pairSets: Array<Array<{ secondGlyph: number; value1: ValueRecord }>>;
    }
  | {
      posFormat: 2;
      coverage: Coverage;
      classDef1: ClassDef;
      classDef2: ClassDef;
      class1Count: number;
      class2Count: number;
      classRecords: Array<Array<{ value1: ValueRecord }>>;
    };

type Lookup = { lookupType: number; subtables: PairPos[] };
type Gpos = { lookups?: Lookup[] };

function coveredGlyphs(coverage: Coverage): number[] {
  if (coverage.format === 1) return [...coverage.glyphs];

  const out: number[] = [];
  for (const range of coverage.ranges) {
    for (let g = range.start; g <= range.end; g++) out.push(g);
  }
  return out;
}

/**
 * Every glyph of each class, as the class definition describes them.
 *
 * Class zero is deliberately not collected. It means "everything not otherwise
 * mentioned", which is the whole rest of the font — a group of that is not a
 * group, and a rule against it would be a rule against everything.
 */
function classMembers(def: ClassDef): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const put = (klass: number, glyph: number): void => {
    if (klass === 0) return;
    const list = out.get(klass);
    if (list === undefined) out.set(klass, [glyph]);
    else list.push(glyph);
  };

  if (def.format === 1) {
    def.classes.forEach((klass, i) => put(klass, def.startGlyph + i));
  } else {
    for (const range of def.ranges) {
      for (let g = range.start; g <= range.end; g++) put(range.classId, g);
    }
  }
  return out;
}

const advanceOf = (value: ValueRecord): number => value?.xAdvance ?? 0;

/**
 * Walk GPOS for pair positioning.
 *
 * Only lookup type 2 is read. GPOS carries cursive attachment, mark placement
 * and more besides, none of which this editor models — and reading them as
 * kerning would be worse than not reading them at all.
 */
export function kerningFromGpos(gpos: unknown): SourceKerning {
  const lookups = (gpos as Gpos | undefined)?.lookups;
  if (!Array.isArray(lookups)) return NO_KERNING;

  const firstGroups: number[][] = [];
  const secondGroups: number[][] = [];
  const pairs: Array<{ first: SourceKernSide; second: SourceKernSide; value: number }> = [];

  for (const lookup of lookups) {
    if (lookup.lookupType !== 2 || !Array.isArray(lookup.subtables)) continue;

    for (const subtable of lookup.subtables) {
      if (subtable.posFormat === 1) {
        const covered = coveredGlyphs(subtable.coverage);
        subtable.pairSets.forEach((set, i) => {
          const first = covered[i];
          if (first === undefined || !Array.isArray(set)) return;
          for (const record of set) {
            const value = advanceOf(record.value1);
            if (value === 0) continue;
            pairs.push({
              first: { kind: "glyph", glyph: first },
              second: { kind: "glyph", glyph: record.secondGlyph },
              value,
            });
          }
        });
        continue;
      }

      // Read at its real width before checking. The union above is a claim
      // about what a parsed subtable holds, and it came out of somebody's font
      // — so the guard is against the data, not against the type.
      const format: number = subtable.posFormat;
      if (format !== 2) continue;

      const class1 = classMembers(subtable.classDef1);
      const class2 = classMembers(subtable.classDef2);

      // A class becomes a group, and the index it is given here is what the
      // pairs below refer to.
      const firstIndexOf = new Map<number, number>();
      const secondIndexOf = new Map<number, number>();
      for (const [klass, glyphs] of class1) {
        firstIndexOf.set(klass, firstGroups.length);
        firstGroups.push(glyphs);
      }
      for (const [klass, glyphs] of class2) {
        secondIndexOf.set(klass, secondGroups.length);
        secondGroups.push(glyphs);
      }

      subtable.classRecords.forEach((row, c1) => {
        if (!Array.isArray(row)) return;
        row.forEach((record, c2) => {
          const value = advanceOf(record.value1);
          if (value === 0) return;

          const first = firstIndexOf.get(c1);
          const second = secondIndexOf.get(c2);
          if (first === undefined || second === undefined) return;
          pairs.push({
            first: { kind: "group", group: first },
            second: { kind: "group", group: second },
            value,
          });
        });
      });
    }
  }

  return { firstGroups, secondGroups, pairs };
}

/**
 * The legacy `kern` table, as opentype.js hands it over.
 *
 * A flat map keyed `"left,right"` by glyph index. Read only when GPOS gave
 * nothing, because a font carrying both means the GPOS one — that is the rule
 * shapers follow, and disagreeing with them would import kerning the font does
 * not actually apply.
 */
export function kerningFromKernTable(
  kerningPairs: Readonly<Record<string, number>> | undefined,
): SourceKerning {
  if (kerningPairs === undefined) return NO_KERNING;

  const pairs: Array<{ first: SourceKernSide; second: SourceKernSide; value: number }> = [];
  for (const [key, value] of Object.entries(kerningPairs)) {
    if (value === 0) continue;
    const [left, right] = key.split(",");
    const first = Number(left);
    const second = Number(right);
    if (!Number.isInteger(first) || !Number.isInteger(second)) continue;
    pairs.push({
      first: { kind: "glyph", glyph: first },
      second: { kind: "glyph", glyph: second },
      value,
    });
  }
  return { firstGroups: [], secondGroups: [], pairs };
}
