import {
  type InspectorDock,
  type InspectorPlacement,
  type InspectorTab,
  MAX_DOCK_WIDTH,
  MIN_DOCK_WIDTH,
} from "../preferences.js";
import { remember } from "./settings.js";
import type { StoreHost } from "./state.js";

/**
 * Where the inspector is: which edge it is a column at, how wide, which tab
 * is showing, and which of its sections are folded.
 *
 * Every part of it is a preference, remembered across sessions through the one
 * door every setting goes through, and none of it is the document — so none of
 * it is undoable, and none of it is saved with the font.
 */

/** How wide the docked column is, within what the layout will allow. */
export function resizeInspector(host: StoreHost, width: number): void {
  const { inspector } = host.state();
  const wanted = Math.round(Math.min(MAX_DOCK_WIDTH, Math.max(MIN_DOCK_WIDTH, width)));
  if (wanted === inspector.width) return;
  place(host, { ...inspector, width: wanted });
}

/** Put the inspector at the other edge of the drawing. */
export function dockInspector(host: StoreHost, dock: InspectorDock): void {
  const { inspector } = host.state();
  if (dock === inspector.dock) return;
  place(host, { ...inspector, dock, open: true });
}

/** Show one of the inspector's tabs. */
export function showInspectorTab(host: StoreHost, tab: InspectorTab): void {
  const { inspector } = host.state();
  if (tab === inspector.tab) return;
  place(host, { ...inspector, tab });
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
