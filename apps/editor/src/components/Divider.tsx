import { useRef } from "react";

import { MAX_SPLIT_RATIO, MIN_SPLIT_RATIO, type SplitOrientation } from "../preferences.js";
import styles from "./Divider.module.css";

/** How far one arrow key moves the divider, as a share of the space. */
const STEP = 0.05;

/**
 * The line between two panes, dragged to share the space between them.
 *
 * What it reports is the first pane's share of the two, not a width in pixels,
 * so the panes keep their proportions when the window changes size. The store
 * holds the share inside its limits; this only says where the pointer is. Arrow
 * keys move it a step, Home and End to either limit, and a double-click puts it
 * back in the middle.
 */
export function Divider({
  orientation,
  ratio,
  onRatio,
}: {
  orientation: SplitOrientation;
  ratio: number;
  onRatio: (ratio: number) => void;
}): React.JSX.Element {
  const dragging = useRef(false);
  const row = orientation === "row";

  return (
    <div
      className={styles.divider}
      data-orientation={orientation}
      role="separator"
      tabIndex={0}
      // The line itself runs up and down between panes that sit side by side.
      aria-orientation={row ? "vertical" : "horizontal"}
      aria-label="Pane size"
      aria-valuemin={Math.round(MIN_SPLIT_RATIO * 100)}
      aria-valuemax={Math.round(MAX_SPLIT_RATIO * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        const box = event.currentTarget.parentElement?.getBoundingClientRect();
        if (box === undefined) return;
        onRatio(
          row ? (event.clientX - box.left) / box.width : (event.clientY - box.top) / box.height,
        );
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        dragging.current = false;
      }}
      onDoubleClick={() => onRatio(0.5)}
      onKeyDown={(event) => {
        const wanted =
          event.key === (row ? "ArrowLeft" : "ArrowUp")
            ? ratio - STEP
            : event.key === (row ? "ArrowRight" : "ArrowDown")
              ? ratio + STEP
              : event.key === "Home"
                ? MIN_SPLIT_RATIO
                : event.key === "End"
                  ? MAX_SPLIT_RATIO
                  : null;
        if (wanted === null) return;
        event.preventDefault();
        onRatio(wanted);
      }}
    />
  );
}
