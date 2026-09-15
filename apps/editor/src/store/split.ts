import { MAX_SPLIT_RATIO, MIN_SPLIT_RATIO, type SplitPlacement } from "../preferences.js";
import { remember } from "./settings.js";
import type { StoreHost } from "./state.js";

/**
 * How a split window is divided: side by side or stacked, and where the
 * divider sits.
 *
 * A preference, remembered through the door every setting goes through, and
 * kept whether or not the window is split at the moment — so splitting it again
 * puts the divider back where it was. Which workspaces are in the panes is not
 * here: that is where somebody is, and belongs to the window.
 */
export type SplitChanges = Partial<SplitPlacement>;

export function placeSplit(host: StoreHost, changes: SplitChanges): void {
  const current = host.state().split;
  const orientation = changes.orientation ?? current.orientation;
  const wanted = changes.ratio;
  // Three places are plenty for a divider, and a drag reports a new share on
  // every pixel; this keeps the writes to the ones that move it visibly.
  const ratio =
    wanted === undefined || !Number.isFinite(wanted)
      ? current.ratio
      : Math.round(Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, wanted)) * 1000) / 1000;
  if (orientation === current.orientation && ratio === current.ratio) return;
  remember(host, { split: { orientation, ratio } });
}
