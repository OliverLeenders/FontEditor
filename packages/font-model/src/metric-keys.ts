import type { FontDocument, GlyphName } from "./document.js";
import { glyphNamed, updateGlyph } from "./document.js";
import { type Glyph, type MetricKeys, hasMetricKeys } from "./glyph.js";
import { type MetricKeyReference, parseMetricKey } from "./metric-key-text.js";
import { setLeftSidebearing, setRightSidebearing, sidebearings } from "./metrics.js";

/**
 * Spacing taken from another glyph.
 *
 * Spacing a family by hand means spacing it again after every change: `n` is
 * drawn, then `m` is fitted to it, then the stem gets a hair wider and both are
 * wrong. A metric key says the relationship instead of the number — "my left
 * side is `n`'s" — and the number is worked out from whatever `n` is now.
 *
 * Three of them, because there are three things to say. `left` and `right` take
 * a sidebearing from another glyph, which is what spacing a lower case is made
 * of: `o` from `c`, `d` from `b` reversed, `ü` from `u`. `width` takes the whole
 * advance, which is what a tabular figure or a fixed-width family wants.
 *
 * Empty means "this glyph's own", which is what nearly every glyph says. The
 * key is a glyph *name*, as a component's base and a kerning group's members
 * are, and renaming a glyph rewrites the keys that name it as it rewrites
 * those. What a key can say beyond a name is in `metric-key-text.ts`.
 *
 * The format has no field for these. UFO does not define them and neither does
 * OpenType, so they are written into the font's `lib` under this editor's own
 * name, and resolved into ordinary numbers when a font is compiled. What comes
 * out is a font like any other; what stays in the source is the rule.
 *
 * The type itself is in `glyph.ts`, where the field is. This is what follows
 * them, which takes the whole document.
 */

export type { MetricKeys };

/** The spacing a glyph ends up with, once its keys are followed. */
export type ResolvedMetrics = {
  readonly advance: number;
  /** `null` for a glyph with no outline, which has no side to measure from. */
  readonly left: number | null;
  readonly right: number | null;
};

/** Whether a key points back at the glyph that holds it. */
function isOwn(key: MetricKeyReference, holder: GlyphName): boolean {
  return key.glyph === "" || key.glyph === holder;
}

type ReadKeys = {
  readonly left: MetricKeyReference | null;
  readonly right: MetricKeyReference | null;
  readonly width: MetricKeyReference | null;
};

/** A glyph's three keys read, `null` for each it leaves empty, or `null` if one cannot be read. */
function readKeys(g: Glyph): ReadKeys | null {
  const read = (text: string): MetricKeyReference | null | undefined =>
    text === "" ? null : (parseMetricKey(text) ?? undefined);

  const left = read(g.metricKeys.left);
  const right = read(g.metricKeys.right);
  const width = read(g.metricKeys.width);
  if (left === undefined || right === undefined || width === undefined) return null;
  return { left, right, width };
}

/** Why a key could not be followed. */
export type MetricKeyProblem = {
  readonly glyph: GlyphName;
  readonly says: string;
};

/**
 * How deep a chain of keys may go.
 *
 * `ü` from `u` from `n` is ordinary and three is nowhere near the limit. What
 * this is really for is the case a cycle guard cannot see: a chain so long that
 * following it is the slow part of an export, which is a mistake rather than a
 * design.
 */
const MAX_DEPTH = 16;

/**
 * What a glyph's spacing works out to.
 *
 * `null` where the chain cannot be followed — a key naming a glyph that is not
 * there, a glyph that reaches itself, a chain past the limit. Refusing is the
 * only honest answer: a key that resolved to "whatever this glyph already said"
 * would look like it worked and quietly stop tracking the glyph it names.
 *
 * The order the three are applied in is left, then right, then width, and it
 * matters because each changes the advance. Setting the left side moves the
 * outline and takes the advance with it; setting the right side changes the
 * advance alone; setting the width says what the advance is regardless. So the
 * coarsest goes last and wins, which is what somebody who set both a width key
 * and a side key meant by setting the width key.
 *
 * A side taken from the glyph's own other side waits for that side to be
 * settled first, whatever it is keyed to, so `|` on the left of an `o` whose
 * right comes from `c` gives both sides the `c`'s number. Both sides taken from
 * each other settles neither, and is refused like any other loop.
 */
export function resolvedMetrics(
  document: FontDocument,
  name: GlyphName,
  depth = 0,
  seen: readonly GlyphName[] = [],
): ResolvedMetrics | null {
  const g = glyphNamed(document, name);
  if (g === null || depth > MAX_DEPTH || seen.includes(name)) return null;

  const keys = readKeys(g);
  if (keys === null) return null;

  const own = sidebearings(g, document);
  let advance = g.advance;
  let left = own?.left ?? null;
  let right = own?.right ?? null;

  const trail = [...seen, name];

  /** The number a side key asks for, read off another glyph or this one as it stands. */
  const taken = (key: MetricKeyReference, side: "left" | "right"): number | null => {
    const wanted = key.opposite ? (side === "left" ? "right" : "left") : side;
    let value: number | null;
    if (isOwn(key, name)) {
      // A side from the same side of itself says nothing, and followed once per
      // pass with an offset it would say something different every time.
      if (!key.opposite) return null;
      value = wanted === "left" ? left : right;
    } else {
      const from = resolvedMetrics(document, key.glyph, depth + 1, trail);
      value = from === null ? null : from[wanted];
    }
    return value === null ? null : value + key.offset;
  };

  const settleLeft = (): boolean => {
    if (keys.left === null) return true;
    const value = taken(keys.left, "left");
    if (value === null || left === null) return false;
    // The outline moves, and the advance moves with it: adding space on the
    // left adds space on the left rather than taking it off the right.
    advance += value - left;
    left = value;
    return true;
  };

  const settleRight = (): boolean => {
    if (keys.right === null) return true;
    const value = taken(keys.right, "right");
    if (value === null || right === null) return false;
    advance += value - right;
    right = value;
    return true;
  };

  const leftWaits = keys.left !== null && isOwn(keys.left, name);
  const rightWaits = keys.right !== null && isOwn(keys.right, name);
  if (leftWaits && rightWaits) return null;
  const settled = leftWaits ? settleRight() && settleLeft() : settleLeft() && settleRight();
  if (!settled) return null;

  if (keys.width !== null) {
    // A width has no other side, and a glyph's width from itself is its width.
    if (keys.width.opposite || isOwn(keys.width, name)) return null;
    const from = resolvedMetrics(document, keys.width.glyph, depth + 1, trail);
    if (from === null) return null;
    const wanted = from.advance + keys.width.offset;
    // The right side absorbs it, the left being where the outline sits.
    if (right !== null) right += wanted - advance;
    advance = wanted;
  }

  return { advance, left, right };
}

/**
 * The font with every key followed and turned into a number.
 *
 * What a compiler is handed. A font file has no way to say "this glyph is
 * spaced like that one" — it records an advance and an outline position, and
 * that is all a rasteriser ever sees — so the rule is resolved here and the
 * file that comes out is an ordinary one.
 *
 * A key that cannot be followed leaves the glyph exactly as it was drawn and is
 * reported. Silence would be worse than either alternative: the glyph is
 * spaced, so nothing looks broken, and it is spaced by a rule that stopped
 * working some edits ago.
 *
 * Done in passes until nothing moves, because a composite's ink is its base
 * glyphs' ink. When `a` is moved by its key, `aacute` moves with it; a single
 * pass measured the composite where the `a` used to be and moved it a second
 * time. The next pass measures it where the `a` now is and puts it right. A
 * font needs as many passes as its components are deep, and the depth guard
 * bounds that as it bounds the chain of keys.
 */
export function withResolvedMetrics(document: FontDocument): {
  readonly document: FontDocument;
  readonly problems: readonly MetricKeyProblem[];
} {
  const first = resolvingPass(document);
  let out = first.document;

  for (let pass = 1; pass < MAX_DEPTH && out !== document; pass++) {
    const next = resolvingPass(out).document;
    if (next === out) break;
    out = next;
  }

  return { document: out, problems: first.problems };
}

/** Every key in the font followed once, measured against the font as it stands. */
function resolvingPass(document: FontDocument): {
  readonly document: FontDocument;
  readonly problems: readonly MetricKeyProblem[];
} {
  const problems: MetricKeyProblem[] = [];
  let out = document;

  for (const name of document.glyphOrder) {
    const g = glyphNamed(document, name);
    if (g === null || !hasMetricKeys(g.metricKeys)) continue;

    const wanted = resolvedMetrics(document, name);
    if (wanted === null) {
      problems.push({ glyph: name, says: saysWhy(document, g) });
      continue;
    }

    const spaced = spacedTo(document, g, wanted);
    if (spaced !== g) out = updateGlyph(out, name, () => spaced) ?? out;
  }

  return { document: out, problems };
}

/** One glyph, moved and widened to the spacing its keys asked for. */
function spacedTo(document: FontDocument, g: Glyph, wanted: ResolvedMetrics): Glyph {
  let out = g;

  if (wanted.left !== null && g.metricKeys.left !== "") {
    out = setLeftSidebearing(out, wanted.left, document) ?? out;
  }
  if (wanted.right !== null && g.metricKeys.right !== "") {
    out = setRightSidebearing(out, wanted.right, document) ?? out;
  }
  if (g.metricKeys.width !== "") {
    out = out.advance === wanted.advance ? out : { ...out, advance: wanted.advance };
  }

  return out;
}

/** Which of the three keys is the broken one, said in a few words. */
function saysWhy(document: FontDocument, g: Glyph): string {
  const written = [g.metricKeys.left, g.metricKeys.right, g.metricKeys.width].filter(
    (text) => text !== "",
  );
  const unreadable = written.filter((text) => parseMetricKey(text) === null);
  if (unreadable.length > 0) {
    return `has a spacing key that cannot be read: ${unreadable.join(", ")}`;
  }

  const keys = readKeys(g);
  const others = [keys?.left, keys?.right, keys?.width]
    .filter((key): key is MetricKeyReference => key !== null && key !== undefined)
    .filter((key) => !isOwn(key, g.name))
    .map((key) => key.glyph);
  const missing = [...new Set(others.filter((n) => glyphNamed(document, n) === null))];

  if (missing.length > 0) {
    return `is spaced from ${missing.join(", ")}, which ${missing.length === 1 ? "is" : "are"} not in this font`;
  }
  if (sidebearings(g, document) === null) {
    return "is spaced from another glyph but has no outline to move";
  }
  if (keys?.width !== null && keys?.width !== undefined) {
    if (keys.width.opposite || isOwn(keys.width, g.name)) {
      return `takes its width from “${g.metricKeys.width}”, and a width has no other side to take`;
    }
  }
  const sides = [keys?.left, keys?.right].filter(
    (key): key is MetricKeyReference => key !== null && key !== undefined && isOwn(key, g.name),
  );
  if (sides.some((key) => !key.opposite)) {
    return "takes a side from the same side of itself, which says nothing";
  }
  if (sides.length === 2) {
    return "takes each side from the other, so neither is settled";
  }
  return "is spaced from a glyph that is spaced from it, round a loop";
}
