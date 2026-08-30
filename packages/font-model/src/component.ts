import { type Affine, IDENTITY_AFFINE, applyAffine, composeAffine } from "@fonteditor/geometry";

import { type Contour, contour } from "./contour.js";
import type { ComponentId, IdFactory } from "./ids.js";
import { node } from "./node.js";

/**
 * A glyph placed inside another glyph.
 *
 * How accented letters are built: `aacute` is `a` and `acute`, each referred to
 * rather than copied, so correcting the `a` corrects every letter made from it.
 * That is the whole value, and it is also why a component is a reference and
 * never a snapshot.
 */
export type Component = {
  readonly id: ComponentId;
  /** The glyph being placed. Resolved by name, since names are what a font uses. */
  readonly base: string;
  readonly transform: Affine;
};

export function component(
  id: ComponentId,
  base: string,
  transform: Affine = IDENTITY_AFFINE,
): Component {
  return { id, base, transform };
}

export function movedComponent(c: Component, dx: number, dy: number): Component {
  return {
    ...c,
    transform: {
      ...c.transform,
      xOffset: c.transform.xOffset + dx,
      yOffset: c.transform.yOffset + dy,
    },
  };
}

/**
 * How deep a chain of components may go before we stop following it.
 *
 * A guard against depth, separate from the guard against cycles: a font can be
 * legitimately nested a few levels — a letter with an accent that is itself a
 * composite — but nothing sane goes deeper than this, and a very long chain is
 * as good as a hang.
 */
export const MAX_COMPONENT_DEPTH = 8;

/** Everything needed to resolve a component: the glyphs it might refer to. */
export type ComponentSource = {
  glyphOf(name: string): { contours: readonly Contour[]; components: readonly Component[] } | null;
};

/**
 * The contours a component draws, with its transform applied.
 *
 * Follows nesting, composing transforms as it goes rather than transforming the
 * same points repeatedly. `seen` is the cycle guard: a glyph that refers to
 * itself, directly or round a longer loop, would otherwise recurse until the
 * stack gave out. Fonts in the wild do contain such loops, and an editor that
 * hangs on opening one is worse than one that draws nothing.
 *
 * Contours come back with fresh ids from `ids`, because they are a *rendering*
 * of a component and not part of the glyph. Nothing may select or edit them —
 * the way to change them is to change the glyph they come from.
 */
export function resolveComponent(
  source: ComponentSource,
  base: string,
  transform: Affine,
  ids: IdFactory,
  seen: readonly string[] = [],
  depth = 0,
): Contour[] {
  if (depth >= MAX_COMPONENT_DEPTH) return [];
  if (seen.includes(base)) return [];

  const glyph = source.glyphOf(base);
  if (glyph === null) return [];

  const out: Contour[] = [];
  for (const c of glyph.contours) {
    out.push(
      contour(
        ids.contour(),
        c.nodes.map((n) =>
          node(ids.node(), applyAffine(transform, n.pt), {
            type: n.type,
            in: n.in === null ? null : applyAffine(transform, n.in),
            out: n.out === null ? null : applyAffine(transform, n.out),
            hvLock: n.hvLock,
          }),
        ),
        c.closed,
      ),
    );
  }

  for (const nested of glyph.components) {
    out.push(
      ...resolveComponent(
        source,
        nested.base,
        composeAffine(transform, nested.transform),
        ids,
        [...seen, base],
        depth + 1,
      ),
    );
  }

  return out;
}

/**
 * Every contour a glyph's components contribute, ready to draw alongside its own.
 *
 * The reason to call this rather than `resolveComponent` directly: the owner's
 * name has to seed the cycle guard, or a glyph referring to *itself* resolves
 * its own contours a second time and draws everything twice. That is not a
 * hypothetical — it is what the first version of the exporter did.
 */
export function resolveGlyphComponents(
  source: ComponentSource,
  owner: string,
  components: readonly Component[],
  ids: IdFactory,
): Contour[] {
  const out: Contour[] = [];
  for (const c of components) {
    out.push(...resolveComponent(source, c.base, c.transform, ids, [owner]));
  }
  return out;
}

/**
 * Whether placing `base` inside `owner` would create a loop.
 *
 * Asked *before* adding one, because refusing to create the cycle is far kinder
 * than drawing nothing afterwards and leaving the user to work out why.
 */
export function wouldRecurse(source: ComponentSource, owner: string, base: string): boolean {
  if (owner === base) return true;

  const stack = [base];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (name === owner) return true;
    if (seen.has(name)) continue;
    seen.add(name);

    const glyph = source.glyphOf(name);
    if (glyph === null) continue;
    for (const c of glyph.components) stack.push(c.base);
  }
  return false;
}
