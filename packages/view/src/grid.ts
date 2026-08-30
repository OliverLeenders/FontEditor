/**
 * A cell's box, in position-and-size form.
 *
 * Not `Rect`, which is min/max: this is the shape canvas drawing and CSS both
 * want, and converting at every call site would be noise. The two are not
 * interchangeable and keeping them distinct is what stops a width being read as
 * a right edge.
 */
export type CellBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Layout for a scrolling grid of equal cells.
 *
 * Pure arithmetic, deliberately knowing nothing about glyphs or canvases. It is
 * here rather than inside the browser component because virtualisation is the
 * part that goes subtly wrong — an off-by-one in the visible range shows as a
 * row that blanks out near the edge of a scroll, which is miserable to chase by
 * scrolling and easy to pin down with an assertion.
 *
 * Coordinates are *content* coordinates: y measured from the top of the whole
 * scrollable content, not of the viewport. Converting is the caller's job and is
 * one subtraction.
 */
export type GridLayout = {
  readonly count: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly gap: number;
  readonly padding: number;
  readonly columns: number;
  readonly rows: number;
  /** Total scrollable height, including padding at both ends. */
  readonly contentHeight: number;
};

export type GridOptions = {
  readonly cellWidth?: number;
  readonly cellHeight?: number;
  readonly gap?: number;
  readonly padding?: number;
};

export const DEFAULT_GRID: Required<GridOptions> = {
  cellWidth: 76,
  cellHeight: 92,
  gap: 8,
  padding: 12,
};

export function gridLayout(
  count: number,
  viewportWidth: number,
  options: GridOptions = {},
): GridLayout {
  const cellWidth = options.cellWidth ?? DEFAULT_GRID.cellWidth;
  const cellHeight = options.cellHeight ?? DEFAULT_GRID.cellHeight;
  const gap = options.gap ?? DEFAULT_GRID.gap;
  const padding = options.padding ?? DEFAULT_GRID.padding;

  // At least one column even in a viewport too narrow to hold one, so a cramped
  // window shows a clipped cell rather than dividing by zero and vanishing.
  const usable = viewportWidth - padding * 2;
  const columns = Math.max(1, Math.floor((usable + gap) / (cellWidth + gap)));
  const rows = Math.ceil(count / columns);
  const contentHeight = rows === 0 ? 0 : padding * 2 + rows * cellHeight + (rows - 1) * gap;

  return { count, cellWidth, cellHeight, gap, padding, columns, rows, contentHeight };
}

/** Where a cell sits, in content coordinates. `null` if the index is outside. */
export function cellBox(layout: GridLayout, index: number): CellBox | null {
  if (!Number.isInteger(index) || index < 0 || index >= layout.count) return null;

  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  return {
    x: layout.padding + column * (layout.cellWidth + layout.gap),
    y: layout.padding + row * (layout.cellHeight + layout.gap),
    width: layout.cellWidth,
    height: layout.cellHeight,
  };
}

/**
 * The cells that need drawing for a given scroll position.
 *
 * Inclusive at both ends, and `null` when nothing is in view. `overscan` rows
 * beyond the viewport are included on each side so a fast scroll does not
 * outrun the next frame and expose an empty band.
 */
export function visibleCells(
  layout: GridLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan = 1,
): { readonly first: number; readonly last: number } | null {
  if (layout.count === 0 || layout.rows === 0) return null;

  const stride = layout.cellHeight + layout.gap;
  const top = scrollTop - layout.padding;
  const bottom = top + viewportHeight;

  const firstRow = Math.max(0, Math.floor(top / stride) - overscan);
  const lastRow = Math.min(layout.rows - 1, Math.floor(bottom / stride) + overscan);
  if (lastRow < firstRow) return null;

  const first = firstRow * layout.columns;
  const last = Math.min(layout.count - 1, (lastRow + 1) * layout.columns - 1);
  return first > last ? null : { first, last };
}

/**
 * The cell at a point in content coordinates, or `null`.
 *
 * A hit in the gap between cells is a miss rather than the nearest cell. Cells
 * are close together, and rounding to the nearest one would make it easy to
 * open the wrong glyph by clicking a hair off target.
 */
export function cellIndexAt(layout: GridLayout, x: number, y: number): number | null {
  const stride = { x: layout.cellWidth + layout.gap, y: layout.cellHeight + layout.gap };
  const local = { x: x - layout.padding, y: y - layout.padding };
  if (local.x < 0 || local.y < 0) return null;

  const column = Math.floor(local.x / stride.x);
  const row = Math.floor(local.y / stride.y);
  if (column >= layout.columns || row >= layout.rows) return null;
  if (local.x - column * stride.x > layout.cellWidth) return null;
  if (local.y - row * stride.y > layout.cellHeight) return null;

  const index = row * layout.columns + column;
  return index < layout.count ? index : null;
}

/**
 * A scroll position that brings a cell fully into view, or `null` if it already
 * is. Scrolls the minimum distance, so arrow-keying down a grid advances one row
 * at a time instead of recentring on every step.
 */
export function scrollToCell(
  layout: GridLayout,
  index: number,
  scrollTop: number,
  viewportHeight: number,
): number | null {
  const box = cellBox(layout, index);
  if (box === null) return null;

  if (box.y < scrollTop + layout.padding) return Math.max(0, box.y - layout.padding);

  const bottom = box.y + box.height;
  if (bottom > scrollTop + viewportHeight - layout.padding) {
    return bottom + layout.padding - viewportHeight;
  }
  return null;
}
