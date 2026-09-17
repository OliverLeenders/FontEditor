import type {
  AnchorPoint,
  ContextRule,
  GlyphSet,
  ReadGdef,
  ReadLayout,
  ReadLookup,
  Subtable,
  ValueRecord,
} from "./layout-read.js";
import type { SourceKernSide, SourceKerning } from "./readkern.js";

/**
 * A font's layout tables, turned back into what this editor keeps.
 *
 * Three destinations, because the editor keeps what a font does in three
 * places. Kerning — pair adjustments of the advance in `kern` — goes into the
 * kerning model, where the Spacing workspace edits it. Mark attachment goes onto
 * the glyphs as anchors, which is where the Marks file and the compiler read it
 * from. Everything else becomes feature source: substitutions of every kind,
 * contextual rules, single adjustments, and the things this editor cannot yet
 * compile — ligature marks, cursive attachment, pair adjustments that are not
 * kerning — written out all the same, so a UFO saved from here carries them to
 * a tool that can, and named in the warnings so nobody is surprised that the
 * font exported from here does less.
 *
 * The source is written to be read: glyph sets that recur become named classes,
 * and every lookup is a named block in the order the font applies them, with
 * the features listing them by name. Order is the one thing that cannot be
 * tidied — two lookups in a different order are a different font — which is
 * why the lookups are not inlined into the features they belong to.
 */

export type RecoveredAnchor = { readonly name: string; readonly x: number; readonly y: number };

export type RecoveredLayout = {
  /** Feature source, or `""` where the font has nothing to say. */
  readonly features: string;
  /** Kerning read from GPOS, or `null` where GPOS has none and the caller should look elsewhere. */
  readonly kerning: SourceKerning | null;
  /** Anchors by glyph id. */
  readonly anchors: ReadonlyMap<number, readonly RecoveredAnchor[]>;
  readonly warnings: readonly string[];
};

export type LayoutTables = {
  readonly gsub: ReadLayout | null;
  readonly gpos: ReadLayout | null;
  readonly gdef: ReadGdef | null;
};

const FLAG_NAMES: readonly (readonly [number, string])[] = [
  [0x1, "RightToLeft"],
  [0x2, "IgnoreBaseGlyphs"],
  [0x4, "IgnoreLigatures"],
  [0x8, "IgnoreMarks"],
];

/** The features pure advance adjustments are kerning in: the model writes them back as `kern`. */
const KERNING_FEATURES = new Set(["kern", "dist"]);
const MARK_FEATURES = new Set(["mark", "mkmk", "abvm", "blwm"]);

/**
 * Recover a font's layout.
 *
 * `names` is every glyph's name by id, as the importer settled them, and
 * `xHeight` is what a mark class's anchors are measured against to name them.
 */
export function recoverLayout(
  tables: LayoutTables,
  names: readonly string[],
  xHeight: number,
): RecoveredLayout {
  const warnings: string[] = [
    ...(tables.gsub?.problems ?? []),
    ...(tables.gpos?.problems ?? []),
    ...(tables.gdef?.problems ?? []),
  ];
  const warn = (message: string): void => {
    if (!warnings.includes(message)) warnings.push(message);
  };

  const nameOf = (id: number): string => names[id] ?? `glyph${String(id)}`;

  // ---- kerning -----------------------------------------------------------------
  const gpos = tables.gpos;
  const kernLookups = gpos === null ? new Set<number>() : kerningLookups(gpos);
  const kerning = gpos === null || kernLookups.size === 0 ? null : kerningFrom(gpos, kernLookups);

  // ---- anchors -----------------------------------------------------------------
  const anchors = new Map<number, RecoveredAnchor[]>();
  const markLookups =
    gpos === null ? new Set<number>() : anchorsFrom(gpos, anchors, xHeight, names, warn);

  // ---- everything else, as source ---------------------------------------------
  const writer = new SourceWriter(nameOf, tables.gdef, warn);
  const gsubText = tables.gsub === null ? "" : writer.table("sub", tables.gsub, new Set());
  const gposText =
    gpos === null ? "" : writer.table("pos", gpos, new Set([...kernLookups, ...markLookups]));
  const features = writer.assemble(gsubText, gposText, tables);

  if (tables.gsub?.variations === true || gpos?.variations === true) {
    warn("the font varies its features across its axes, which is not imported");
  }

  return { features, kerning, anchors, warnings };
}

// ---- kerning ---------------------------------------------------------------------

/**
 * Lookups that are kerning and nothing else: pair adjustments in `kern` or
 * `dist` that move only the first glyph's advance, and are used by no other
 * feature. Those go into the kerning model; any other pair adjustment is kept
 * as source.
 */
function kerningLookups(gpos: ReadLayout): Set<number> {
  const out = new Set<number>();
  const usedElsewhere = new Set<number>();
  for (const feature of gpos.features) {
    for (const index of feature.lookups) {
      if (!KERNING_FEATURES.has(feature.tag)) usedElsewhere.add(index);
    }
  }
  for (const feature of gpos.features) {
    if (!KERNING_FEATURES.has(feature.tag)) continue;
    for (const index of feature.lookups) {
      const lookup = gpos.lookups[index];
      if (lookup === null || lookup === undefined || lookup.type !== 2) continue;
      if (usedElsewhere.has(index) || (lookup.flags & 0xff10) !== 0) continue;
      const pure = lookup.subtables.every(
        (s) => s.kind === "pairPos" && s.pairs.every((p) => onlyAdvance(p.one) && isEmpty(p.two)),
      );
      if (pure) out.add(index);
    }
  }
  return out;
}

const onlyAdvance = (v: ValueRecord): boolean =>
  v.xPlacement === 0 && v.yPlacement === 0 && v.yAdvance === 0 && !v.device;

const isEmpty = (v: ValueRecord): boolean => onlyAdvance(v) && v.xAdvance === 0;

function kerningFrom(gpos: ReadLayout, lookups: ReadonlySet<number>): SourceKerning {
  const firstGroups: number[][] = [];
  const secondGroups: number[][] = [];
  const pairs: { first: SourceKernSide; second: SourceKernSide; value: number }[] = [];
  const firstKey = new Map<string, number>();
  const secondKey = new Map<string, number>();

  const group = (sets: number[][], keys: Map<string, number>, glyphs: GlyphSet): number => {
    const key = glyphs.join(",");
    let index = keys.get(key);
    if (index === undefined) {
      index = sets.length;
      sets.push([...glyphs]);
      keys.set(key, index);
    }
    return index;
  };

  for (const index of [...lookups].sort((a, b) => a - b)) {
    for (const sub of gpos.lookups[index]?.subtables ?? []) {
      if (sub.kind !== "pairPos") continue;
      for (const p of sub.pairs) {
        if (p.one.xAdvance === 0) continue;
        const side = (glyphs: GlyphSet, sets: number[][], keys: Map<string, number>) =>
          p.classes
            ? ({ kind: "group", group: group(sets, keys, glyphs) } as const)
            : ({ kind: "glyph", glyph: glyphs[0]! } as const);
        pairs.push({
          first: side(p.first, firstGroups, firstKey),
          second: side(p.second, secondGroups, secondKey),
          value: p.one.xAdvance,
        });
      }
    }
  }
  return { firstGroups, secondGroups, pairs };
}

// ---- anchors ---------------------------------------------------------------------

/**
 * Mark attachment, as anchors on the glyphs.
 *
 * Each class of marks in a mark-to-base lookup is an anchor name: the letters
 * carry it and the marks carry it with an underscore. The name says where the
 * class sits — `top`, `bottom` or `center`, from where the letters' anchors are
 * against the x-height — and is numbered where two classes would share one. A
 * mark-to-mark class whose marks already have a name keeps it, which is what
 * makes an accent stack on an accent of its own kind.
 *
 * A lookup that would put two different places under one name on one glyph, or
 * that the compiler here would not rebuild the same way, is left to be written
 * as source instead. Returns the lookups that became anchors.
 */
function anchorsFrom(
  gpos: ReadLayout,
  anchors: Map<number, RecoveredAnchor[]>,
  xHeight: number,
  names: readonly string[],
  warn: (message: string) => void,
): Set<number> {
  const taken = new Map<string, string>(); // name → the sorted mark set it stands for
  const markName = new Map<number, string>(); // mark glyph → its class name
  const used = new Set<number>();

  const inMarkFeature = new Set<number>();
  for (const feature of gpos.features) {
    if (MARK_FEATURES.has(feature.tag)) for (const i of feature.lookups) inMarkFeature.add(i);
  }

  // Mark-to-base before mark-to-mark, so the second can take the first's names.
  const order = gpos.lookups
    .map((lookup, index) => ({ lookup, index }))
    .filter(
      (it): it is { lookup: ReadLookup; index: number } =>
        it.lookup !== null && (it.lookup.type === 4 || it.lookup.type === 6),
    )
    .sort((a, b) => a.lookup.type - b.lookup.type || a.index - b.index);

  for (const { lookup, index } of order) {
    if (!inMarkFeature.has(index)) continue;
    const proposal = new Map<number, RecoveredAnchor[]>();
    let fits = true;

    for (const sub of lookup.subtables) {
      if (sub.kind !== "markBase" && sub.kind !== "markMark") {
        fits = false;
        break;
      }
      for (let c = 0; c < sub.classCount; c++) {
        const marks = sub.marks.filter((m) => m.klass === c);
        if (marks.length === 0) continue;
        const key = marks
          .map((m) => m.glyph)
          .sort((a, b) => a - b)
          .join(",");
        const spots = sub.bases.flatMap((b) => {
          const a = b.anchors[c];
          return a === null || a === undefined ? [] : [a];
        });
        if (spots.some((a) => a.device || a.point !== null)) {
          fits = false;
          break;
        }

        const known = marks.map((m) => markName.get(m.glyph)).find((n) => n !== undefined);
        const name = known ?? nameFor(spots, xHeight, key, taken);
        taken.set(name, key);

        for (const m of marks) {
          if (
            !place(proposal, anchors, m.glyph, { name: `_${name}`, x: m.anchor.x, y: m.anchor.y })
          ) {
            fits = false;
          }
        }
        for (const b of sub.bases) {
          const a = b.anchors[c];
          if (a === null || a === undefined) continue;
          if (!place(proposal, anchors, b.glyph, { name, x: a.x, y: a.y })) fits = false;
        }
      }
      if (!fits) break;
    }

    if (!fits) {
      warn(
        `mark attachment lookup ${String(index)} could not be made into anchors, and is kept as feature source`,
      );
      continue;
    }

    for (const [glyph, list] of proposal) {
      const existing = anchors.get(glyph) ?? [];
      for (const a of list) {
        if (!existing.some((e) => e.name === a.name)) existing.push(a);
        if (a.name.startsWith("_")) markName.set(glyph, a.name.slice(1));
      }
      anchors.set(glyph, existing);
    }
    used.add(index);
  }

  // A mark with two attaching anchors is one the compiler here gives one class;
  // the font's other attachment is kept, but say which glyphs are affected.
  for (const [glyph, list] of anchors) {
    if (list.filter((a) => a.name.startsWith("_")).length > 1) {
      warn(
        `${names[glyph] ?? String(glyph)} attaches by more than one anchor, which export gives one class`,
      );
    }
  }

  return used;
}

/** Add an anchor to a proposal, refusing a name already placed elsewhere on that glyph. */
function place(
  proposal: Map<number, RecoveredAnchor[]>,
  settled: ReadonlyMap<number, readonly RecoveredAnchor[]>,
  glyph: number,
  anchor: RecoveredAnchor,
): boolean {
  const clash = (list: readonly RecoveredAnchor[] | undefined): boolean =>
    (list ?? []).some((a) => a.name === anchor.name && (a.x !== anchor.x || a.y !== anchor.y));
  if (clash(settled.get(glyph)) || clash(proposal.get(glyph))) return false;
  const list = proposal.get(glyph) ?? [];
  if (!list.some((a) => a.name === anchor.name)) list.push(anchor);
  proposal.set(glyph, list);
  return true;
}

/** A name for a class of marks, from where the letters carry it. */
function nameFor(
  spots: readonly AnchorPoint[],
  xHeight: number,
  key: string,
  taken: ReadonlyMap<string, string>,
): string {
  const ys = spots.map((s) => s.y).sort((a, b) => a - b);
  const middle = ys.length === 0 ? xHeight : ys[Math.floor(ys.length / 2)]!;
  const base = middle >= xHeight * 0.6 ? "top" : middle <= xHeight * 0.2 ? "bottom" : "center";

  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}${String(n)}`;
    const holder = taken.get(name);
    if (holder === undefined || holder === key) return name;
  }
}

// ---- source ------------------------------------------------------------------------

type Kind = "sub" | "pos";

class SourceWriter {
  private readonly classNames = new Map<string, string>();
  private readonly classOrder: { name: string; glyphs: GlyphSet }[] = [];
  private readonly setUses = new Map<string, number>();
  private readonly lookupNames = new Map<string, string>();
  private readonly markClasses = new Map<string, string>();
  private readonly markClassText: string[] = [];
  /** Sets are counted on a first pass and written on the second. */
  private counting = true;

  constructor(
    private readonly nameOf: (id: number) => string,
    private readonly gdef: ReadGdef | null,
    private readonly warn: (message: string) => void,
  ) {}

  /**
   * One table's lookups and features, as source. Lookups in `skip` have gone
   * elsewhere — into kerning or anchors — and a feature left with nothing is
   * not written.
   */
  table(kind: Kind, layout: ReadLayout, skip: ReadonlySet<number>): string {
    // Two passes over the same writing: the first counts how often each glyph
    // set turns up, so the second can name the ones worth naming.
    this.counting = true;
    this.lookupsText(kind, layout, skip);
    this.counting = false;
    const lookups = this.lookupsText(kind, layout, skip);
    const features = this.featuresText(kind, layout, skip);
    return [lookups, features].filter((t) => t !== "").join("\n\n");
  }

  assemble(gsub: string, gpos: string, tables: LayoutTables): string {
    const systems = languageSystems(tables);
    const parts: string[] = [];
    if (systems.length > 0) {
      parts.push(systems.map(([s, l]) => `languagesystem ${s} ${l};`).join("\n"));
    }
    const gdef = this.gdefText();
    if (this.classOrder.length > 0) {
      parts.push(this.classOrder.map((c) => `${c.name} = ${this.bracket(c.glyphs)};`).join("\n"));
    }
    if (gdef !== "") parts.push(gdef);
    if (this.markClassText.length > 0) parts.push(this.markClassText.join("\n"));
    if (gsub !== "") parts.push(gsub);
    if (gpos !== "") parts.push(gpos);
    return parts.length === 0 || (gsub === "" && gpos === "" && gdef === "")
      ? ""
      : `${parts.join("\n\n")}\n`;
  }

  // ---- lookups --------------------------------------------------------------

  private lookupName(kind: Kind, layout: ReadLayout, index: number): string {
    const key = `${kind}${String(index)}`;
    const found = this.lookupNames.get(key);
    if (found !== undefined) return found;

    const tag = layout.features.find((f) => f.lookups.includes(index))?.tag.trim();
    const stem = tag === undefined ? (kind === "sub" ? "substitute" : "position") : tag;
    let n = 1;
    let name = `${stem}_${String(n)}`;
    while ([...this.lookupNames.values()].includes(name)) name = `${stem}_${String(++n)}`;
    this.lookupNames.set(key, name);
    return name;
  }

  private lookupsText(kind: Kind, layout: ReadLayout, skip: ReadonlySet<number>): string {
    // A lookup only a contextual rule calls is applied where that rule says,
    // whatever its place in the list, and a rule can only call a lookup written
    // above it — so those come first. The rest keep the font's order, which is
    // the order they are applied in.
    const inFeature = new Set(layout.features.flatMap((f) => f.lookups));
    const called = new Set<number>();
    for (const lookup of layout.lookups) {
      for (const sub of lookup?.subtables ?? []) {
        if (sub.kind !== "context") continue;
        for (const rule of sub.rules) for (const l of rule.lookups) called.add(l.lookup);
      }
    }
    const indices = layout.lookups.map((_, i) => i);
    const order = [
      ...indices.filter((i) => called.has(i) && !inFeature.has(i)),
      ...indices.filter((i) => !(called.has(i) && !inFeature.has(i))),
    ];

    const blocks: string[] = [];
    for (const index of order) {
      const lookup = layout.lookups[index];
      if (lookup === undefined) continue;
      if (skip.has(index)) continue;
      if (lookup === null) continue;
      const name = this.lookupName(kind, layout, index);
      const flags = this.flagsText(lookup);
      const rules = lookup.subtables.flatMap((sub) => this.rulesOf(kind, layout, sub));
      if (rules.length === 0) continue;
      blocks.push(
        [
          `lookup ${name} {`,
          ...(flags === "" ? [] : [`    ${flags}`]),
          ...rules.map((r) => `    ${r}`),
          `} ${name};`,
        ].join("\n"),
      );
    }
    return blocks.join("\n\n");
  }

  private flagsText(lookup: ReadLookup): string {
    const words = FLAG_NAMES.filter(([bit]) => (lookup.flags & bit) !== 0).map(([, word]) => word);
    const attach = (lookup.flags & 0xff00) >> 8;
    if (attach !== 0 && this.gdef !== null) {
      const members = [...this.gdef.attach].filter(([, k]) => k === attach).map(([g]) => g);
      words.push(`MarkAttachmentType ${this.set(members, true)}`);
    }
    if (lookup.markFilteringSet !== null && this.gdef !== null) {
      const members = this.gdef.markSets[lookup.markFilteringSet] ?? [];
      words.push(`UseMarkFilteringSet ${this.set(members, true)}`);
    }
    return words.length === 0 ? "" : `lookupflag ${words.join(" ")};`;
  }

  private rulesOf(kind: Kind, layout: ReadLayout, sub: Subtable): string[] {
    const g = (id: number): string => this.nameOf(id);
    switch (sub.kind) {
      case "single": {
        if (sub.pairs.length === 1) {
          const [from, to] = sub.pairs[0]!;
          return [`sub ${g(from)} by ${g(to)};`];
        }
        // A run of one glyph for another reads best as the two lists side by
        // side, and compiles to exactly the same pairs. The lists pair by
        // position, so a list becomes a named class — whose glyphs are in font
        // order — only where it is in font order already.
        const from = sub.pairs.map((p) => p[0]);
        const to = sub.pairs.map((p) => p[1]);
        const list = (glyphs: number[]): string =>
          glyphs.every((id, i) => i === 0 || id > glyphs[i - 1]!)
            ? this.set(glyphs)
            : this.bracket(glyphs);
        return [`sub ${list(from)} by ${list(to)};`];
      }
      case "multiple":
        return sub.pairs.map(([from, to]) => `sub ${g(from)} by ${to.map(g).join(" ")};`);
      case "alternate":
        return sub.pairs.map(([from, to]) => `sub ${g(from)} from ${this.bracket(to)};`);
      case "ligature":
        return sub.ligatures.map((l) => `sub ${l.glyphs.map(g).join(" ")} by ${g(l.to)};`);
      case "reverse": {
        const back = [...sub.backtrack].reverse().map((s) => this.set(s));
        const ahead = sub.lookahead.map((s) => this.set(s));
        const from = this.set(sub.pairs.map((p) => p[0]));
        const to = this.set(sub.pairs.map((p) => p[1]));
        return [`rsub ${[...back, `${from}'`, ...ahead].join(" ")} by ${to};`];
      }
      case "context":
        return sub.rules.map((rule) => this.contextRule(kind, layout, rule));
      case "singlePos": {
        const byValue = new Map<string, number[]>();
        for (const [glyph, value] of sub.values) {
          this.noteDevice(value);
          const text = valueText(value);
          byValue.set(text, [...(byValue.get(text) ?? []), glyph]);
        }
        return [...byValue].map(([text, glyphs]) => `pos ${this.set(glyphs)} ${text};`);
      }
      case "pairPos":
        if (!this.counting) {
          this.warn(
            "pair adjustments other than kerning are kept as feature source, which this editor does not compile",
          );
        }
        return sub.pairs.map((p) => {
          this.noteDevice(p.one);
          this.noteDevice(p.two);
          const two = isEmpty(p.two) ? "" : ` ${fullValue(p.two)}`;
          const one =
            isEmpty(p.two) && onlyAdvance(p.one) ? String(p.one.xAdvance) : fullValue(p.one);
          return `pos ${this.set(p.first)} ${this.set(p.second)} ${one}${two};`;
        });
      case "cursive":
        if (!this.counting) {
          this.warn(
            "cursive attachment is kept as feature source, which this editor does not compile",
          );
        }
        return sub.glyphs.map(
          (c) => `pos cursive ${g(c.glyph)} ${anchorText(c.entry)} ${anchorText(c.exit)};`,
        );
      case "markBase":
      case "markMark": {
        const word = sub.kind === "markBase" ? "base" : "mark";
        const classes = this.markClassesOf(sub.marks, sub.classCount);
        return sub.bases.map((b) => {
          const parts = b.anchors.flatMap((a, c) =>
            a === null || classes[c] === undefined ? [] : [`${anchorText(a)} mark ${classes[c]}`],
          );
          return `pos ${word} ${g(b.glyph)} ${parts.join(" ")};`;
        });
      }
      case "markLigature": {
        if (!this.counting) {
          this.warn(
            "mark attachment to ligatures is kept as feature source, which this editor does not compile",
          );
        }
        const classes = this.markClassesOf(sub.marks, sub.classCount);
        return sub.ligatures.map((l) => {
          const components = l.components.map((row) => {
            const parts = row.flatMap((a, c) =>
              a === null || classes[c] === undefined ? [] : [`${anchorText(a)} mark ${classes[c]}`],
            );
            return parts.length === 0 ? "<anchor NULL>" : parts.join(" ");
          });
          return `pos ligature ${g(l.glyph)} ${components.join(" ligComponent ")};`;
        });
      }
    }
  }

  private contextRule(kind: Kind, layout: ReadLayout, rule: ContextRule): string {
    const back = [...rule.backtrack].reverse().map((s) => this.set(s));
    const ahead = rule.lookahead.map((s) => this.set(s));
    if (rule.lookups.length === 0) {
      const input = rule.input.map((s) => `${this.set(s)}'`);
      return `ignore ${kind} ${[...back, ...input, ...ahead].join(" ")};`;
    }
    const input = rule.input.map((s, i) => {
      const calls = rule.lookups
        .filter((l) => l.at === i)
        .map((l) => ` lookup ${this.lookupName(kind, layout, l.lookup)}`)
        .join("");
      return `${this.set(s)}'${calls}`;
    });
    return `${kind} ${[...back, ...input, ...ahead].join(" ")};`;
  }

  private markClassesOf(
    marks: readonly { glyph: number; klass: number; anchor: AnchorPoint }[],
    count: number,
  ): (string | undefined)[] {
    const out: (string | undefined)[] = [];
    for (let c = 0; c < count; c++) {
      const ofClass = marks.filter((m) => m.klass === c);
      if (ofClass.length === 0) {
        out.push(undefined);
        continue;
      }
      const key = ofClass
        .map((m) => `${String(m.glyph)}@${String(m.anchor.x)},${String(m.anchor.y)}`)
        .join(";");
      let name = this.markClasses.get(key);
      if (name === undefined) {
        name = `@MC_${String(this.markClasses.size + 1)}`;
        this.markClasses.set(key, name);
        for (const m of ofClass) {
          this.markClassText.push(
            `markClass ${this.nameOf(m.glyph)} ${anchorText(m.anchor)} ${name};`,
          );
        }
      }
      out.push(name);
    }
    return out;
  }

  private noteDevice(value: ValueRecord): void {
    if (value.device && !this.counting) {
      this.warn("device and variation adjustments in positioning are not imported");
    }
  }

  // ---- glyph sets --------------------------------------------------------------

  /** A glyph set as source: one name, a named class where it recurs, or a bracketed list. */
  private set(glyphs: GlyphSet, alwaysClass = false): string {
    if (glyphs.length === 1 && !alwaysClass) return this.nameOf(glyphs[0]!);
    const key = [...glyphs].sort((a, b) => a - b).join(",");
    if (this.counting) {
      this.setUses.set(key, (this.setUses.get(key) ?? 0) + 1);
      return "";
    }
    const named = this.classNames.get(key);
    if (named !== undefined) return named;
    if ((this.setUses.get(key) ?? 0) < 2 && !alwaysClass) return this.bracket(glyphs);

    const name = this.className(glyphs);
    this.classNames.set(key, name);
    this.classOrder.push({ name, glyphs: [...glyphs].sort((a, b) => a - b) });
    return name;
  }

  private bracket(glyphs: GlyphSet): string {
    return `[${glyphs.map((id) => this.nameOf(id)).join(" ")}]`;
  }

  /** `@sc` for a set of small capitals, `@class3` where the names say nothing in common. */
  private className(glyphs: GlyphSet): string {
    const names = glyphs.map((id) => this.nameOf(id));
    const suffixes = new Set(
      names.map((n) => (n.includes(".") ? n.slice(n.lastIndexOf(".") + 1) : "")),
    );
    const [only] = suffixes;
    let stem =
      suffixes.size === 1 && only !== undefined && /^[A-Za-z][A-Za-z0-9_]*$/.test(only)
        ? only
        : "class";
    if (stem !== "class" && [...this.classNames.values()].includes(`@${stem}`)) stem = `${stem}_`;
    let name = stem === "class" ? `@class${String(this.classOrder.length + 1)}` : `@${stem}`;
    let n = 2;
    while ([...this.classNames.values()].includes(name)) name = `@${stem}${String(n++)}`;
    return name;
  }

  // ---- features ---------------------------------------------------------------

  private featuresText(kind: Kind, layout: ReadLayout, skip: ReadonlySet<number>): string {
    const systems: {
      script: string;
      language: string;
      features: readonly number[];
      required: number | null;
    }[] = [];
    for (const script of layout.scripts) {
      if (script.fallback !== null) {
        systems.push({ script: script.tag, language: "dflt", ...script.fallback });
      }
      for (const lang of script.languages) {
        systems.push({ script: script.tag, language: lang.tag, ...lang.system });
      }
    }
    for (const s of systems) {
      if (s.required !== null) {
        this.warn(
          `a required feature in ${s.script.trim()} ${s.language.trim()} is imported as an ordinary one`,
        );
      }
    }

    const tags: string[] = [];
    for (const f of layout.features) if (!tags.includes(f.tag)) tags.push(f.tag);

    const blocks: string[] = [];
    for (const tag of tags) {
      if (layout.features.some((f) => f.tag === tag && f.params)) {
        this.warn(`the names and parameters of ${tag.trim()} are not imported`);
      }
      const lookupsIn = (indices: readonly number[]): number[] => {
        const set = new Set<number>();
        for (const i of indices) {
          const f = layout.features[i];
          if (f?.tag !== tag) continue;
          for (const l of f.lookups) if (!skip.has(l) && layout.lookups[l] !== null) set.add(l);
        }
        return [...set].sort((a, b) => a - b);
      };
      const per = systems.map((s) => ({
        ...s,
        lookups: lookupsIn([...s.features, ...(s.required === null ? [] : [s.required])]),
      }));
      const withAny = per.filter((s) => s.lookups.length > 0);
      if (withAny.length === 0) continue;

      const name = (l: number): string => this.lookupName(kind, layout, l);
      const same = per.every((s) => s.lookups.join(",") === withAny[0]!.lookups.join(","));
      const lines: string[] = [];
      if (same) {
        for (const l of withAny[0]!.lookups) lines.push(`    lookup ${name(l)};`);
      } else {
        let script = "";
        for (const s of per) {
          if (s.lookups.length === 0) continue;
          if (s.script !== script) {
            lines.push(`    script ${s.script.trim()};`);
            script = s.script;
          }
          lines.push(
            s.language === "dflt"
              ? "    language dflt;"
              : `    language ${s.language.trim()} exclude_dflt;`,
          );
          for (const l of s.lookups) lines.push(`        lookup ${name(l)};`);
        }
      }
      const trimmed = tag.trim();
      blocks.push([`feature ${trimmed} {`, ...lines, `} ${trimmed};`].join("\n"));
    }
    return blocks.join("\n\n");
  }

  // ---- GDEF -------------------------------------------------------------------

  private gdefText(): string {
    if (this.gdef === null) return "";
    const lines: string[] = [];
    if (this.gdef.classes.size > 0) {
      const of = (k: number): number[] =>
        [...this.gdef!.classes]
          .filter(([, c]) => c === k)
          .map(([g]) => g)
          .sort((a, b) => a - b);
      const list = (k: number): string => {
        const glyphs = of(k);
        return glyphs.length === 0 ? "" : this.bracket(glyphs);
      };
      lines.push(`    GlyphClassDef ${list(1)}, ${list(2)}, ${list(3)}, ${list(4)};`);
    }
    for (const [glyph, carets] of this.gdef.carets) {
      lines.push(`    LigatureCaretByPos ${this.nameOf(glyph)} ${carets.join(" ")};`);
    }
    return lines.length === 0 ? "" : ["table GDEF {", ...lines, "} GDEF;"].join("\n");
  }
}

/** Every script and language either table declares, `DFLT` first. */
function languageSystems(tables: LayoutTables): (readonly [string, string])[] {
  const out: (readonly [string, string])[] = [];
  const add = (s: string, l: string): void => {
    if (!out.some(([a, b]) => a === s && b === l)) out.push([s, l]);
  };
  for (const layout of [tables.gsub, tables.gpos]) {
    for (const script of layout?.scripts ?? []) {
      if (script.fallback !== null) add(script.tag.trim(), "dflt");
      for (const lang of script.languages) add(script.tag.trim(), lang.tag.trim());
    }
  }
  return out.sort((a, b) => (a[0] === "DFLT" ? -1 : b[0] === "DFLT" ? 1 : 0));
}

function valueText(v: ValueRecord): string {
  return onlyAdvance(v) ? String(v.xAdvance) : fullValue(v);
}

function fullValue(v: ValueRecord): string {
  return `<${String(v.xPlacement)} ${String(v.yPlacement)} ${String(v.xAdvance)} ${String(v.yAdvance)}>`;
}

function anchorText(a: AnchorPoint | null): string {
  if (a === null) return "<anchor NULL>";
  return a.point === null
    ? `<anchor ${String(a.x)} ${String(a.y)}>`
    : `<anchor ${String(a.x)} ${String(a.y)} contourpoint ${String(a.point)}>`;
}
