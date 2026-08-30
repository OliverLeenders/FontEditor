/**
 * Identity for model objects.
 *
 * Ids are how selection survives an edit. Addressing a node by its position —
 * `contours[0].nodes[3]` — is what patches naturally want, but an index points
 * at a different node the moment a neighbour is inserted or deleted, so a stored
 * selection silently drifts onto the wrong thing. An id does not move.
 *
 * The factory is injected rather than global so tests get short, stable,
 * readable ids and the application gets unique ones. Nothing in the model reads
 * a clock, a global counter, or `Math.random` on its own.
 */

export type NodeId = string;
export type ContourId = string;
export type ComponentId = string;

export type IdFactory = {
  node(): NodeId;
  contour(): ContourId;
  component(): ComponentId;
};

/**
 * Deterministic ids: `n1`, `n2`, `c1`… Use this in tests and fixtures, where a
 * readable id in an assertion failure is worth more than global uniqueness.
 */
export function counterIds(prefix = ""): IdFactory {
  let nodes = 0;
  let contours = 0;
  let components = 0;
  return {
    node: () => `${prefix}n${++nodes}`,
    contour: () => `${prefix}c${++contours}`,
    component: () => `${prefix}k${++components}`,
  };
}

/**
 * Unique ids for application use: a random prefix drawn once per factory, then a
 * counter.
 *
 * Short enough to stay readable in a patch diff, and unique without
 * coordination — two factories collide only if they draw the same prefix. A full
 * UUID per node would be unambiguous but would make fixtures and patch diffs
 * much harder to read, for a guarantee this does not need.
 */
export function randomIds(): IdFactory {
  return counterIds(`${randomPrefix()}-`);
}

function randomPrefix(): string {
  const webCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}
