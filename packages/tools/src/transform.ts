import { type Affine, applyAffine } from "@typewright/geometry";
import {
  type ContourId,
  type FontDocument,
  type GlyphName,
  type NodeId,
  NO_LOCK,
  enforceTangents,
  updateContour,
  updateGlyphInLayer,
} from "@typewright/font-model";
import type { Selection } from "@typewright/view";

/**
 * Moving a set of points by a matrix.
 *
 * Its own module because both halves of the editor need it and neither can
 * import the other: the commands call it once when a number is typed, and the
 * box gesture calls it on every pointer move.
 */

/**
 * The points moved, on a document rather than on the editor.
 *
 * Taken apart from {@link transformSelection} because a drag has to work from
 * where it started rather than from where it has got to: every pointer move
 * recomputes the whole transform against the document as it was when the drag
 * began, so the result depends on where the pointer is and not on how it got
 * there.
 *
 * `full` already carries the pivot. `loosen` drops the axis locks, which the
 * caller decides because only it knows whether the transform keeps them true.
 */
export function transformedDocument(
  document: FontDocument,
  glyphName: GlyphName,
  items: Selection,
  full: Affine,
  loosen: boolean,
  /** The layer the points are in, or `null` for the main drawing. */
  layer: string | null = null,
): FontDocument | null {
  const wanted = new Map<ContourId, Set<NodeId>>();
  for (const item of items) {
    if (item.part !== "point") continue;
    const ids = wanted.get(item.contourId) ?? new Set<NodeId>();
    ids.add(item.nodeId);
    wanted.set(item.contourId, ids);
  }
  if (wanted.size === 0) return null;

  let out: FontDocument | null = null;
  for (const [contourId, ids] of wanted) {
    const next = updateGlyphInLayer(out ?? document, glyphName, layer, (g) =>
      updateContour(g, contourId, (c) => {
        const nodes = c.nodes.map((n) =>
          ids.has(n.id)
            ? {
                ...n,
                pt: applyAffine(full, n.pt),
                in: n.in === null ? null : applyAffine(full, n.in),
                out: n.out === null ? null : applyAffine(full, n.out),
                hvLock: loosen ? NO_LOCK : n.hvLock,
              }
            : n,
        );
        // A tangent node whose straight side was left behind now has a line
        // pointing somewhere else, and its handle has to follow.
        return enforceTangents({ ...c, nodes });
      }),
    );
    if (next !== null) out = next;
  }
  return out;
}
