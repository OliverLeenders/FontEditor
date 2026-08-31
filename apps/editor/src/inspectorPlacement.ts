/**
 * Where the floating inspector sits, and how that survives a reload.
 *
 * Kept apart from the store because it is the one piece of interface state with
 * a life outside the session: it is read from `localStorage` before the store
 * exists and written back on every move.
 */

export type InspectorPlacement = {
  readonly x: number;
  readonly y: number;
  readonly open: boolean;
};

const KEY = "fonteditor.inspector";

export const DEFAULT_PLACEMENT: InspectorPlacement = { x: 24, y: 24, open: true };

/**
 * Keep enough of the panel on screen to grab it again.
 *
 * A floating panel that can be dragged fully off the edge is a floating panel
 * you cannot get back — and the position is remembered, so it would still be
 * gone after a reload.
 */
export function clampInspector(x: number, y: number): { x: number; y: number } {
  const grip = 80;
  const maxX = Math.max(0, window.innerWidth - grip);
  const maxY = Math.max(0, window.innerHeight - 28);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  };
}

export function loadInspector(): InspectorPlacement {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<InspectorPlacement>;
      const placed = clampInspector(
        typeof parsed.x === "number" ? parsed.x : DEFAULT_PLACEMENT.x,
        typeof parsed.y === "number" ? parsed.y : DEFAULT_PLACEMENT.y,
      );
      return { ...placed, open: parsed.open !== false };
    }
  } catch {
    // Private window, cleared site data, or storage blocked. A default is fine.
  }
  return DEFAULT_PLACEMENT;
}

export function saveInspector(inspector: InspectorPlacement): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(inspector));
  } catch {
    // Losing a remembered panel position is not worth interrupting anyone for.
  }
}
