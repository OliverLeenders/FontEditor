/**
 * A reader for the part of `.fea` that this editor compiles.
 *
 * The whole language is large — contextual chaining, lookup flags, language
 * systems, positioning rules, variable-font conditions — and most of it needs a
 * shaper's worth of machinery behind it to mean anything. What is here is the
 * part that earns its keep in a font being drawn: glyph classes, and the two
 * substitutions that `liga`, `smcp`, `ss01` and friends are made of.
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
      const rule = readSubstitution(token, take, peek, classes, complain);
      if (rule !== null) rules.push(rule);
      continue;
    }

    complain(token.line, `only substitution rules are compiled, and "${token.text}" is not one`);
    while (peek() !== undefined && peek()!.text !== ";" && peek()!.text !== "}") take();
    if (peek()?.text === ";") take();
  }

  return { tag: tag.text, rules, line: keyword.line };
}

function readSubstitution(
  keyword: Token,
  take: () => Token | undefined,
  peek: () => Token | undefined,
  classes: ReadonlyMap<string, readonly string[]>,
  complain: (line: number, message: string) => void,
): FeaRule | null {
  // Everything up to `by` is what is being replaced.
  const from: GlyphList[] = [];
  for (;;) {
    const next = peek();
    if (next === undefined) {
      complain(keyword.line, `a substitution has no "by"`);
      return null;
    }
    if (next.text === "by") {
      take();
      break;
    }
    if (next.text === ";" || next.text === "}") {
      complain(keyword.line, `a substitution has no "by"`);
      return null;
    }
    const part = readGlyphList(keyword.line, take, peek, classes, complain);
    if (part === null) return null;
    from.push(part);
  }

  const to = readGlyphList(keyword.line, take, peek, classes, complain);
  if (to === null) return null;
  if (peek()?.text === ";") take();

  if (from.length === 0) {
    complain(keyword.line, "a substitution replaces nothing");
    return null;
  }

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
