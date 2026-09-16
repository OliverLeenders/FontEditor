import {
  type FeaGdef,
  type FeaLookup,
  type FeaProblem,
  type FeaRule,
  type FeaSource,
  type FeaStatement,
  parseFea,
} from "./fea.js";
import { singlePos } from "./gpos.js";
import {
  type AlternateSub,
  type LigatureSub,
  type MultipleSub,
  alternateSubst,
  chainContextPos,
  chainContextSubst,
  ligatureSubst,
  multipleSubst,
  reverseChainSubst,
  singleSubst,
} from "./gsub.js";
import {
  DEFAULT_SYSTEMS,
  type FeatureEntry,
  type LanguageSystem,
  type Lookup,
  layoutTable,
  mergeFeatures,
} from "./layout.js";

/**
 * Turning feature source into GSUB, and into the positioning half of GPOS.
 *
 * The step between the reader and the writer, and the only one that knows about
 * the font: a rule names glyphs, and a table holds glyph ids, so this is where
 * a rule about a glyph the font has not got is caught and reported rather than
 * compiled into a lookup that points at nothing.
 *
 * Lookups are grouped the way the feature file language says and fontTools
 * does: consecutive rules of one kind under one set of flags go in one lookup,
 * and a rule of another kind, a new `lookupflag`, a `script` or `language`
 * statement, or a named lookup between them starts the next. Which lookup a rule
 * is in decides the order a shaper applies it in, so grouping them any other way
 * would compile a file to a font that behaves differently from the same file
 * compiled anywhere else.
 */

export type CompiledFeatures = {
  /** GSUB. Empty when nothing compiled, so a caller writes no table rather than an empty one. */
  readonly table: Uint8Array;
  /**
   * The substitution half as well, unwrapped, for a variable font that adds
   * lookups of its own — the designspace's rules — before GSUB is written.
   */
  readonly substitution: {
    readonly entries: readonly FeatureEntry[];
    readonly lookups: readonly Lookup[];
  };
  /**
   * The positioning half, unwrapped.
   *
   * Not a table of its own, because the font's kerning and its mark attachment
   * are positioning too, and all three have to end up in one GPOS. Whoever
   * writes the file puts them together.
   */
  readonly positioning: {
    readonly entries: readonly FeatureEntry[];
    readonly lookups: readonly Lookup[];
  };
  /** The language systems the file declares, which both tables are written for. */
  readonly systems: readonly LanguageSystem[];
  /** Tags that produced at least one working rule, in the order they appeared. */
  readonly tags: readonly string[];
  readonly rules: number;
  /**
   * What the feature file puts into GDEF.
   *
   * A font has one GDEF and two sources for it — the anchors say which glyphs
   * are marks, the file says what its lookup flags mean — so what is collected
   * here is handed back for the export to write together with the anchors'.
   */
  readonly gdef: GdefFromFeatures;
  readonly problems: readonly FeaProblem[];
};

/** The parts of GDEF a feature file can state. */
export type GdefFromFeatures = {
  /** Glyph classes stated outright, which win over the ones anchors imply. */
  readonly classes: ReadonlyMap<number, number>;
  /** Mark attachment classes, as `lookupflag MarkAttachmentType` names them. */
  readonly attach: ReadonlyMap<number, number>;
  /** Mark glyph sets, in the order the lookups refer to them by. */
  readonly markSets: readonly (readonly number[])[];
  /** Where a caret may sit inside a ligature, in design units. */
  readonly carets: ReadonlyMap<number, readonly number[]>;
};

const NO_GDEF: GdefFromFeatures = {
  classes: new Map(),
  attach: new Map(),
  markSets: [],
  carets: new Map(),
};

export const NO_FEATURES: CompiledFeatures = {
  table: new Uint8Array(0),
  substitution: { entries: [], lookups: [] },
  positioning: { entries: [], lookups: [] },
  systems: DEFAULT_SYSTEMS,
  tags: [],
  rules: 0,
  gdef: NO_GDEF,
  problems: [],
};

/**
 * Compile feature source against a font's glyph names.
 *
 * `glyphId` returns `undefined` for a name the font does not have. A rule
 * mentioning one is dropped and reported: the alternative is a lookup that
 * substitutes something for nothing, which a shaper is entitled to render as a
 * missing glyph box in the middle of a word.
 */
export function compileFeatures(
  source: string,
  glyphId: (name: string) => number | undefined,
): CompiledFeatures {
  if (source.trim() === "") return NO_FEATURES;
  return new Compilation(parseFea(source), glyphId).result();
}

type Table = "sub" | "pos";

/** A lookup being filled, rule by rule, until it is written. */
/**
 * A lookup's flags, and which mark glyph set the filtering bit points at.
 *
 * Together because they are one decision: the bit says "only these marks" and
 * the index says which, and neither means anything without the other.
 */
type Flags = { readonly bits: number; readonly set: number | null };

const NO_FLAGS: Flags = { bits: 0, set: null };

type Builder = {
  readonly table: Table;
  readonly type: number;
  readonly flags: Flags;
  readonly index: number;
  readonly singles: Map<number, number>;
  readonly multiples: MultipleSub[];
  readonly alternates: AlternateSub[];
  readonly ligatures: LigatureSub[];
  /** Everything written one subtable per rule: contexts and single adjustments. */
  readonly subtables: Uint8Array[];
};

/**
 * A rule checked against the font and ready to go into a lookup.
 *
 * Checked before any lookup is made for it, so a rule that fails leaves no
 * empty lookup behind. `add` answers how many rules it added, which is fewer
 * than written where a glyph is substituted twice.
 */
type Prepared = {
  readonly table: Table;
  readonly type: number;
  readonly add: (into: Builder) => number;
};

type Context = {
  readonly backtrack: number[][];
  readonly input: number[][];
  readonly lookahead: number[][];
};

class Compilation {
  private readonly problems: FeaProblem[];
  private rules = 0;
  private readonly slots: Record<Table, (Builder | Lookup)[]> = { sub: [], pos: [] };
  /** Named lookups by name; `null` for one that compiled to nothing. */
  private readonly named = new Map<string, { table: Table; index: number } | null>();
  private readonly entries: Record<Table, FeatureEntry[]> = { sub: [], pos: [] };
  private readonly tags: string[] = [];
  private readonly systems: readonly LanguageSystem[];
  /** What the file says GDEF should hold; see {@link GdefFromFeatures}. */
  private readonly gdefClasses = new Map<number, number>();
  private readonly attachClasses = new Map<number, number>();
  private readonly markSets: number[][] = [];
  /** The classes and sets already made, so that naming the same marks twice makes one. */
  private readonly attachNamed = new Map<string, number>();
  private readonly markSetNamed = new Map<string, number>();
  private readonly carets = new Map<number, number[]>();

  constructor(
    parsed: FeaSource,
    private readonly glyphId: (name: string) => number | undefined,
  ) {
    this.problems = [...parsed.problems];
    this.systems = parsed.languageSystems.length > 0 ? parsed.languageSystems : DEFAULT_SYSTEMS;
    for (const block of parsed.blocks) {
      if (block.kind === "lookup") this.lookupBlock(block.lookup);
      else this.feature(block.feature.tag, block.feature.statements);
    }
    if (parsed.gdef !== null) this.gdefBlock(parsed.gdef);
  }

  result(): CompiledFeatures {
    const lookups = (table: Table): Lookup[] =>
      this.slots[table].map((slot) => ("singles" in slot ? written(slot) : slot));
    return {
      table: layoutTable(mergeFeatures(this.entries.sub, []), lookups("sub"), this.systems),
      substitution: { entries: mergeFeatures(this.entries.sub, []), lookups: lookups("sub") },
      positioning: { entries: mergeFeatures(this.entries.pos, []), lookups: lookups("pos") },
      systems: this.systems,
      tags: this.tags,
      rules: this.rules,
      gdef: {
        classes: this.gdefClasses,
        attach: this.attachClasses,
        markSets: this.markSets,
        carets: this.carets,
      },
      problems: this.problems,
    };
  }

  /**
   * A feature: its rules into lookups, and each lookup into the languages the
   * statements before it name.
   *
   * Before any `script` statement a lookup applies in every language system the
   * file declares. After `script latn;` it applies to Latin's default language,
   * and after `language TRK;` to Turkish — which also takes the lookups Latin's
   * default had until then, unless the statement says `exclude_dflt`.
   */
  private feature(tag: string, statements: readonly FeaStatement[]): void {
    let flags = NO_FLAGS;
    let current: Builder | null = null;
    let script: string | null = null;
    let target: LanguageSystem | null = null;
    const scriptDefaults = new Map<string, { table: Table; index: number }[]>();

    const register = (table: Table, index: number): void => {
      this.entries[table].push(
        target === null ? { tag, lookups: [index] } : { tag, lookups: [index], system: target },
      );
      if (target !== null && target.language === "dflt") {
        const list = scriptDefaults.get(target.script) ?? [];
        list.push({ table, index });
        scriptDefaults.set(target.script, list);
      }
      if (!this.tags.includes(tag)) this.tags.push(tag);
    };

    for (const statement of statements) {
      switch (statement.kind) {
        case "rule": {
          const prepared = this.prepare(statement.rule, flags);
          if (prepared === null) break;
          if (current?.table !== prepared.table || current.type !== prepared.type) {
            current = this.builder(prepared.table, prepared.type, flags);
            register(current.table, current.index);
          }
          this.rules += prepared.add(current);
          break;
        }
        case "flags":
          flags = this.flagsOf(statement);
          current = null;
          break;
        case "script":
          script = statement.script;
          target = { script, language: "dflt" };
          current = null;
          break;
        case "language": {
          script ??= "DFLT";
          target = { script, language: statement.language };
          current = null;
          if (statement.includeDefault && statement.language !== "dflt") {
            for (const known of scriptDefaults.get(script) ?? []) {
              register(known.table, known.index);
            }
          }
          break;
        }
        case "lookup": {
          const found = this.named.get(statement.name);
          if (found === undefined) {
            this.problems.push({
              line: statement.line,
              message: `lookup ${statement.name} is used before it is defined`,
            });
          } else if (found !== null) {
            register(found.table, found.index);
          }
          current = null;
          break;
        }
        case "block": {
          this.lookupBlock(statement.lookup);
          const found = this.named.get(statement.lookup.name);
          if (found) register(found.table, found.index);
          current = null;
          break;
        }
      }
    }
  }

  /**
   * A named lookup: every rule in one lookup, under the flags it starts with.
   *
   * Its rules have to be of one kind — a lookup has one type — and its flags
   * come before them, since one lookup has one set.
   */
  private lookupBlock(lookup: FeaLookup): void {
    if (this.named.has(lookup.name)) {
      this.problems.push({
        line: lookup.line,
        message: `lookup ${lookup.name} is defined more than once`,
      });
      return;
    }

    let flags = NO_FLAGS;
    let builder: Builder | null = null;
    let ruled = false;
    for (const statement of lookup.statements) {
      if (statement.kind === "flags") {
        if (ruled) {
          this.problems.push({
            line: statement.line,
            message: `lookupflag comes before the rules of lookup ${lookup.name}`,
          });
        } else flags = this.flagsOf(statement);
        continue;
      }
      if (statement.kind !== "rule") continue;
      ruled = true;

      const prepared = this.prepare(statement.rule, flags);
      if (prepared === null) continue;
      if (builder === null) {
        builder = this.builder(prepared.table, prepared.type, flags);
      } else if (builder.table !== prepared.table || builder.type !== prepared.type) {
        this.problems.push({
          line: statement.rule.line,
          message: `lookup ${lookup.name} holds one kind of rule, and this is a different kind`,
        });
        continue;
      }
      this.rules += prepared.add(builder);
    }
    this.named.set(
      lookup.name,
      builder === null ? null : { table: builder.table, index: builder.index },
    );
  }

  /**
   * What `table GDEF` stated: glyph classes, and ligature carets.
   *
   * The classes here win over the ones the anchors imply, since a file that
   * says a glyph is a ligature is saying something the anchors cannot. A glyph
   * the font has not got is passed over, as it is in a rule.
   */
  private gdefBlock(gdef: FeaGdef): void {
    const kinds = [
      [gdef.base, 1],
      [gdef.ligature, 2],
      [gdef.mark, 3],
      [gdef.component, 4],
    ] as const;
    for (const [names, value] of kinds) {
      for (const name of names) {
        const id = this.glyphId(name);
        if (id !== undefined) this.gdefClasses.set(id, value);
      }
    }

    for (const [name, positions] of gdef.carets) {
      const id = this.glyphId(name);
      if (id !== undefined) this.carets.set(id, [...positions]);
    }
  }

  /**
   * A lookupflag statement, with the marks it names resolved into GDEF.
   *
   * An attachment class is a number the flag carries in its high byte, and a
   * font has 255 of them; a filtering set is an index into a list GDEF holds,
   * and there may be as many as the file asks for. Naming the same marks twice
   * gives the same class or set back, since two identical ones would be two
   * answers to one question.
   */
  private flagsOf(statement: Extract<FeaStatement, { kind: "flags" }>): Flags {
    let bits = statement.flags;
    let set: number | null = null;

    if (statement.attach !== null) {
      const ids = this.idsOf(statement.attach, statement.line);
      if (ids !== null) {
        const key = [...ids].sort((a, b) => a - b).join(",");
        let index = this.attachNamed.get(key);
        if (index === undefined && this.attachNamed.size >= 255) {
          this.problems.push({
            line: statement.line,
            message: "a font has 255 mark attachment classes, and this is one more",
          });
        } else if (index === undefined) {
          index = this.attachNamed.size + 1;
          this.attachNamed.set(key, index);
          for (const id of ids) this.attachClasses.set(id, index);
        }
        if (index !== undefined) bits |= index << 8;
      }
    }

    if (statement.filtering !== null) {
      const ids = this.idsOf(statement.filtering, statement.line);
      if (ids !== null) {
        const key = [...ids].sort((a, b) => a - b).join(",");
        let index = this.markSetNamed.get(key);
        if (index === undefined) {
          index = this.markSets.length;
          this.markSetNamed.set(key, index);
          this.markSets.push([...ids]);
        }
        bits |= 0x0010;
        set = index;
      }
    }

    return { bits, set };
  }

  private builder(table: Table, type: number, flags: Flags): Builder {
    const builder: Builder = {
      table,
      type,
      flags,
      index: this.slots[table].length,
      singles: new Map(),
      multiples: [],
      alternates: [],
      ligatures: [],
      subtables: [],
    };
    this.slots[table].push(builder);
    return builder;
  }

  /** Put a finished lookup in a table's list, and say where. */
  private append(table: Table, lookup: Lookup): number {
    this.slots[table].push(lookup);
    return this.slots[table].length - 1;
  }

  /** Glyph ids for names, or `null` and a problem for each name the font has not got. */
  private idsOf(names: readonly string[], line: number): number[] | null {
    const missing = [...new Set(names.filter((name) => this.glyphId(name) === undefined))];
    for (const name of missing) {
      this.problems.push({ line, message: `there is no glyph called ${name}` });
    }
    return missing.length > 0 ? null : names.map((name) => this.glyphId(name)!);
  }

  /**
   * Every position of a context as glyph ids.
   *
   * Every name, including the ones that are only conditions: a context naming a
   * glyph that is not there can never match, and a rule that can never match is
   * a rule the file claims and the font does not have.
   */
  private contextOf(rule: {
    readonly backtrack: readonly (readonly string[])[];
    readonly input: readonly (readonly string[])[];
    readonly lookahead: readonly (readonly string[])[];
    readonly line: number;
  }): Context | null {
    const all = [...rule.backtrack, ...rule.input, ...rule.lookahead].flat();
    if (this.idsOf(all, rule.line) === null) return null;
    const ids = (sets: readonly (readonly string[])[]) =>
      sets.map((set) => set.map((name) => this.glyphId(name)!));
    return {
      backtrack: ids(rule.backtrack),
      input: ids(rule.input),
      lookahead: ids(rule.lookahead),
    };
  }

  /** The lookup a contextual rule calls by name, which has to be in the same table. */
  private called(name: string, table: Table, line: number): number | null {
    const found = this.named.get(name);
    if (found === undefined) {
      this.problems.push({ line, message: `lookup ${name} is used before it is defined` });
      return null;
    }
    if (found === null) {
      this.problems.push({
        line,
        message: `lookup ${name} compiled to nothing, so this rule calls nothing`,
      });
      return null;
    }
    if (found.table !== table) {
      this.problems.push({
        line,
        message:
          table === "sub"
            ? `lookup ${name} positions glyphs, and a substitution cannot call it`
            : `lookup ${name} substitutes glyphs, and a positioning rule cannot call it`,
      });
      return null;
    }
    return found.index;
  }

  /** Resolve the named lookups a rule calls at each marked position; `null` if one cannot be. */
  private callsOf(
    calls: readonly (string | null)[] | null,
    table: Table,
    line: number,
  ): (number | null)[] | null {
    if (calls === null) return [];
    const out: (number | null)[] = [];
    for (const name of calls) {
      if (name === null) {
        out.push(null);
        continue;
      }
      const index = this.called(name, table, line);
      if (index === null) return null;
      out.push(index);
    }
    return out;
  }

  private prepare(rule: FeaRule, flags: Flags): Prepared | null {
    switch (rule.kind) {
      case "single": {
        const pairs: { from: number; to: number; name: string }[] = [];
        for (const [i, from] of rule.from.entries()) {
          const ids = this.idsOf([from, rule.to[i]!], rule.line);
          if (ids !== null) pairs.push({ from: ids[0]!, to: ids[1]!, name: from });
        }
        if (pairs.length === 0) return null;
        return {
          table: "sub",
          type: 1,
          add: (into) => {
            let added = 0;
            for (const pair of pairs) {
              // A glyph substituted twice in one lookup is a rule that
              // contradicts an earlier one, and the table can hold only one answer.
              if (into.singles.has(pair.from)) {
                this.problems.push({
                  line: rule.line,
                  message: `${pair.name} is already substituted in this lookup`,
                });
                continue;
              }
              into.singles.set(pair.from, pair.to);
              added += 1;
            }
            return added;
          },
        };
      }

      case "multiple": {
        const ids = this.idsOf([rule.from, ...rule.to], rule.line);
        if (ids === null) return null;
        const [from, ...to] = ids as [number, ...number[]];
        return {
          table: "sub",
          type: 2,
          add: (into) => {
            if (into.multiples.some((m) => m.from === from)) {
              this.problems.push({
                line: rule.line,
                message: `${rule.from} is already substituted in this lookup`,
              });
              return 0;
            }
            into.multiples.push({ from, to });
            return 1;
          },
        };
      }

      case "alternate": {
        const ids = this.idsOf([rule.from, ...rule.alternates], rule.line);
        if (ids === null) return null;
        const [from, ...alternates] = ids as [number, ...number[]];
        return {
          table: "sub",
          type: 3,
          add: (into) => {
            if (into.alternates.some((a) => a.from === from)) {
              this.problems.push({
                line: rule.line,
                message: `${rule.from} already has alternates in this lookup`,
              });
              return 0;
            }
            into.alternates.push({ from, alternates });
            return 1;
          },
        };
      }

      case "ligature": {
        const ids = this.idsOf([...rule.from, rule.to], rule.line);
        if (ids === null) return null;
        const to = ids.pop()!;
        return {
          table: "sub",
          type: 4,
          add: (into) => {
            into.ligatures.push({ from: ids, to });
            return 1;
          },
        };
      }

      case "position": {
        const ids = this.idsOf(rule.glyphs, rule.line);
        if (ids === null) return null;
        return {
          table: "pos",
          type: 1,
          // One subtable per rule rather than one for the lookup: two rules can
          // name the same glyph with different values, and a subtable can hold
          // only one answer. Tried in order, so the first one written wins.
          add: (into) => {
            into.subtables.push(singlePos(ids, rule.value));
            return 1;
          },
        };
      }

      case "reverse": {
        // The context is read as any other is, with the one replaced glyph as
        // the whole of the input.
        const context = this.contextOf({ ...rule, input: [rule.from] });
        const to = this.idsOf(rule.to, rule.line);
        if (context === null || to === null) return null;
        const from = context.input[0] ?? [];
        return {
          table: "sub",
          type: 8,
          // One subtable per rule, as a contextual rule has: each carries its
          // own context, and a shaper tries them in the order they were written.
          add: (into) => {
            into.subtables.push(
              reverseChainSubst({
                backtrack: context.backtrack,
                lookahead: context.lookahead,
                pairs: from.map((id, index) => ({ from: id, to: to[index]! })),
              }),
            );
            return 1;
          },
        };
      }

      case "chain": {
        const context = this.contextOf(rule);
        if (context === null) return null;
        const calls = this.callsOf(rule.calls, "sub", rule.line);
        if (calls === null) return null;

        let nested: Lookup | null = null;
        if (!rule.ignore && rule.calls === null) {
          const to = this.idsOf(rule.to ?? [], rule.line);
          if (to === null) return null;
          nested = nestedSubstitution(context.input, to, rule.multiple, flags);
          if (nested === null) {
            this.problems.push({ line: rule.line, message: "this rule replaces nothing" });
            return null;
          }
        }
        const replacement = nested;

        return {
          table: "sub",
          type: 6,
          add: (into) => {
            // Each contextual rule is a subtable of its own, tried in the order
            // written, and carries a pointer at an ordinary lookup holding the
            // substitution — the table has no way to write the replacement into
            // the rule. The lookup it points at goes after the one holding the
            // rule, which is where fontTools puts it too.
            const actions: { at: number; lookup: number }[] = [];
            if (replacement !== null)
              actions.push({ at: 0, lookup: this.append("sub", replacement) });
            calls.forEach((lookup, at) => {
              if (lookup !== null) actions.push({ at, lookup });
            });
            into.subtables.push(chainContextSubst({ ...context, actions }));
            return 1;
          },
        };
      }

      case "contextPosition": {
        const context = this.contextOf(rule);
        if (context === null) return null;
        const calls = this.callsOf(rule.calls, "pos", rule.line);
        if (calls === null) return null;

        return {
          table: "pos",
          type: 8,
          add: (into) => {
            const actions: { at: number; lookup: number }[] = [];
            rule.values.forEach((value, at) => {
              if (value === null) return;
              const adjustment: Lookup = {
                type: 1,
                subtables: [singlePos(context.input[at]!, value)],
              };
              actions.push({
                at,
                lookup: this.append("pos", under(adjustment, flags)),
              });
            });
            calls.forEach((lookup, at) => {
              if (lookup !== null) actions.push({ at, lookup });
            });
            into.subtables.push(chainContextPos({ ...context, actions }));
            return 1;
          },
        };
      }
    }
  }
}

/** A lookup as the table stores it. */
function written(builder: Builder): Lookup {
  const subtables =
    builder.table === "pos" || builder.type === 6 || builder.type === 8
      ? builder.subtables
      : builder.type === 1
        ? [singleSubst({ from: [...builder.singles.keys()], to: [...builder.singles.values()] })]
        : builder.type === 2
          ? [multipleSubst(builder.multiples)]
          : builder.type === 3
            ? [alternateSubst(builder.alternates)]
            : [ligatureSubst(builder.ligatures)];
  return under({ type: builder.type, subtables }, builder.flags);
}

/** A lookup under a set of flags, and under the mark set they may point at. */
function under(lookup: Lookup, flags: Flags): Lookup {
  if (flags.bits === 0) return lookup;
  return flags.set === null
    ? { ...lookup, flags: flags.bits }
    : { ...lookup, flags: flags.bits, markFilteringSet: flags.set };
}

/**
 * The ordinary lookup a contextual substitution points at.
 *
 * One marked position is a swap of each of its glyphs, or with `multiple` its
 * one glyph replaced by several; several are a ligature of the run. The same
 * shapes a plain rule has, which is the whole idea: the context is a condition
 * on a rule, not a different kind of rule.
 */
function nestedSubstitution(
  input: readonly (readonly number[])[],
  to: readonly number[],
  multiple: boolean,
  flags: Flags,
): Lookup | null {
  if (input.length === 0 || to.length === 0) return null;
  const withFlags = (lookup: Lookup): Lookup => under(lookup, flags);

  if (multiple) {
    const from = input[0]?.[0];
    if (from === undefined) return null;
    return withFlags({ type: 2, subtables: [multipleSubst([{ from, to }])] });
  }

  if (input.length === 1) {
    const from = input[0]!;
    if (from.length === 0) return null;
    // One name replaces every glyph of the position; a list pairs off with it,
    // which the reader has already checked the lengths of.
    const replacements = to.length === 1 ? from.map(() => to[0]!) : [...to];
    if (replacements.length !== from.length) return null;
    return withFlags({ type: 1, subtables: [singleSubst({ from, to: replacements })] });
  }

  if (to.length !== 1 || input.some((set) => set.length !== 1)) return null;
  const subtable = ligatureSubst([{ from: input.map((set) => set[0]!), to: to[0]! }]);
  return subtable.length === 0 ? null : withFlags({ type: 4, subtables: [subtable] });
}
