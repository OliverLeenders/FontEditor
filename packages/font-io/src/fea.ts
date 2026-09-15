import type { LanguageSystem } from "./layout.js";

/**
 * A reader for the part of `.fea` that this editor compiles.
 *
 * What is here is what a font being drawn leans on: glyph classes; every
 * ordinary substitution — one glyph for another, one for several, one of a set
 * of alternates, a run for one — and the same again in a context, which is what
 * `calt` is; the single adjustment, and the same in a context; named lookups,
 * called from a feature or from a contextual rule, and the flags that make a
 * lookup skip marks or ligatures; and the scripts and languages a feature
 * behaves differently in.
 *
 * Two parts are deliberate omissions, each because the editor already keeps
 * the same thing somewhere a second way to write it here would contradict.
 * Kerning is a pair adjustment, and has the Spacing workspace. Mark attachment
 * is where the glyphs' anchors say, and the anchors are its only source.
 *
 * Anything else is refused *by name*, with the line it was on, rather than
 * skipped. A feature file that silently compiled to less than it says is worse
 * than one that will not compile: the first ships a font that does not do what
 * its source claims.
 */

export type FeaRule =
  | {
      readonly kind: "single";
      /** Equal-length lists: each glyph maps to the one beside it. */
      readonly from: readonly string[];
      readonly to: readonly string[];
      readonly line: number;
    }
  | {
      /** One glyph into several: `sub f_i by f i;`. */
      readonly kind: "multiple";
      readonly from: string;
      readonly to: readonly string[];
      readonly line: number;
    }
  | {
      /** A glyph and the alternates an application may offer: `sub a from [a.1 a.2];`. */
      readonly kind: "alternate";
      readonly from: string;
      readonly alternates: readonly string[];
      readonly line: number;
    }
  | {
      readonly kind: "ligature";
      readonly from: readonly string[];
      readonly to: string;
      readonly line: number;
    }
  | {
      /**
       * A substitution that only happens in a context: `sub a b' c by b.alt;`.
       *
       * Three runs of positions, each position the set of glyphs allowed there.
       * `backtrack` is what must precede the match and `lookahead` what must
       * follow; neither is replaced, and both are written in reading order here
       * however the table stores them.
       */
      readonly kind: "chain";
      readonly backtrack: readonly (readonly string[])[];
      readonly input: readonly (readonly string[])[];
      readonly lookahead: readonly (readonly string[])[];
      /**
       * What the marked run becomes.
       *
       * One name replaces the whole run — a ligature where the run is longer
       * than one glyph, a plain swap where it is not. A list pairs off with the
       * glyphs of a single marked position, or with `multiple` replaces its one
       * glyph with all of them. `null` where the rule replaces nothing itself:
       * an `ignore` rule, or one that calls named lookups.
       */
      readonly to: readonly string[] | null;
      readonly multiple: boolean;
      /** The named lookup each marked position calls, if the rule calls any. */
      readonly calls: readonly (string | null)[] | null;
      readonly ignore: boolean;
      readonly line: number;
    }
  | {
      /**
       * A single adjustment: `pos @caps <10 0 20 0>;`.
       *
       * Moves the glyph, or changes what follows it, or both. The four numbers
       * are the format's own order — where the glyph is drawn, then how far the
       * pen moves afterwards — and a bare number is the third of them, which is
       * what `pos a 40;` means.
       */
      readonly kind: "position";
      readonly glyphs: readonly string[];
      readonly value: ValueRecord;
      readonly line: number;
    }
  | {
      /**
       * A single adjustment that only happens in a context: `pos T a' -20 b;`.
       *
       * The same three runs as a contextual substitution. Each marked position
       * carries the value it is adjusted by, or the named lookup it calls, or
       * neither; an `ignore` rule carries nothing.
       */
      readonly kind: "contextPosition";
      readonly backtrack: readonly (readonly string[])[];
      readonly input: readonly (readonly string[])[];
      readonly lookahead: readonly (readonly string[])[];
      readonly values: readonly (ValueRecord | null)[];
      readonly calls: readonly (string | null)[];
      readonly ignore: boolean;
      readonly line: number;
    };

/** Where a glyph is drawn and how far the pen moves after it, in design units. */
export type ValueRecord = {
  readonly x: number;
  readonly y: number;
  readonly xAdvance: number;
  readonly yAdvance: number;
};

/**
 * Something said inside a feature or a lookup block, in the order it was said.
 *
 * Order matters to everything but classes: which lookup a rule joins depends
 * on the rules and flags before it, and which languages it applies in depends
 * on the last `script` and `language` statements.
 */
export type FeaStatement =
  | { readonly kind: "rule"; readonly rule: FeaRule }
  | { readonly kind: "flags"; readonly flags: number; readonly line: number }
  | { readonly kind: "script"; readonly script: string; readonly line: number }
  | {
      readonly kind: "language";
      readonly language: string;
      /** Whether the script's default lookups apply here too, which they do unless `exclude_dflt`. */
      readonly includeDefault: boolean;
      readonly line: number;
    }
  /** `lookup NAME;` inside a feature: a lookup defined elsewhere, used here. */
  | { readonly kind: "lookup"; readonly name: string; readonly line: number }
  /** `lookup NAME { … } NAME;` inside a feature: defined here, and used here. */
  | { readonly kind: "block"; readonly lookup: FeaLookup };

/** A named lookup: rules of one kind under one set of flags, callable by name. */
export type FeaLookup = {
  readonly name: string;
  /** Rules and flags only. */
  readonly statements: readonly FeaStatement[];
  readonly rules: readonly FeaRule[];
  readonly line: number;
};

export type FeaFeature = {
  /** The four-character tag, such as `liga`. */
  readonly tag: string;
  readonly statements: readonly FeaStatement[];
  /**
   * Every rule the feature applies, in order: its own, those of lookups it
   * defines, and those of the named lookups it uses. For a reader that only
   * wants the rules and not how they are grouped.
   */
  readonly rules: readonly FeaRule[];
  readonly line: number;
};

/** A feature or a named lookup at the top of the file, in the order they came. */
export type FeaBlock =
  | { readonly kind: "feature"; readonly feature: FeaFeature }
  | { readonly kind: "lookup"; readonly lookup: FeaLookup };

export type FeaProblem = {
  /** One-based, so it matches what an editor shows in its gutter. */
  readonly line: number;
  readonly message: string;
};

export type FeaSource = {
  readonly features: readonly FeaFeature[];
  /** Named lookups defined at the top of the file, outside any feature. */
  readonly lookups: readonly FeaLookup[];
  /** Features and top-level lookups together, in file order, which is the order they compile in. */
  readonly blocks: readonly FeaBlock[];
  /** The `languagesystem` statements, in order; empty where there are none. */
  readonly languageSystems: readonly LanguageSystem[];
  readonly classes: ReadonlyMap<string, readonly string[]>;
  readonly problems: readonly FeaProblem[];
};

export type Token = {
  readonly text: string;
  readonly line: number;
};

/** Everything that is a token boundary or a token in its own right. */
const PUNCTUATION = new Set(["[", "]", ";", "=", "{", "}", "'", ",", "<", ">"]);

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let at = 0;

  while (at < source.length) {
    const ch = source[at]!;

    if (ch === "\n") {
      line += 1;
      at += 1;
      continue;
    }
    if (ch === "#") {
      // A comment runs to the end of the line, and the newline is left for the
      // branch above to count.
      while (at < source.length && source[at] !== "\n") at += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      at += 1;
      continue;
    }
    if (PUNCTUATION.has(ch)) {
      tokens.push({ text: ch, line });
      at += 1;
      continue;
    }

    let end = at;
    while (end < source.length && !/\s/.test(source[end]!) && !PUNCTUATION.has(source[end]!)) {
      end += 1;
    }
    tokens.push({ text: source.slice(at, end), line });
    at = end;
  }

  return tokens;
}

/** The lookup flags that are a bit each, by the names the language gives them. */
const FLAG_BITS: ReadonlyMap<string, number> = new Map([
  ["RightToLeft", 1],
  ["IgnoreBaseGlyphs", 2],
  ["IgnoreLigatures", 4],
  ["IgnoreMarks", 8],
]);

/** Refused here because each is somewhere else in the editor, or needs a table this does not write. */
const REFUSED_AT_TOP: ReadonlyMap<string, string> = new Map([
  [
    "markClass",
    "mark attachment is where the glyphs' anchors say, and is not compiled from the feature file",
  ],
  ["table", "tables written in the feature file are not compiled by this editor"],
  ["include", "including another feature file is not compiled by this editor"],
  ["anchorDef", "named anchors are not compiled by this editor"],
  ["valueRecordDef", "named value records are not compiled by this editor"],
  ["conditionset", "variable-font conditions are not compiled by this editor"],
  ["variation", "variable-font conditions are not compiled by this editor"],
]);

export type Reader = {
  readonly peek: () => Token | undefined;
  /** The token `n` places after the next one, taking nothing. */
  readonly ahead: (n: number) => Token | undefined;
  readonly take: () => Token | undefined;
  readonly complain: (line: number, message: string) => void;
  readonly classes: Map<string, readonly string[]>;
  /** The top-level named lookups read so far, for a feature that uses one by name. */
  readonly lookups: Map<string, FeaLookup>;
};

/** A reader over tokens, which reports into `problems`. */
export function readerOver(tokens: readonly Token[], problems: FeaProblem[]): Reader {
  let at = 0;
  return {
    peek: () => tokens[at],
    ahead: (n) => tokens[at + n],
    take: () => tokens[at++],
    complain: (line, message) => {
      problems.push({ line, message });
    },
    classes: new Map(),
    lookups: new Map(),
  };
}

/**
 * Read a feature file.
 *
 * Always returns something. A file with problems still yields the features that
 * did parse, so an editor can show what works and what does not at the same
 * time — and so one bad line does not blank the panel.
 */
export function parseFea(source: string): FeaSource {
  const tokens = tokenize(source);
  const problems: FeaProblem[] = [];
  const features: FeaFeature[] = [];
  const lookups: FeaLookup[] = [];
  const blocks: FeaBlock[] = [];
  const languageSystems: LanguageSystem[] = [];

  const r = readerOver(tokens, problems);

  while (r.peek() !== undefined) {
    const token = r.take();
    if (token === undefined) break;

    if (token.text === ";") continue;

    if (token.text === "languagesystem") {
      const script = r.take();
      const language = r.take();
      if (script === undefined || language === undefined || !isTag(script) || !isTag(language)) {
        r.complain(token.line, "a languagesystem names a script tag and a language tag");
        skipStatement(r);
        continue;
      }
      languageSystems.push({ script: script.text, language: language.text });
      if (r.peek()?.text === ";") r.take();
      continue;
    }

    if (token.text.startsWith("@")) {
      const named = readClassDefinition(token, r);
      if (!named) skipStatement(r);
      continue;
    }

    if (token.text === "feature") {
      const feature = readFeature(token, r);
      if (feature !== null) {
        features.push(feature);
        blocks.push({ kind: "feature", feature });
      }
      continue;
    }

    if (token.text === "lookup") {
      const lookup = readLookupBlock(token, r);
      if (lookup !== null) {
        if (r.lookups.has(lookup.name)) {
          r.complain(token.line, `lookup ${lookup.name} is defined more than once`);
        } else {
          r.lookups.set(lookup.name, lookup);
          lookups.push(lookup);
          blocks.push({ kind: "lookup", lookup });
        }
      }
      continue;
    }

    const refused = REFUSED_AT_TOP.get(token.text);
    r.complain(token.line, refused ?? `"${token.text}" is not something this editor understands`);
    skipStatementOrBlock(r);
  }

  return { features, lookups, blocks, languageSystems, classes: r.classes, problems };
}

export const isTag = (token: Token): boolean => /^[A-Za-z0-9 _]{1,4}$/.test(token.text);

/** Skip to just past the next `;`, which is how a bad statement is escaped. */
function skipStatement(r: Reader): void {
  for (let token = r.take(); token !== undefined; token = r.take()) {
    if (token.text === ";") return;
  }
}

/**
 * Skip a statement, or a whole block with its name and `;` after it.
 *
 * A refused `table GDEF { … } GDEF;` has to be stepped over whole, or its
 * insides are read as statements of their own and reported line by line.
 */
export function skipStatementOrBlock(r: Reader): void {
  let depth = 0;
  for (let token = r.take(); token !== undefined; token = r.take()) {
    if (token.text === "{") depth += 1;
    else if (token.text === "}") {
      depth -= 1;
      if (depth === 0) {
        // The name after the brace, then the semicolon.
        if (r.peek() !== undefined && r.peek()!.text !== ";") r.take();
        if (r.peek()?.text === ";") r.take();
        return;
      }
    } else if (token.text === ";" && depth === 0) return;
  }
}

/** Skip the rest of a statement inside a block, stopping short of the block's end. */
export function skipInside(r: Reader): void {
  while (r.peek() !== undefined && r.peek()!.text !== ";" && r.peek()!.text !== "}") r.take();
  if (r.peek()?.text === ";") r.take();
}

export function readClassDefinition(name: Token, r: Reader): boolean {
  const equals = r.take();
  if (equals?.text !== "=") {
    r.complain(name.line, `expected "=" after the class ${name.text}`);
    return false;
  }

  const list = readGlyphList(name.line, r);
  if (list === null) return false;
  const members = list.glyphs;

  const semi = r.take();
  if (semi?.text !== ";") r.complain(name.line, `expected ";" after the class ${name.text}`);

  if (r.classes.has(name.text)) r.complain(name.line, `${name.text} is defined more than once`);
  r.classes.set(name.text, members);
  return true;
}

/** Glyphs, and whether they were written as one name or as a set of them. */
type GlyphList = {
  readonly glyphs: string[];
  /**
   * True for a class or a bracketed list.
   *
   * Kept because `sub @A by X` and `sub @A by @B` mean different things and look
   * the same once the classes are expanded. The first replaces every glyph in
   * @A with X, which is legal and useful; the second pairs them off, and two
   * classes of different lengths cannot be paired. Without this the second
   * quietly becomes the first — which is the failure this reader exists to
   * avoid, a file compiling to something other than what it says.
   */
  readonly plural: boolean;
};

/**
 * A bracketed list, a bare class reference, or a single glyph.
 *
 * Classes are expanded where they are used rather than kept as references. A
 * rule wants the glyphs; nothing downstream has any use for the name.
 */
export function readGlyphList(line: number, r: Reader): GlyphList | null {
  const first = r.peek();
  if (first === undefined) {
    r.complain(line, "the file ends in the middle of a rule");
    return null;
  }

  if (first.text !== "[") {
    r.take();
    if (first.text.startsWith("@")) {
      const members = r.classes.get(first.text);
      if (members === undefined) {
        r.complain(first.line, `${first.text} is used before it is defined`);
        return null;
      }
      return { glyphs: [...members], plural: true };
    }
    return { glyphs: [first.text], plural: false };
  }

  r.take(); // the "["
  const out: string[] = [];
  for (;;) {
    const token = r.take();
    if (token === undefined) {
      r.complain(line, "a glyph list is never closed");
      return null;
    }
    if (token.text === "]") break;
    if (token.text === ",") continue;

    if (token.text.startsWith("@")) {
      const members = r.classes.get(token.text);
      if (members === undefined) {
        r.complain(token.line, `${token.text} is used before it is defined`);
        return null;
      }
      out.push(...members);
      continue;
    }
    out.push(token.text);
  }
  return { glyphs: out, plural: true };
}

/** Refused inside a feature, each by what it is. */
const REFUSED_IN_FEATURE: ReadonlyMap<string, string> = new Map([
  ["rsub", "reverse chaining substitution is not compiled by this editor"],
  ["reversesub", "reverse chaining substitution is not compiled by this editor"],
  [
    "enum",
    "a pair adjustment is kerning, which is edited in the Spacing workspace rather than here",
  ],
  [
    "enumerate",
    "a pair adjustment is kerning, which is edited in the Spacing workspace rather than here",
  ],
  [
    "feature",
    "a feature that gathers other features, such as aalt, is not compiled by this editor",
  ],
  ["markClass", REFUSED_AT_TOP.get("markClass")!],
  ["parameters", "feature parameters are not compiled by this editor"],
  ["featureNames", "feature names are not compiled by this editor"],
  ["cvParameters", "character variant parameters are not compiled by this editor"],
  ["sizemenuname", "size menu names are not compiled by this editor"],
]);

function readFeature(keyword: Token, r: Reader): FeaFeature | null {
  const tag = r.take();
  if (tag === undefined || tag.text.length === 0 || tag.text.length > 4) {
    r.complain(keyword.line, "a feature needs a tag of up to four characters");
    return null;
  }

  const open = r.take();
  if (open?.text !== "{") {
    r.complain(keyword.line, `expected "{" after feature ${tag.text}`);
    return null;
  }

  const statements: FeaStatement[] = [];
  const rules: FeaRule[] = [];

  for (;;) {
    const token = r.take();
    if (token === undefined) {
      r.complain(keyword.line, `feature ${tag.text} is never closed`);
      break;
    }
    if (token.text === "}") {
      // The tag is repeated after the brace, and disagreeing is a mistake worth
      // reporting rather than a formality worth ignoring.
      closeBlock(r, "feature", tag.text);
      break;
    }
    if (token.text === ";") continue;

    if (token.text === "script") {
      const script = r.take();
      if (script === undefined || !isTag(script)) {
        r.complain(token.line, "a script statement names a script tag");
        skipInside(r);
        continue;
      }
      statements.push({ kind: "script", script: script.text, line: token.line });
      if (r.peek()?.text === ";") r.take();
      continue;
    }

    if (token.text === "language") {
      const language = r.take();
      if (language === undefined || !isTag(language)) {
        r.complain(token.line, "a language statement names a language tag");
        skipInside(r);
        continue;
      }
      let includeDefault = true;
      while (r.peek() !== undefined && r.peek()!.text !== ";" && r.peek()!.text !== "}") {
        const word = r.take()!;
        if (word.text === "exclude_dflt" || word.text === "excludeDFLT") includeDefault = false;
        else if (word.text === "include_dflt" || word.text === "includeDFLT") includeDefault = true;
        else if (word.text === "required") {
          r.complain(word.line, "a required feature is not compiled by this editor");
        } else r.complain(word.line, `"${word.text}" is not something a language statement takes`);
      }
      if (r.peek()?.text === ";") r.take();
      statements.push({
        kind: "language",
        language: language.text,
        includeDefault,
        line: token.line,
      });
      continue;
    }

    if (token.text === "lookup") {
      const name = r.peek();
      // `lookup NAME;` uses a lookup defined earlier; `lookup NAME {` defines
      // one here, which is used here too.
      const after = r.ahead(1);
      if (name !== undefined && after?.text === ";") {
        r.take();
        r.take();
        statements.push({ kind: "lookup", name: name.text, line: token.line });
        const known = r.lookups.get(name.text);
        if (known !== undefined) rules.push(...known.rules);
        continue;
      }
      const lookup = readLookupBlock(token, r);
      if (lookup !== null) {
        statements.push({ kind: "block", lookup });
        rules.push(...lookup.rules);
      }
      continue;
    }

    const statement = readRuleOrFlags(token, r);
    if (statement === "unknown") {
      r.complain(
        token.line,
        REFUSED_IN_FEATURE.get(token.text) ?? `"${token.text}" is not a rule this editor compiles`,
      );
      skipInside(r);
      continue;
    }
    if (statement === null) continue;
    statements.push(statement);
    if (statement.kind === "rule") rules.push(statement.rule);
  }

  return { tag: tag.text, statements, rules, line: keyword.line };
}

/**
 * The `}` that closes a feature or a lookup, and the name repeated after it.
 */
export function closeBlock(r: Reader, what: "feature" | "lookup", name: string): void {
  const closing = r.peek();
  if (closing !== undefined && closing.text !== ";") {
    r.take();
    if (closing.text !== name) {
      r.complain(closing.line, `${what} ${name} is closed with ${closing.text}`);
    }
  }
  if (r.peek()?.text === ";") r.take();
}

/**
 * A named lookup block: `lookup NAME [useExtension] { … } NAME;`.
 *
 * Rules and `lookupflag` only. A script or language statement belongs to a
 * feature, and so does using another lookup by name.
 */
function readLookupBlock(keyword: Token, r: Reader): FeaLookup | null {
  const name = r.take();
  if (name === undefined || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name.text)) {
    r.complain(keyword.line, "a lookup needs a name");
    skipStatementOrBlock(r);
    return null;
  }
  if (r.peek()?.text === "useExtension") {
    r.take();
    r.complain(keyword.line, "extension lookups are not compiled by this editor");
  }
  const open = r.take();
  if (open?.text !== "{") {
    r.complain(keyword.line, `expected "{" after lookup ${name.text}`);
    skipInside(r);
    return null;
  }

  const statements: FeaStatement[] = [];
  const rules: FeaRule[] = [];
  for (;;) {
    const token = r.take();
    if (token === undefined) {
      r.complain(keyword.line, `lookup ${name.text} is never closed`);
      break;
    }
    if (token.text === "}") {
      closeBlock(r, "lookup", name.text);
      break;
    }
    if (token.text === ";") continue;

    if (token.text === "script" || token.text === "language" || token.text === "lookup") {
      r.complain(token.line, `a ${token.text} statement belongs in a feature, not in a lookup`);
      skipInside(r);
      continue;
    }

    const statement = readRuleOrFlags(token, r);
    if (statement === "unknown") {
      r.complain(
        token.line,
        REFUSED_IN_FEATURE.get(token.text) ?? `"${token.text}" is not a rule this editor compiles`,
      );
      skipInside(r);
      continue;
    }
    if (statement === null) continue;
    statements.push(statement);
    if (statement.kind === "rule") rules.push(statement.rule);
  }

  return { name: name.text, statements, rules, line: keyword.line };
}

/**
 * A rule or a `lookupflag` statement, `null` for one that was refused and
 * reported, or `"unknown"` for a word that starts neither.
 */
function readRuleOrFlags(token: Token, r: Reader): FeaStatement | null | "unknown" {
  if (token.text === "sub" || token.text === "substitute") {
    const rule = readSubstitution(token, r, false);
    return rule === null ? null : { kind: "rule", rule };
  }
  if (token.text === "pos" || token.text === "position") {
    const rule = readPosition(token, r, false);
    return rule === null ? null : { kind: "rule", rule };
  }
  if (token.text === "ignore") {
    const what = r.take();
    if (what?.text === "sub" || what?.text === "substitute") {
      const rule = readSubstitution(token, r, true);
      return rule === null ? null : { kind: "rule", rule };
    }
    if (what?.text === "pos" || what?.text === "position") {
      const rule = readPosition(token, r, true);
      return rule === null ? null : { kind: "rule", rule };
    }
    r.complain(token.line, `"ignore" is followed by sub or pos`);
    skipInside(r);
    return null;
  }
  if (token.text === "lookupflag") return readFlags(token, r);
  // A subtable break changes how a lookup is split into subtables and nothing
  // about what it does; the tables written here have no use for one.
  if (token.text === "subtable") {
    if (r.peek()?.text === ";") r.take();
    return null;
  }
  return "unknown";
}

/** `lookupflag IgnoreMarks RightToLeft;`, or the same as a number. */
function readFlags(keyword: Token, r: Reader): FeaStatement | null {
  let flags = 0;
  let ok = true;
  while (r.peek() !== undefined && r.peek()!.text !== ";" && r.peek()!.text !== "}") {
    const word = r.take()!;
    if (/^[0-9]+$/.test(word.text)) {
      flags |= Number(word.text) & 0x000f;
      if ((Number(word.text) & ~0x000f) !== 0) {
        r.complain(word.line, "mark filtering in a lookupflag is not compiled by this editor");
        ok = false;
      }
      continue;
    }
    const bit = FLAG_BITS.get(word.text);
    if (bit !== undefined) {
      flags |= bit;
      continue;
    }
    if (word.text === "MarkAttachmentType" || word.text === "UseMarkFilteringSet") {
      r.complain(word.line, `${word.text} is not compiled by this editor`);
      // Its class argument.
      if (r.peek() !== undefined && r.peek()!.text !== ";") readGlyphList(word.line, r);
      ok = false;
      continue;
    }
    r.complain(word.line, `"${word.text}" is not a lookup flag`);
    ok = false;
  }
  if (r.peek()?.text === ";") r.take();
  return ok ? { kind: "flags", flags, line: keyword.line } : null;
}

/** The attachment rules, each refused by its own name rather than as "not a sub". */
const ATTACHMENT = new Set(["cursive", "base", "mark", "ligature"]);

const NUMBER = /^-?[0-9]+$/;

/** One position in a positioning rule. */
type PosPosition = {
  readonly list: GlyphList;
  readonly marked: boolean;
  value: ValueRecord | null;
  call: string | null;
};

/**
 * A positioning rule: a single adjustment, or one in a context.
 *
 * Refused by name: a pair of glyphs and a value, which is kerning and belongs
 * to the kerning the editor already keeps; and attachment, which comes from the
 * anchors.
 */
function readPosition(keyword: Token, r: Reader, ignoring: boolean): FeaRule | null {
  const first = r.peek();
  if (first !== undefined && ATTACHMENT.has(first.text)) {
    r.complain(
      first.line,
      `${first.text} attachment is where the glyphs' anchors say, and is not compiled from the feature file`,
    );
    skipInside(r);
    return null;
  }

  const positions: PosPosition[] = [];

  for (;;) {
    const next = r.peek();
    if (next === undefined) {
      r.complain(keyword.line, "the file ends in the middle of a rule");
      return null;
    }
    if (next.text === ";" || next.text === "}") break;

    const last = positions[positions.length - 1];

    if (next.text === "'") {
      r.complain(next.line, `a ' has to follow a glyph`);
      skipInside(r);
      return null;
    }

    if (next.text === "<" || NUMBER.test(next.text)) {
      const value = next.text === "<" ? readValueRecord(r) : readShortValue(r);
      if (value === null) {
        skipInside(r);
        return null;
      }
      if (last === undefined) {
        r.complain(next.line, "a value has to follow the glyph it adjusts");
        skipInside(r);
        return null;
      }
      last.value = value;
      continue;
    }

    if (next.text === "lookup") {
      r.take();
      const name = r.take();
      if (name === undefined || last === undefined) {
        r.complain(next.line, "a lookup call follows a marked glyph and names a lookup");
        skipInside(r);
        return null;
      }
      if (last.call !== null) {
        r.complain(next.line, "one lookup is called at each marked glyph by this editor");
        skipInside(r);
        return null;
      }
      last.call = name.text;
      continue;
    }

    const list = readGlyphList(keyword.line, r);
    if (list === null) {
      skipInside(r);
      return null;
    }
    let marked = false;
    if (r.peek()?.text === "'") {
      r.take();
      marked = true;
    }
    positions.push({ list, marked, value: null, call: null });
  }

  if (r.peek()?.text === ";") r.take();

  if (positions.length === 0) {
    r.complain(keyword.line, "a positioning rule names no glyph");
    return null;
  }

  const marks = positions.map((p) => p.marked);
  const firstMark = marks.indexOf(true);

  if (firstMark < 0) {
    if (ignoring) {
      r.complain(keyword.line, "an ignore rule needs a marked glyph, written with a '");
      return null;
    }
    if (positions.some((p) => p.call !== null)) {
      r.complain(keyword.line, "a lookup is called at a marked glyph, written with a '");
      return null;
    }
    if (positions.length > 1) {
      // Two glyphs and a value is kerning, and this font already has kerning:
      // it is edited in the Spacing workspace and written from the model.
      r.complain(
        keyword.line,
        "a pair adjustment is kerning, which is edited in the Spacing workspace rather than here",
      );
      return null;
    }
    const only = positions[0]!;
    if (only.value === null) {
      r.complain(keyword.line, "a positioning rule needs a value");
      return null;
    }
    return { kind: "position", glyphs: only.list.glyphs, value: only.value, line: keyword.line };
  }

  const lastMark = marks.lastIndexOf(true);
  for (let i = firstMark; i <= lastMark; i++) {
    if (!marks[i]) {
      r.complain(keyword.line, "the marked glyphs of a rule must be next to each other");
      return null;
    }
  }
  if (positions.some((p) => !p.marked && (p.value !== null || p.call !== null))) {
    r.complain(keyword.line, "a value or a lookup in a context belongs to a marked glyph");
    return null;
  }

  const input = positions.slice(firstMark, lastMark + 1);
  const values = input.map((p) => p.value);
  const calls = input.map((p) => p.call);

  if (ignoring) {
    if (values.some((v) => v !== null) || calls.some((c) => c !== null)) {
      r.complain(keyword.line, "an ignore rule adjusts nothing, so it has no value");
      return null;
    }
  } else if (values.every((v) => v === null) && calls.every((c) => c === null)) {
    r.complain(keyword.line, "a positioning rule needs a value");
    return null;
  }

  return {
    kind: "contextPosition",
    backtrack: positions.slice(0, firstMark).map((p) => p.list.glyphs),
    input: input.map((p) => p.list.glyphs),
    lookahead: positions.slice(lastMark + 1).map((p) => p.list.glyphs),
    values,
    calls,
    ignore: ignoring,
    line: keyword.line,
  };
}

/** A bare number, which is an advance: `pos @caps 20;` puts twenty units after every capital. */
function readShortValue(r: Reader): ValueRecord | null {
  const token = r.take();
  if (token === undefined) return null;
  return { x: 0, y: 0, xAdvance: Number(token.text), yAdvance: 0 };
}

/** `<x y xAdvance yAdvance>`, the long form of a value. */
function readValueRecord(r: Reader): ValueRecord | null {
  const open = r.take();
  if (open === undefined) return null;

  const numbers: number[] = [];
  for (;;) {
    const token = r.take();
    if (token === undefined) {
      r.complain(open.line, "a value is never closed");
      return null;
    }
    if (token.text === ">") break;
    if (!NUMBER.test(token.text)) {
      // A device table, a named value or a variable-font value, none of which is
      // four plain numbers.
      r.complain(open.line, `a value takes four numbers, and "${token.text}" is not one`);
      return null;
    }
    numbers.push(Number(token.text));
  }

  if (numbers.length !== 4) {
    r.complain(open.line, `a value takes four numbers, not ${String(numbers.length)}`);
    return null;
  }
  return { x: numbers[0]!, y: numbers[1]!, xAdvance: numbers[2]!, yAdvance: numbers[3]! };
}

/** One position in a substitution: the glyphs allowed there, whether it is marked, and any lookup it calls. */
type Position = {
  readonly list: GlyphList;
  readonly marked: boolean;
  readonly call: string | null;
};

/**
 * A substitution, contextual or not.
 *
 * Every kind is written the same way up to `by` or `from`, and only a `'` tells
 * a contextual rule apart, so all of them are read here. Positions are collected
 * first and what kind of rule they make is decided afterwards, because until the
 * whole left side has been read there is no way to know.
 */
function readSubstitution(keyword: Token, r: Reader, ignoring: boolean): FeaRule | null {
  const positions: Position[] = [];
  let joiner: "by" | "from" | null = null;

  for (;;) {
    const next = r.peek();
    if (next === undefined) {
      r.complain(keyword.line, "the file ends in the middle of a rule");
      return null;
    }
    if (next.text === "by" || next.text === "from") {
      r.take();
      joiner = next.text;
      break;
    }
    if (next.text === ";" || next.text === "}") break;

    if (next.text === "lookup") {
      r.take();
      const name = r.take();
      const last = positions[positions.length - 1];
      if (name === undefined || last === undefined || !last.marked) {
        r.complain(next.line, "a lookup is called at a marked glyph, written with a '");
        skipInside(r);
        return null;
      }
      if (last.call !== null) {
        r.complain(next.line, "one lookup is called at each marked glyph by this editor");
        skipInside(r);
        return null;
      }
      positions[positions.length - 1] = { ...last, call: name.text };
      continue;
    }

    const list = readGlyphList(keyword.line, r);
    if (list === null) {
      skipInside(r);
      return null;
    }

    let marked = false;
    if (r.peek()?.text === "'") {
      r.take();
      marked = true;
    }
    positions.push({ list, marked, call: null });
  }

  // What follows `by` or `from`: one list, or for `by`, a run of glyphs.
  const targets: GlyphList[] = [];
  if (joiner !== null) {
    while (r.peek() !== undefined && r.peek()!.text !== ";" && r.peek()!.text !== "}") {
      const list = readGlyphList(keyword.line, r);
      if (list === null) {
        skipInside(r);
        return null;
      }
      targets.push(list);
    }
  }
  if (r.peek()?.text === ";") r.take();

  if (positions.length === 0) {
    r.complain(keyword.line, "a substitution replaces nothing");
    return null;
  }

  const marks = positions.map((p) => p.marked);
  const firstMark = marks.indexOf(true);

  if (firstMark < 0) {
    if (ignoring) {
      r.complain(keyword.line, "an ignore rule needs a marked glyph, written with a '");
      return null;
    }
    if (joiner === null || targets.length === 0) {
      r.complain(keyword.line, `a substitution has no "by"`);
      return null;
    }
    if (joiner === "from") return readAlternates(keyword, positions, targets, r);
    return readPlain(keyword, positions, targets, r);
  }

  const lastMark = marks.lastIndexOf(true);
  // The marked run is what gets replaced, and a run has no holes in it.
  for (let i = firstMark; i <= lastMark; i++) {
    if (!marks[i]) {
      r.complain(keyword.line, "the marked glyphs of a rule must be next to each other");
      return null;
    }
  }

  const input = positions.slice(firstMark, lastMark + 1);
  const context = {
    kind: "chain" as const,
    backtrack: positions.slice(0, firstMark).map((p) => p.list.glyphs),
    input: input.map((p) => p.list.glyphs),
    lookahead: positions.slice(lastMark + 1).map((p) => p.list.glyphs),
    line: keyword.line,
  };
  const calls = input.some((p) => p.call !== null) ? input.map((p) => p.call) : null;

  if (ignoring) {
    if (joiner !== null) {
      r.complain(keyword.line, `an ignore rule replaces nothing, so it has no "by"`);
      return null;
    }
    if (calls !== null) {
      r.complain(keyword.line, "an ignore rule calls no lookup");
      return null;
    }
    return { ...context, to: null, multiple: false, calls: null, ignore: true };
  }

  if (calls !== null) {
    if (joiner !== null) {
      r.complain(
        keyword.line,
        `a rule that calls a lookup replaces nothing itself, so it has no "${joiner}"`,
      );
      return null;
    }
    return { ...context, to: null, multiple: false, calls, ignore: false };
  }

  if (joiner === null || targets.length === 0) {
    r.complain(keyword.line, `a substitution has no "by"`);
    return null;
  }
  if (joiner === "from") {
    r.complain(keyword.line, "alternates in a context are not compiled by this editor");
    return null;
  }

  if (targets.length > 1) {
    // One glyph into several, only here.
    if (context.input.length !== 1 || context.input[0]!.length !== 1) {
      r.complain(keyword.line, "only one glyph can be replaced by several");
      return null;
    }
    if (targets.some((t) => t.plural)) {
      r.complain(keyword.line, "a glyph replaced by several is replaced by glyphs, not classes");
      return null;
    }
    return {
      ...context,
      to: targets.map((t) => t.glyphs[0]!),
      multiple: true,
      calls: null,
      ignore: false,
    };
  }

  const replaced = contextReplacement(keyword, context.input, targets[0]!, r);
  if (replaced === null) return null;
  return { ...context, to: replaced, multiple: false, calls: null, ignore: false };
}

/**
 * What the marked run of a contextual rule becomes.
 *
 * The same two shapes an ordinary substitution has, which is the point: a
 * contextual rule is a plain rule with a condition on it, and it should not need
 * a different way of saying what it does.
 */
function contextReplacement(
  keyword: Token,
  input: readonly (readonly string[])[],
  to: GlyphList,
  r: Reader,
): string[] | null {
  if (input.length === 1) {
    const left = input[0]!;
    if (!to.plural) return [to.glyphs[0]!];
    if (left.length !== to.glyphs.length) {
      r.complain(
        keyword.line,
        `this replaces ${String(left.length)} glyphs with ${String(to.glyphs.length)}; the two sides must match`,
      );
      return null;
    }
    return [...to.glyphs];
  }

  if (to.glyphs.length !== 1) {
    r.complain(keyword.line, "a ligature must be replaced by exactly one glyph");
    return null;
  }
  if (input.some((part) => part.length !== 1)) {
    r.complain(keyword.line, "classes in a ligature are not compiled by this editor");
    return null;
  }
  return [to.glyphs[0]!];
}

/** `sub a from [a.alt1 a.alt2];`: one glyph, and the set an application chooses from. */
function readAlternates(
  keyword: Token,
  positions: readonly Position[],
  targets: readonly GlyphList[],
  r: Reader,
): FeaRule | null {
  if (positions.length !== 1 || positions[0]!.list.glyphs.length !== 1) {
    r.complain(keyword.line, "alternates are given for one glyph at a time");
    return null;
  }
  if (targets.length !== 1) {
    r.complain(keyword.line, "the alternates are written as one list, such as [a.alt1 a.alt2]");
    return null;
  }
  return {
    kind: "alternate",
    from: positions[0]!.list.glyphs[0]!,
    alternates: targets[0]!.glyphs,
    line: keyword.line,
  };
}

/** A substitution with no context: one for one, one for several, or several for one. */
function readPlain(
  keyword: Token,
  positions: readonly Position[],
  targets: readonly GlyphList[],
  r: Reader,
): FeaRule | null {
  const from = positions.map((p) => p.list);

  // One glyph into several.
  if (targets.length > 1) {
    if (from.length !== 1 || from[0]!.glyphs.length !== 1) {
      r.complain(keyword.line, "only one glyph can be replaced by several");
      return null;
    }
    if (targets.some((t) => t.plural)) {
      r.complain(keyword.line, "a glyph replaced by several is replaced by glyphs, not classes");
      return null;
    }
    return {
      kind: "multiple",
      from: from[0]!.glyphs[0]!,
      to: targets.map((t) => t.glyphs[0]!),
      line: keyword.line,
    };
  }

  const to = targets[0]!;

  // One thing in, one thing out: a substitution of each glyph for its opposite
  // number. This is what `smcp` is, and what a one-for-one `salt` is.
  if (from.length === 1) {
    const left = from[0]!.glyphs;

    // One name on the right replaces every glyph on the left with it. A set on
    // the right pairs off with the left, and two sets of different sizes cannot.
    if (!to.plural) {
      return { kind: "single", from: left, to: left.map(() => to.glyphs[0]!), line: keyword.line };
    }
    if (left.length !== to.glyphs.length) {
      r.complain(
        keyword.line,
        `this replaces ${String(left.length)} glyphs with ${String(to.glyphs.length)}; the two sides must match`,
      );
      return null;
    }
    return { kind: "single", from: left, to: to.glyphs, line: keyword.line };
  }

  // Several things in, one out: a ligature.
  if (to.glyphs.length !== 1) {
    r.complain(keyword.line, "a ligature must be replaced by exactly one glyph");
    return null;
  }
  if (from.some((part) => part.glyphs.length !== 1)) {
    r.complain(keyword.line, "classes in a ligature are not compiled by this editor");
    return null;
  }
  return {
    kind: "ligature",
    from: from.map((part) => part.glyphs[0]!),
    to: to.glyphs[0]!,
    line: keyword.line,
  };
}
