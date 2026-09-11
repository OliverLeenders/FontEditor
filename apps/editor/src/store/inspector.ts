import {
  type InspectorDock,
  type InspectorPlacement,
  MAX_DOCK_WIDTH,
  MIN_DOCK_WIDTH,
  clampInspector,
} from "../preferences.js";
import { remember } from "./settings.js";
import type { StoreHost } from "./state.js";

/**
 * Where the inspector is: floating over the drawing or docked beside it, how
 * wide, and which of its sections are folded.
 *
 * Every part of it is a preference, remembered across sessions through the one
 * door every setting goes through, and none of it is the document — so none of
 * it is undoable, and none of it is saved with the font.
 */

/** Move the floating inspector, kept inside the window. */
export function moveInspector(host: StoreHost, x: number, y: number): void {
  place(host, { ...host.state().inspector, ...clampInspector(x, y) });
}

/** Pull the inspector back into view — after a resize, or a restore from a larger window. */
export function reclampInspector(host: StoreHost): void {
  const { inspector } = host.state();
  const { x, y } = clampInspector(inspector.x, inspector.y);
  if (x === inspector.x && y === inspector.y) return;
  place(host, { ...inspector, x, y });
}

/** How wide the docked column is, within what the layout will allow. */
export function resizeInspector(host: StoreHost, width: number): void {
  const { inspector } = host.state();
  const wanted = Math.round(Math.min(MAX_DOCK_WIDTH, Math.max(MIN_DOCK_WIDTH, width)));
  if (wanted === inspector.width) return;
  place(host, { ...inspector, width: wanted });
}

/**
 * Put the inspector in a column beside the drawing, or back over it.
 *
 * The floating position is kept while it is docked, so undocking puts it back
 * where it was rather than in a corner.
 */
export function dockInspector(host: StoreHost, dock: InspectorDock): void {
  const { inspector } = host.state();
  if (dock === inspector.dock) return;
  place(host, { ...inspector, dock, open: true });
}

/**
 * Fold a section of the inspector, or unfold it.
 *
 * The *choice* is remembered rather than the state: a section nobody has
 * touched follows the panel's own judgement, so one that starts closed opens
 * itself when something is put in it, and one you closed stays closed.
 */
export function toggleInspectorSection(host: StoreHost, name: string, open: boolean): void {
  const { inspector } = host.state();
  place(host, { ...inspector, sections: { ...inspector.sections, [name]: open } });
}

/** Show the inspector, or put it away. */
export function toggleInspector(host: StoreHost): void {
  const { inspector } = host.state();
  place(host, { ...inspector, open: !inspector.open });
}

function place(host: StoreHost, inspector: InspectorPlacement): void {
  remember(host, { inspector });
}
