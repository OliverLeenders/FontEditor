/**
 * A reader for the part of `.fea` that this editor compiles.
 *
 * The whole language is large — lookup flags, language systems, positioning
 * rules, variable-font conditions — and most of it needs a shaper's worth of
 * machinery behind it to mean anything. What is here is the part that earns its
 * keep in a font being drawn: glyph classes, the two substitutions that `liga`,
 * `smcp`, `ss01` and friends are made of, and those same two again written to
 * apply only in a context, which is what `calt` is.
 *
 * Anything outside that is refused *by name*, with the line it was on, rather
 * than skipped. A feature file that silently compiled to less than it says is
 * worse than one that will not compile: the first ships a font that does not do
 * what its source claims.
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
       * glyphs of a single marked position. `null` is an `ignore` rule, which
       * matches so that the rules after it do not.
       */
      readonly to: readonly string[] | null;
      readonly line: number;
    };

export type FeaFeature = {
  /** The four-character tag, such as `liga`. */
  readonly tag: string;
  readonly rules: readonly FeaRule[];
  readonly line: number;
};

export type FeaProblem = {
  /** One-based, so it matches what an editor shows in its gutter. */
  readonly line: number;
  readonly message: string;
};

export type FeaSource = {
  readonly features: readonly FeaFeature[];
  readonly classes: ReadonlyMap<string, readonly string[]>;
  readonly problems: readonly FeaProblem[];
};

type Token = {
  readonly text: string;
  readonly line: number;
};

/** Everything that is a token boundary or a token in its own right. */
const PUNCTUATION = new Set(["[", "]", ";", "=", "{", "}", "'", ","]);

function tokenize(source: string): Token[] {
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
  const classes = new Map<string, readonly string[]>();
  const features: FeaFeature[] = [];

  let at = 0;
  const peek = (): Token | undefined => tokens[at];
  const take = (): Token | undefined => tokens[at++];
  const complain = (line: number, message: string): void => {
    problems.push({ line, message });
  };

  /** Skip to just past the next `;`, which is how a bad statement is escaped. */
  const skipStatement = (): void => {
    while (at < tokens.length && tokens[at]!.text !== ";") at += 1;
    at += 1;
  };

  while (at < tokens.length) {
    const token = take();
    if (token === undefined) break;

    if (token.text === ";") continue;

    // Accepted and ignored: it says which script the rules are for, and
    // everything here is written under the default script anyway.
    if (token.text === "languagesystem") {
      skipStatement();
      continue;
    }

    if (token.text.startsWith("@")) {
      const named = readClassDefinition(token, take, peek, classes, complain);
      if (!named) skipStatement();
      continue;
    }

    if (token.text === "feature") {
      const feature = readFeature(token, take, peek, classes, complain);
      if (feature !== null) features.push(feature);
      continue;
    }

    complain(token.line, `"${token.text}" is not something this editor understands`);
    skipStatement();
  }

  return { features, classes, problems };
}

function readClassDefinition(
  name: Token,
  take: () => Token | undefined,
  peek: () => Token | undefined,
  classes: Map<string, readonly string[]>,
  complain: (line: number, message: string) => void,
): boolean {
  const equals = take();
  if (equals?.text !== "=") {
    complain(name.line, `expected "=" after the class ${name.text}`);
    return false;
  }

  const list = readGlyphList(name.line, take, peek, classes, complain);
  if (list === null) return false;
  const members = list.glyphs;

  const semi = take();
  if (semi?.text !== ";") complain(name.line, `expected ";" after the class ${name.text}`);

  if (classes.has(name.text)) complain(name.line, `${name.text} is defined more than once`);
  classes.set(name.text, members);
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
function readGlyphList(
  line: number,
  take: () => Token | undefined,
  peek: () => Token | undefined,
  classes: ReadonlyMap<string, readonly string[]>,
  complain: (line: number, message: string) => void,
): GlyphList | null {
  const first = peek();
  if (first === undefined) {
    complain(line, "the file ends in the middle of a rule");
    return null;
  }

  if (first.text !== "[") {
    take();
    if (first.text.startsWith("@")) {
      const members = classes.get(first.text);
      if (members === undefined) {
        complain(first.line, `${first.text} is used before it is defined`);
        return null;
      }
      return { glyphs: [...members], plural: true };
    }
    return { glyphs: [first.text], plural: false };
  }

  take(); // the "["
  const out: string[] = [];
  for (;;) {
    const token = take();
    if (token === undefined) {
      complain(line, "a glyph list is never closed");
      return null;
    }
    if (token.text === "]") break;
    if (token.text === ",") continue;

    if (token.text.startsWith("@")) {
      const members = classes.get(token.text);
      if (members === undefined) {
        complain(token.line, `${token.text} is used before it is defined`);
        return null;
      }
      out.push(...members);
      continue;
    }
    out.push(token.text);
  }
  return { glyphs: out, plural: true };
}

function readFeature(
  keyword: Token,
  take: () => Token | undefined,
  peek: () => Token | undefined,
  classes: ReadonlyMap<string, readonly string[]>,
  complain: (line: number, message: string) => void,
): FeaFeature | null {
  const tag = take();
  if (tag === undefined || tag.text.length === 0 || tag.text.length > 4) {
    complain(keyword.line, "a feature needs a tag of up to four characters");
    return null;
  }

  const open = take();
  if (open?.text !== "{") {
    complain(keyword.line, `expected "{" after feature ${tag.text}`);
    return null;
  }

  const rules: FeaRule[] = [];
  for (;;) {
    const token = take();
    if (token === undefined) {
      complain(keyword.line, `feature ${tag.text} is never closed`);
      break;
    }
    if (token.text === "}") {
      // The tag is repeated after the brace, and disagreeing is a mistake worth
      // reporting rather than a formality worth ignoring.
      const closing = take();
      if (closing !== undefined && closing.text !== tag.text && closing.text !== ";") {
        complain(closing.line, `feature ${tag.text} is closed with ${closing.text}`);
      }
      if (closing?.text !== ";") take();
      break;
    }
    if (token.text === ";") continue;

    if (token.text === "sub" || token.text === "substitute") {
      const rule = readSubstitution(token, take, peek, classes, complain, false);
      if (rule !== null) rules.push(rule);
      continue;
    }

    // `ignore sub` matches in order to stop the rules after it matching. It is
    // half of how a contextual feature is written: the exceptions first, then
    // the rule they are exceptions to.
    if (token.text === "ignore") {
      const what = take();
      if (what?.text !== "sub" && what?.text !== "substitute") {
        complain(token.line, `only "ignore sub" is compiled by this editor`);
        while (peek() !== undefined && peek()!.text !== ";" && peek()!.text !== "}") take();
        if (peek()?.text === ";") take();
        continue;
      }
      const rule = readSubstitution(token, take, peek, classes, complain, true);
      if (rule !== null) rules.push(rule);
      continue;
    }

    complain(token.line, `only substitution rules are compiled, and "${token.text}" is not one`);
    while (peek() !== undefined && peek()!.text !== ";" && peek()!.text !== "}") take();
    if (peek()?.text === ";") take();
  }

  return { tag: tag.text, rules, line: keyword.line };
}

/** One position in a rule: the glyphs allowed there, and whether it is marked. */
type Position = {
  readonly list: GlyphList;
  readonly marked: boolean;
};

/**
 * A substitution, contextual or not.
 *
 * Both are written the same way and only a `'` tells them apart, so both are
 * read here. Positions are collected first and what kind of rule they make is
 * decided afterwards, because until the whole left side has been read there is
 * no way to know.
 */
function readSubstitution(
  keyword: Token,
  take: () => Token | undefined,
  peek: () => Token | undefined,
  classes: ReadonlyMap<string, readonly string[]>,
  complain: (line: number, message: string) => void,
  ignoring: boolean,
): FeaRule | null {
  const positions: Position[] = [];
  let sawBy = false;

  for (;;) {
    const next = peek();
    if (next === undefined) {
      complain(keyword.line, "the file ends in the middle of a rule");
      return null;
    }
    if (next.text === "by") {
      take();
      sawBy = true;
      break;
    }
    if (next.text === ";" || next.text === "}") break;

    // A rule that calls a lookup by name needs the lookup to have been
    // declared, which is a part of the language this editor does not read.
    if (next.text === "lookup") {
      complain(next.line, "rules that call a named lookup are not compiled by this editor");
      return null;
    }

    const list = readGlyphList(keyword.line, take, peek, classes, complain);
    if (list === null) return null;

    let marked = false;
    if (peek()?.text === "'") {
      take();
      marked = true;
    }
    positions.push({ list, marked });
  }

  if (peek()?.text === ";") take();

  if (positions.length === 0) {
    complain(keyword.line, "a substitution replaces nothing");
    return null;
  }

  const marks = positions.map((p) => p.marked);
  const firstMark = marks.indexOf(true);

  if (firstMark < 0) {
    if (ignoring) {
      complain(keyword.line, "an ignore rule needs a marked glyph, written with a '");
      return null;
    }
    if (!sawBy) {
      complain(keyword.line, `a substitution has no "by"`);
      return null;
    }
    return readPlain(keyword, positions, take, peek, classes, complain);
  }

  const lastMark = marks.lastIndexOf(true);
  // The marked run is what gets replaced, and a run has no holes in it. The
  // language allows several separate matches with their own lookups; this
  // reader does not, and says so rather than replacing the wrong one.
  for (let i = firstMark; i <= lastMark; i++) {
    if (!marks[i]) {
      complain(keyword.line, "the marked glyphs of a rule must be next to each other");
      return null;
    }
  }

  const backtrack = positions.slice(0, firstMark).map((p) => p.list.glyphs);
  const input = positions.slice(firstMark, lastMark + 1).map((p) => p.list.glyphs);
  const lookahead = positions.slice(lastMark + 1).map((p) => p.list.glyphs);

  if (ignoring) {
    if (sawBy) {
      complain(keyword.line, `an ignore rule replaces nothing, so it has no "by"`);
      return null;
    }
    return { kind: "chain", backtrack, input, lookahead, to: null, line: keyword.line };
  }

  if (!sawBy) {
    complain(keyword.line, `a substitution has no "by"`);
    return null;
  }

  const to = readGlyphList(keyword.line, take, peek, classes, complain);
  if (to === null) return null;
  if (peek()?.text === ";") take();

  const replaced = contextReplacement(keyword, input, to, complain);
  if (replaced === null) return null;

  return { kind: "chain", backtrack, input, lookahead, to: replaced, line: keyword.line };
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
  complain: (line: number, message: string) => void,
): string[] | null {
  if (input.length === 1) {
    const left = input[0]!;
    if (!to.plural) return [to.glyphs[0]!];
    if (left.length !== to.glyphs.length) {
      complain(
        keyword.line,
        `this replaces ${String(left.length)} glyphs with ${String(to.glyphs.length)}; the two sides must match`,
      );
      return null;
    }
    return [...to.glyphs];
  }

  if (to.glyphs.length !== 1) {
    complain(keyword.line, "a ligature must be replaced by exactly one glyph");
    return null;
  }
  if (input.some((part) => part.length !== 1)) {
    complain(keyword.line, "classes in a ligature are not compiled by this editor");
    return null;
  }
  return [to.glyphs[0]!];
}

/** A substitution with no context: the two shapes that were here first. */
function readPlain(
  keyword: Token,
  positions: readonly Position[],
  take: () => Token | undefined,
  peek: () => Token | undefined,
  classes: ReadonlyMap<string, readonly string[]>,
  complain: (line: number, message: string) => void,
): FeaRule | null {
  const to = readGlyphList(keyword.line, take, peek, classes, complain);
  if (to === null) return null;
  if (peek()?.text === ";") take();

  const from = positions.map((p) => p.list);

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
      complain(
        keyword.line,
        `this replaces ${String(left.length)} glyphs with ${String(to.glyphs.length)}; the two sides must match`,
      );
      return null;
    }
    return { kind: "single", from: left, to: to.glyphs, line: keyword.line };
  }

  // Several things in, one out: a ligature.
  if (to.glyphs.length !== 1) {
    complain(keyword.line, "a ligature must be replaced by exactly one glyph");
    return null;
  }
  if (from.some((part) => part.glyphs.length !== 1)) {
    complain(keyword.line, "classes in a ligature are not compiled by this editor");
    return null;
  }
  return {
    kind: "ligature",
    from: from.map((part) => part.glyphs[0]!),
    to: to.glyphs[0]!,
    line: keyword.line,
  };
}
