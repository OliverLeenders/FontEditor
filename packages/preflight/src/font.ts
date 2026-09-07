import type { FontDocument, GlyphName } from "@fonteditor/font-model";
import {
  groupNameOf,
  isGroupKey,
  isMarkAnchor,
  orderedGlyphs,
  pairedName,
} from "@fonteditor/font-model";

import { type Finding, finding } from "./finding.js";

/**
 * What can only be found by looking at the whole font.
 *
 * Every one of these is a relationship: two glyphs claiming one character, a
 * pair naming a glyph that has gone, an accent whose anchor no letter offers.
 * None of them is visible from inside the glyph that has it, which is exactly
 * why they survive so long in a font.
 */
export function fontFindings(document: FontDocument): Finding[] {
  return [
    ...notdefFindings(document),
    ...unicodeFindings(document),
    ...kerningFindings(document),
    ...markFindings(document),
  ];
}

function notdefFindings(document: FontDocument): Finding[] {
  if (".notdef" in document.glyphs) return [];
  return [
    finding("no-notdef", null, "The font has no .notdef; one is invented when it is exported."),
  ];
}

function unicodeFindings(document: FontDocument): Finding[] {
  const owners = new Map<number, GlyphName[]>();
  for (const g of orderedGlyphs(document)) {
    for (const code of g.unicodes) {
      const list = owners.get(code) ?? [];
      list.push(g.name);
      owners.set(code, list);
    }
  }

  const out: Finding[] = [];
  for (const [code, names] of owners) {
    if (names.length < 2) continue;
    // Against the first one, which is the one the character map keeps: the
    // finding belongs to the glyph that loses.
    const [kept, ...lost] = names;
    for (const name of lost) {
      out.push(
        finding(
          "duplicate-unicode",
          name,
          `${hex(code)} is on ${String(kept)} as well, and that is the one the font will use.`,
        ),
      );
    }
  }

  return out;
}

function kerningFindings(document: FontDocument): Finding[] {
  const out: Finding[] = [];
  const { kerning } = document;
  const here = (name: string): boolean => name in document.glyphs;

  for (const [side, groups] of [
    ["first", kerning.firstGroups],
    ["second", kerning.secondGroups],
  ] as const) {
    for (const [name, members] of Object.entries(groups)) {
      if (members.length === 0) {
        out.push(finding("empty-kern-group", null, `The ${side} group ${name} has no glyphs.`));
        continue;
      }
      const gone = members.filter((m) => !here(m));
      if (gone.length > 0) {
        out.push(
          finding(
            "kern-missing-glyph",
            null,
            `The ${side} group ${name} names ${list(gone)}, which ${gone.length === 1 ? "is" : "are"} not in the font.`,
          ),
        );
      }
    }
  }

  // A side of a pair is either a group, which is checked above, or a glyph,
  // which has to exist for the pair to ever apply.
  const known = (key: string): boolean => {
    if (!isGroupKey(key)) return here(key);
    const name = groupNameOf(key);
    return name in kerning.firstGroups || name in kerning.secondGroups;
  };

  for (const [first, seconds] of Object.entries(kerning.pairs)) {
    for (const second of Object.keys(seconds)) {
      const missing = [first, second].filter((k) => !known(k));
      if (missing.length === 0) continue;
      out.push(
        finding(
          "kern-missing-glyph",
          null,
          `The pair ${first} ${second} names ${list(missing)}, which ${missing.length === 1 ? "is" : "are"} not in the font.`,
        ),
      );
    }
  }

  return out;
}

/**
 * Accents that attach by a name nothing offers.
 *
 * `_top` on an accent pairs with `top` on a letter. Where no glyph in the font
 * has the `top`, the accent is never positioned by the font on anything — which
 * looks like working software right up until somebody types the two characters
 * instead of using the composite.
 */
function markFindings(document: FontDocument): Finding[] {
  const offered = new Set<string>();
  for (const g of orderedGlyphs(document)) {
    for (const a of g.anchors) if (!isMarkAnchor(a)) offered.add(a.name);
  }

  const out: Finding[] = [];
  for (const g of orderedGlyphs(document)) {
    for (const a of g.anchors) {
      const wanted = pairedName(a);
      if (wanted === null || wanted === "" || offered.has(wanted)) continue;
      out.push(
        finding("mark-without-base", g.name, `It attaches by ${wanted}, which no glyph offers.`),
      );
    }
  }

  return out;
}

/**
 * Glyphs tracing from a picture the font does not have.
 *
 * Only asked where the caller knows what the font holds: the images live beside
 * the document rather than in it, so a check that guessed would report every
 * tracing in a font whose pictures simply were not handed over.
 */
export function imageFindings(document: FontDocument, images: ReadonlySet<string>): Finding[] {
  const out: Finding[] = [];
  for (const g of orderedGlyphs(document)) {
    if (g.image === null || images.has(g.image.name)) continue;
    out.push(
      finding("missing-image", g.name, `It traces from ${g.image.name}, which is not here.`),
    );
  }
  return out;
}

const hex = (code: number): string => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;

const list = (names: readonly string[]): string =>
  names.length <= 3
    ? names.join(", ")
    : `${names.slice(0, 3).join(", ")} and ${String(names.length - 3)} more`;
