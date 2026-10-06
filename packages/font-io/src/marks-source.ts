import {
  type Anchor,
  type Glyph,
  type GlyphName,
  type IdFactory,
  anchor,
  isMarkAnchor,
  ligaturePart,
} from "@typewright/font-model";

import {
  type FeaProblem,
  closeBlock,
  readClassDefinition,
  readGlyphList,
  readerOver,
  skipInside,
  skipStatementOrBlock,
  tokenize,
} from "./fea.js";
import { ENTRY, EXIT, joinsOf } from "./cursive.js";
import { ligatureParts, markRounds } from "./marks.js";

/**
 * The Marks file: mark attachment written as feature source, from the anchors.
 *
 * Mark attachment is compiled from the glyphs' anchors, never from text — an
 * accent carrying `_top` lands on every letter carrying `top`. But a designer
 * who has written feature files thinks of it as `markClass` and `pos base`, and
 * reading a whole font's attachment in one place is something the canvas cannot
 * offer. So the anchors are written out as that source, and a change to the
 * source that reads cleanly is put back into the anchors.
 *
 * The anchors stay the only truth. This file is never stored: it is written
 * again from the anchors, which is why a comment typed into it is not kept, and
 * why anything the anchors cannot hold — a filtering set, a rule in some other
 * feature — is refused by name rather than half-kept.
 *
 * A mark class is an anchor's name: `@MC_top` is the glyphs that attach by
 * `_top`, and `pos base` and `pos mark` list the glyphs that offer a `top`. The
 * split between the two follows the compiler — a glyph that attaches by an
 * anchor is a mark, and marks stack on it in `mkmk`. A ligature is written
 * with `pos ligature`, its parts in turn: the first is its `top_1`, the second
 * its `top_2`.
 */

/** What every mark class in the file is named with; the rest is the anchor's name. */
export const MARK_CLASS_PREFIX = "@MC_";

/** What a class name can spell after the prefix. */
const CLASS_NAME = /^[A-Za-z0-9_.]+$/;

/** Characters that would end a glyph name in the middle of it. */
const UNSPELLABLE = /[\s[\]{};='<>,#\\]/;

/** Words the file's own rules use, which a glyph so named has to be escaped from. */
const KEYWORDS = new Set([
  "anchor",
  "base",
  "cursive",
  "feature",
  "ligature",
  "lookup",
  "mark",
  "markClass",
  "NULL",
  "pos",
  "position",
]);

const spelled = (name: GlyphName): string => (KEYWORDS.has(name) ? `\\${name}` : name);
const unescaped = (name: string): string => (name.startsWith("\\") ? name.slice(1) : name);

/** Whole where it is whole, and to two places where not. */
function formatted(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

type Point = { readonly x: number; readonly y: number };

const anchorText = (pt: Point): string => `<anchor ${formatted(pt.x)} ${formatted(pt.y)}>`;

/** Whether two positions read the same once written. */
const samePlace = (a: Point, b: Point): boolean =>
  formatted(a.x) === formatted(b.x) && formatted(a.y) === formatted(b.y);

/**
 * Whether none of a glyph's anchors can be written: its name cannot be spelled
 * in the file, or it attaches by an anchor whose name a class cannot spell.
 * Such a glyph is left out whole, so that half of it is never read back as the
 * whole of it.
 */
const leftOut = (g: Glyph): boolean =>
  g.name === "" ||
  UNSPELLABLE.test(g.name) ||
  g.anchors.some((a) => isMarkAnchor(a) && !CLASS_NAME.test(a.name.slice(1)));

/** The mark classes the file is written with, in the order they first appear. */
function writtenClasses(glyphs: readonly Glyph[]): Set<string> {
  const classes = new Set<string>();
  for (const g of glyphs) {
    if (leftOut(g)) continue;
    for (const a of g.anchors) if (isMarkAnchor(a)) classes.add(a.name.slice(1));
  }
  return classes;
}

/**
 * A ligature's places, a row of classes for each part, or `null` for a glyph
 * that is not one: as the compiler has it, so that the file and the font say
 * the same thing.
 */
function partsOf(g: Glyph, classes: ReadonlySet<string>): (Anchor | null)[][] | null {
  if (g.anchors.some(isMarkAnchor)) return null;
  const order = [...classes];
  const at = (name: string): number | undefined => {
    const index = order.indexOf(name);
    return index < 0 ? undefined : index;
  };
  return ligatureParts(g, at, order.length);
}

/**
 * Whether the file has a line for this anchor of this glyph, given the classes
 * it is written with.
 *
 * A mark's own anchor, a place under a class's name, and on a ligature a place
 * on a part. A ligature's place that names no part is not written, as it is
 * not compiled: it is where a component lands. And where a glyph is joined to
 * its neighbours, its entry and its exit.
 */
function written(g: Glyph, a: Anchor, classes: ReadonlySet<string>): boolean {
  if (isMarkAnchor(a)) return classes.has(a.name.slice(1));
  if (isJoin(g, a, classes)) return true;
  const parts = partsOf(g, classes);
  if (parts === null) return classes.has(a.name);
  return parts.some((row) => row.includes(a));
}

/** Whether an anchor is one of the two a glyph is joined to its neighbours by. */
function isJoin(g: Glyph, a: Anchor, classes: ReadonlySet<string>): boolean {
  const joins = joinsOf(g, (name) => classes.has(name));
  return joins !== null && (joins.entry === a || joins.exit === a);
}

/**
 * The Marks file for these glyphs, in the order given.
 *
 * `master` is named in the header, since a family's masters each have anchors
 * of their own and the file is only ever one master's.
 */
export function writeMarks(glyphs: readonly Glyph[], master: string | null = null): string {
  const classes = writtenClasses(glyphs);
  const markLines = new Map<string, string[]>([...classes].map((c) => [c, []]));
  const joined: string[] = [];
  const skipped: string[] = [];
  const order = [...classes];

  // A mark that attaches by two anchors is in two classes, and a lookup has
  // room for one of them: the classes are in rounds, as the compiler has
  // them, and what the letters offer is written a round at a time.
  const rounds = markRounds(glyphs.filter((g) => !leftOut(g)));
  const roundOf = (name: string): number => rounds.get(name) ?? 0;
  const roundCount = Math.max(0, ...rounds.values()) + 1;
  const perRound = (): string[][] => Array.from({ length: roundCount }, () => []);
  const bases = perRound();
  const ligatures = perRound();
  const stacked = perRound();

  for (const g of glyphs) {
    if (leftOut(g)) {
      if (g.anchors.some((a) => written(g, a, classes) || isMarkAnchor(a))) skipped.push(g.name);
      continue;
    }
    // Where it is joined to, and where the next joins it; either may be
    // nowhere, a letter that begins a word having nothing before it.
    const joins = joinsOf(g, (name) => classes.has(name));
    if (joins !== null) {
      const at = (a: Anchor | null): string => (a === null ? "<anchor NULL>" : anchorText(a.pt));
      joined.push(`    pos cursive ${spelled(g.name)} ${at(joins.entry)} ${at(joins.exit)};`);
    }
    const parts = partsOf(g, classes);
    if (parts !== null) {
      // Each part on lines of its own, the parts told apart by the word
      // between them; a part with no place says so, since it is counted.
      for (let round = 0; round < roundCount; round++) {
        // The places of this round's classes, as far as the last part that
        // has one of them.
        const here = parts.map((row) =>
          row.map((a, c) => (roundOf(order[c]!) === round ? a : null)),
        );
        while (here.length > 0 && here[here.length - 1]!.every((a) => a === null)) here.pop();
        if (here.length === 0) continue;
        const lines = here.flatMap((row, part) => {
          const places = row.flatMap((a, c) =>
            a === null ? [] : [`${anchorText(a.pt)} mark ${MARK_CLASS_PREFIX}${order[c]!}`],
          );
          return [
            ...(part === 0 ? [] : ["ligComponent"]),
            ...(places.length === 0 ? ["<anchor NULL>"] : places),
          ];
        });
        ligatures[round]!.push(
          [`    pos ligature ${spelled(g.name)}`, ...lines.map((l) => `        ${l}`)].join("\n") +
            ";",
        );
      }
      continue;
    }
    const offers = perRound();
    for (const a of g.anchors) {
      if (!written(g, a, classes) || a === joins?.entry || a === joins?.exit) continue;
      if (isMarkAnchor(a)) {
        const c = a.name.slice(1);
        markLines
          .get(c)!
          .push(`markClass ${spelled(g.name)} ${anchorText(a.pt)} ${MARK_CLASS_PREFIX}${c};`);
      } else {
        offers[roundOf(a.name)]!.push(`${anchorText(a.pt)} mark ${MARK_CLASS_PREFIX}${a.name}`);
      }
    }

    const kind = g.anchors.some(isMarkAnchor) ? "mark" : "base";
    for (const [round, offered] of offers.entries()) {
      if (offered.length === 0) continue;
      const rule =
        offered.length === 1
          ? `    pos ${kind} ${spelled(g.name)} ${offered[0]!};`
          : [`    pos ${kind} ${spelled(g.name)}`, ...offered.map((o) => `        ${o}`)].join(
              "\n",
            ) + ";";
      (kind === "mark" ? stacked : bases)[round]!.push(rule);
    }
  }

  // A feature's rules: as they are where the font is one round, and where it
  // is several, each lot in a lookup of its own, in order. A lot is one kind
  // of rule — a named lookup holds one kind, so a round's letters and its
  // ligatures are two.
  const feature = (tag: string, lots: readonly string[][]): string[] => {
    const filled = lots.filter((rules) => rules.length > 0);
    if (filled.length === 0) return [];
    if (roundCount === 1 || filled.length === 1) {
      return ["", `feature ${tag} {`, ...filled.flat(), `} ${tag};`];
    }
    const deeper = (rule: string): string =>
      rule
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");
    return [
      "",
      `feature ${tag} {`,
      ...filled.flatMap((rules, i) => {
        const name = `${tag}_${String(i + 1)}`;
        return [`    lookup ${name} {`, ...rules.map(deeper), `    } ${name};`];
      }),
      `} ${tag};`,
    ];
  };

  const out: string[] = [
    master === null ? "# Marks, from the anchors." : `# Marks, from the anchors of ${master}.`,
    "#",
    "# A mark class is an anchor's name: @MC_top gathers the glyphs that attach by",
    "# _top, and pos base and pos mark list the glyphs that offer a top. A ligature",
    "# offers one on each of its parts, which are its anchors top_1, top_2. A glyph",
    "# joined to its neighbours says where by pos cursive: its entry, then its exit. Change a",
    "# position to move that anchor, or add or remove a line to add or remove one.",
    "# The file is written again from the anchors, so comments here are not kept.",
  ];
  if (roundCount > 1) {
    out.push(
      "#",
      "# A mark with two attaching anchors is in two classes, and the rules for them are",
      "# in lookups of their own, in the order the anchors are in on the mark: where a",
      "# glyph offers a place for both, the later lookup is the one that stands.",
    );
  }
  if (skipped.length > 0) {
    out.push("#", `# Left out, as names a feature file cannot spell: ${skipped.join(" ")}`);
  }

  for (const lines of markLines.values()) out.push("", ...lines);
  out.push(
    ...feature(
      "mark",
      bases.flatMap((rules, round) => [rules, ligatures[round]!]),
    ),
  );
  out.push(...feature("mkmk", stacked));
  if (joined.length > 0) {
    out.push("", "feature curs {", `    ${JOINED_UNDER}`, ...joined, "} curs;");
  }
  return `${out.join("\n")}\n`;
}

/** One anchor the file says a glyph has. */
export type MarkPlace = {
  readonly glyph: GlyphName;
  /** The anchor's name: `_top` for a mark, `top` for a place offered. */
  readonly anchor: string;
  readonly pt: Point;
  readonly line: number;
};

export type MarksSource = {
  readonly places: readonly MarkPlace[];
  /** The mark classes defined, by anchor name without the underscore. */
  readonly classes: readonly string[];
  readonly problems: readonly FeaProblem[];
};

const SAYS_WHAT_IT_HOLDS = "the Marks file holds mark classes and the mark, mkmk and curs features";

/** The flags every join is compiled under, as the file states them. */
const JOINED_UNDER = "lookupflag RightToLeft IgnoreMarks;";

const NUMBER = /^-?[0-9]+(\.[0-9]+)?$/;

/**
 * Read a Marks file back into the anchors it describes.
 *
 * Returns every place it could read along with every problem, but a caller is
 * meant to put the places into the font only when there are no problems: a
 * half-read file would remove the anchors on the lines it could not read.
 */
export function readMarks(source: string, hasGlyph: (name: GlyphName) => boolean): MarksSource {
  const problems: FeaProblem[] = [];
  const r = readerOver(tokenize(source), problems);

  const classes = new Set<string>();
  const marks = new Map<string, MarkPlace>();
  const offers = new Map<string, MarkPlace & { readonly kind: "base" | "mark" | "ligature" }>();
  const key = (glyph: GlyphName, name: string) => `${glyph} ${name}`;

  /** `<anchor x y>`: a position, `null` for `<anchor NULL>`, or `undefined` after a complaint. */
  const readAnchor = (line: number): Point | null | undefined => {
    const open = r.take();
    const word = r.take();
    if (open?.text !== "<" || word?.text !== "anchor") {
      r.complain(line, "expected an anchor, written <anchor x y>");
      return undefined;
    }
    // After a complaint, the rest of the anchor up to its ">", unless the token
    // that was wrong already was the ">" — and never past the statement's end.
    const skipAnchor = (last: { text: string } | undefined): undefined => {
      if (last?.text === ">") return undefined;
      while (r.peek() !== undefined && r.peek()!.text !== ">" && r.peek()!.text !== ";") r.take();
      if (r.peek()?.text === ">") r.take();
      return undefined;
    };

    const first = r.take();
    if (first?.text === "NULL") {
      if (r.take()?.text !== ">") r.complain(line, "expected > after <anchor NULL");
      return null;
    }
    if (first === undefined || !NUMBER.test(first.text)) {
      r.complain(line, "a named anchor is not kept here; write its position as <anchor x y>");
      return skipAnchor(first);
    }
    const second = r.take();
    const close = second !== undefined && NUMBER.test(second.text) ? r.take() : second;
    if (second === undefined || !NUMBER.test(second.text) || close?.text !== ">") {
      r.complain(
        line,
        "an anchor here is a position and nothing else, which is all a glyph's anchor holds",
      );
      return skipAnchor(close);
    }
    return { x: Number(first.text), y: Number(second.text) };
  };

  /** The class a token names, by anchor name, or `null` when it is not one. */
  const className = (text: string | undefined): string | null => {
    if (text === undefined || !text.startsWith(MARK_CLASS_PREFIX)) return null;
    const name = text.slice(MARK_CLASS_PREFIX.length);
    return CLASS_NAME.test(name) ? name : null;
  };

  const glyphsNamed = (names: readonly string[], line: number): GlyphName[] =>
    names.map(unescaped).filter((name) => {
      if (hasGlyph(name)) return true;
      r.complain(line, `there is no glyph named ${name}`);
      return false;
    });

  const readMarkClass = (keyword: { line: number }): void => {
    const list = readGlyphList(keyword.line, r);
    if (list === null) return skipStatementOrBlock(r);
    const pt = readAnchor(keyword.line);
    if (pt === undefined) return skipStatementOrBlock(r);
    const named = r.take();
    const c = className(named?.text);
    if (c === null) {
      r.complain(
        keyword.line,
        `a mark class is named ${MARK_CLASS_PREFIX} and then the anchor's name, as in ${MARK_CLASS_PREFIX}top`,
      );
      if (named?.text !== ";") skipStatementOrBlock(r);
      return;
    }
    if (r.peek()?.text === ";") r.take();
    else r.complain(keyword.line, `expected ";" after ${named!.text}`);
    if (pt === null) {
      r.complain(keyword.line, "a mark attaches by a position, so its anchor cannot be NULL");
      return;
    }

    classes.add(c);
    for (const glyph of glyphsNamed(list.glyphs, keyword.line)) {
      const k = key(glyph, `_${c}`);
      const earlier = marks.get(k);
      if (earlier !== undefined) {
        r.complain(
          keyword.line,
          `${glyph} is already in ${MARK_CLASS_PREFIX}${c}, on line ${String(earlier.line)}`,
        );
        continue;
      }
      marks.set(k, { glyph, anchor: `_${c}`, pt, line: keyword.line });
    }
  };

  const joins = new Map<GlyphName, { entry: Point | null; exit: Point | null; line: number }>();

  /** `pos cursive glyph <entry> <exit>;`, the keyword already taken. */
  const readJoin = (pos: { line: number }, feature: string): void => {
    if (feature !== "curs") {
      r.complain(pos.line, "pos cursive belongs in feature curs");
      return skipInside(r);
    }
    const list = readGlyphList(pos.line, r);
    if (list === null) return skipInside(r);
    const entry = readAnchor(pos.line);
    if (entry === undefined) return skipInside(r);
    const exit = readAnchor(pos.line);
    if (exit === undefined) return skipInside(r);
    if (r.peek()?.text === ";") r.take();
    else {
      r.complain(pos.line, 'expected ";" at the end of the rule');
      skipInside(r);
    }
    if (entry === null && exit === null) {
      r.complain(
        pos.line,
        "a glyph joined to nothing has no line here; one of its two anchors may be NULL, and not both",
      );
      return;
    }
    for (const glyph of glyphsNamed(list.glyphs, pos.line)) {
      const earlier = joins.get(glyph);
      if (earlier !== undefined) {
        r.complain(
          pos.line,
          `${glyph} already has its entry and exit, on line ${String(earlier.line)}`,
        );
        continue;
      }
      joins.set(glyph, { entry, exit, line: pos.line });
    }
  };

  const readOffer = (pos: { line: number }, feature: string): void => {
    const kind = r.take();
    if (kind?.text === "cursive") return readJoin(pos, feature);
    if (kind?.text !== "base" && kind?.text !== "mark" && kind?.text !== "ligature") {
      r.complain(
        pos.line,
        "only pos base, pos ligature, pos mark and pos cursive are written in the Marks file",
      );
      return skipInside(r);
    }
    const belongs = kind.text === "mark" ? "mkmk" : "mark";
    if (feature !== belongs) {
      r.complain(pos.line, `pos ${kind.text} belongs in feature ${belongs}`);
      return skipInside(r);
    }

    const list = readGlyphList(pos.line, r);
    if (list === null) return skipInside(r);

    // A ligature's places are named after the part they are on, which is
    // counted by the word between one part and the next.
    const found: { name: string; pt: Point | null }[] = [];
    let part = 1;
    for (;;) {
      if (kind.text === "ligature" && r.peek()?.text === "ligComponent") {
        r.take();
        part += 1;
        continue;
      }
      if (r.peek()?.text !== "<") break;
      const pt = readAnchor(pos.line);
      if (pt === undefined) return skipInside(r);
      // A part with no place at all is written as an anchor that is none,
      // with no class after it.
      if (pt === null && kind.text === "ligature" && r.peek()?.text !== "mark") {
        found.push({ name: "", pt });
        continue;
      }
      if (r.take()?.text !== "mark") {
        r.complain(pos.line, 'expected "mark" and a mark class after the anchor');
        return skipInside(r);
      }
      const named = r.take();
      const c = className(named?.text);
      if (c === null || !classes.has(c)) {
        r.complain(pos.line, `${named?.text ?? "the end"} is not a mark class defined above`);
        return skipInside(r);
      }
      found.push({ name: kind.text === "ligature" ? `${c}_${String(part)}` : c, pt });
    }
    if (found.length === 0) {
      r.complain(
        pos.line,
        `pos ${kind.text} names an anchor and the mark class that attaches there`,
      );
      return skipInside(r);
    }
    if (r.peek()?.text === ";") r.take();
    else {
      r.complain(pos.line, 'expected ";" at the end of the rule');
      skipInside(r);
    }

    for (const glyph of glyphsNamed(list.glyphs, pos.line)) {
      for (const { name, pt } of found) {
        if (pt === null) continue;
        const k = key(glyph, name);
        const earlier = offers.get(k);
        if (earlier !== undefined) {
          r.complain(
            pos.line,
            `${glyph} already offers ${placeSaid(name, kind.text)}, on line ${String(earlier.line)}`,
          );
          continue;
        }
        offers.set(k, { glyph, anchor: name, pt, line: pos.line, kind: kind.text });
      }
    }
  };

  /** A place as a complaint names it: by its class, and for a ligature by its part. */
  const placeSaid = (name: string, kind: string): string => {
    const numbered = kind === "ligature" ? ligaturePart(name) : null;
    return numbered === null
      ? `a place for ${MARK_CLASS_PREFIX}${name}`
      : `a place for ${MARK_CLASS_PREFIX}${numbered.stem} on part ${String(numbered.part)}`;
  };

  const readFeatureBlock = (keyword: { line: number }): void => {
    const tag = r.peek();
    if (tag === undefined || (tag.text !== "mark" && tag.text !== "mkmk" && tag.text !== "curs")) {
      r.complain(
        keyword.line,
        `feature ${tag?.text ?? ""} belongs in the feature file; ${SAYS_WHAT_IT_HOLDS}`,
      );
      return skipStatementOrBlock(r);
    }
    r.take();
    if (r.take()?.text !== "{") {
      r.complain(keyword.line, `expected "{" after feature ${tag.text}`);
      return skipInside(r);
    }
    // A lookup inside the feature is a round of classes, which is worked out
    // again from the anchors: its rules are read as the feature's own.
    const inside: string[] = [];
    for (;;) {
      const token = r.take();
      if (token === undefined) {
        r.complain(keyword.line, `feature ${tag.text} is never closed`);
        return;
      }
      if (token.text === "}") {
        const lookup = inside.pop();
        if (lookup === undefined) return closeBlock(r, "feature", tag.text);
        closeBlock(r, "lookup", lookup);
        continue;
      }
      if (token.text === ";") continue;
      if (token.text === "lookup" && tag.text !== "curs" && inside.length === 0) {
        const name = r.take();
        if (name === undefined || r.take()?.text !== "{") {
          r.complain(token.line, "a lookup here is a block of rules: lookup name { … } name;");
          skipInside(r);
          continue;
        }
        inside.push(name.text);
        continue;
      }
      if (token.text === "pos" || token.text === "position") {
        readOffer(token, tag.text);
        continue;
      }
      // The flags joins are compiled under, which the file states and which
      // are not a thing to change here: said again as they are, or not at all.
      if (token.text === "lookupflag" && tag.text === "curs") {
        const flags: string[] = [];
        while (r.peek() !== undefined && r.peek()!.text !== ";" && r.peek()!.text !== "}") {
          flags.push(r.take()!.text);
        }
        if (r.peek()?.text === ";") r.take();
        if (flags.sort().join(" ") !== "IgnoreMarks RightToLeft") {
          r.complain(
            token.line,
            "joins are compiled read from the end of the line and passing over marks: lookupflag RightToLeft IgnoreMarks, and no other",
          );
        }
        continue;
      }
      const holds =
        tag.text === "mark" ? "base and pos ligature" : tag.text === "mkmk" ? "mark" : "cursive";
      r.complain(
        token.line,
        `"${token.text}" belongs in the feature file; feature ${tag.text} here holds only pos ${holds} rules`,
      );
      skipInside(r);
    }
  };

  while (r.peek() !== undefined) {
    const token = r.take()!;
    if (token.text === ";") continue;
    if (token.text === "markClass") readMarkClass(token);
    else if (token.text === "feature") readFeatureBlock(token);
    else if (token.text.startsWith("@")) {
      if (!readClassDefinition(token, r)) skipStatementOrBlock(r);
    } else {
      r.complain(token.line, `"${token.text}" belongs in the feature file; ${SAYS_WHAT_IT_HOLDS}`);
      skipStatementOrBlock(r);
    }
  }

  // Which rule a glyph belongs in is decided by whether it is a mark, and that
  // is only known once every mark class has been read.
  const markGlyphs = new Set([...marks.values()].map((m) => m.glyph));
  const ligatureGlyphs = new Set(
    [...offers.values()].filter((o) => o.kind === "ligature").map((o) => o.glyph),
  );
  for (const offer of offers.values()) {
    if (offer.kind === "ligature" && markGlyphs.has(offer.glyph)) {
      r.complain(
        offer.line,
        `${offer.glyph} is a mark, so marks stack on it with pos mark, in feature mkmk`,
      );
    } else if (offer.kind === "ligature" && classes.has(offer.anchor)) {
      r.complain(
        offer.line,
        `${MARK_CLASS_PREFIX}${offer.anchor} is a mark class of its own, so ${offer.glyph} cannot have a part's place by that name`,
      );
    } else if (offer.kind === "base" && ligatureGlyphs.has(offer.glyph)) {
      r.complain(
        offer.line,
        `${offer.glyph} is a ligature, with a place on each part; it is not also a letter for pos base`,
      );
    } else if (offer.kind === "base" && markGlyphs.has(offer.glyph)) {
      r.complain(
        offer.line,
        `${offer.glyph} is a mark, so marks stack on it with pos mark, in feature mkmk`,
      );
    } else if (offer.kind === "mark" && !markGlyphs.has(offer.glyph)) {
      r.complain(
        offer.line,
        `${offer.glyph} is in no mark class, so marks attach to it with pos base, in feature mark`,
      );
    }
  }

  for (const [glyph, join] of joins) {
    for (const name of [ENTRY, EXIT]) {
      if (classes.has(name)) {
        r.complain(
          join.line,
          `${MARK_CLASS_PREFIX}${name} is a mark class, so ${glyph} cannot be joined by an anchor of that name`,
        );
      }
    }
  }

  const places: MarkPlace[] = [
    ...marks.values(),
    ...[...joins].flatMap(([glyph, join]) => [
      ...(join.entry === null ? [] : [{ glyph, anchor: ENTRY, pt: join.entry, line: join.line }]),
      ...(join.exit === null ? [] : [{ glyph, anchor: EXIT, pt: join.exit, line: join.line }]),
    ]),
    ...[...offers.values()].map(({ glyph, anchor: name, pt, line }) => ({
      glyph,
      anchor: name,
      pt,
      line,
    })),
  ];
  problems.sort((a, b) => a.line - b.line);
  return { places, classes: [...classes], problems };
}

/**
 * The glyphs whose anchors a clean reading of the Marks file changes, changed.
 *
 * Every anchor the file was written with is either still in it — and moved to
 * where it now says, keeping its id so a selection survives — or has been taken
 * out. An anchor the file never had a line for, because nothing attaches by its
 * name, is left alone: adding the first mark for `top` must not take away the
 * `top` every letter already carries for its components. Anchors the file adds
 * get new ids. Glyphs nothing changed in are not returned.
 */
export function placeMarks(
  glyphs: readonly Glyph[],
  reading: MarksSource,
  ids: IdFactory,
): Glyph[] {
  const classes = writtenClasses(glyphs);
  const wanted = new Map<GlyphName, MarkPlace[]>();
  for (const place of reading.places) {
    const list = wanted.get(place.glyph);
    if (list === undefined) wanted.set(place.glyph, [place]);
    else list.push(place);
  }

  const changed: Glyph[] = [];
  for (const g of glyphs) {
    const places = wanted.get(g.name) ?? [];
    const byName = new Map(places.map((p) => [p.anchor, p]));
    const placed = new Set<string>();
    const anchors: Anchor[] = [];
    let different = false;

    for (const a of g.anchors) {
      const place = byName.get(a.name);
      if (place !== undefined && !placed.has(a.name)) {
        placed.add(a.name);
        if (samePlace(a.pt, place.pt)) anchors.push(a);
        else {
          anchors.push({ ...a, pt: { x: place.pt.x, y: place.pt.y } });
          different = true;
        }
        continue;
      }
      if (!leftOut(g) && written(g, a, classes)) {
        different = true;
        continue;
      }
      anchors.push(a);
    }
    for (const place of places) {
      if (placed.has(place.anchor)) continue;
      anchors.push(anchor(ids.anchor(), place.anchor, { x: place.pt.x, y: place.pt.y }));
      different = true;
    }
    if (different) changed.push({ ...g, anchors });
  }
  return changed;
}
