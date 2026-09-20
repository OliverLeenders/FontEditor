import { createContext, useContext } from "react";

import type { PaneIndex } from "./layout.js";

/**
 * Which pane a component is in.
 *
 * A workspace was written when the window was one pane and cannot tell whether
 * it has the window or half of it — which was the point, and stays the point
 * for everything about the font. What a canvas *shows*, though, is now a
 * setting per pane, so the few components that read one need to know which pane
 * they are drawing in.
 *
 * Passed through context rather than as a prop because it would otherwise be
 * threaded through every workspace on its way to the toolbar and the canvas,
 * and a prop that every component forwards and one component reads is a prop
 * that will be forgotten somewhere.
 *
 * The default is the first pane, which is the only one a window that has not
 * been split has: a component rendered outside a pane, in a test or a panel of
 * its own, asks about the window it can see.
 */
export const PaneContext = createContext<PaneIndex>(0);

export function usePane(): PaneIndex {
  return useContext(PaneContext);
}
