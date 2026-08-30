import { describe, expect, it } from "vitest";

import { cellBox, cellIndexAt, gridLayout, scrollToCell, visibleCells } from "../src/grid.js";

// 100-wide cells, 50 tall, 10 gap, 10 padding: a cell every 110 across, 60 down.
const options = { cellWidth: 100, cellHeight: 50, gap: 10, padding: 10 };
const layout = (count: number, width = 560) => gridLayout(count, width, options);

describe("gridLayout", () => {
  it("fits as many columns as the width allows", () => {
    // 560 wide, 20 padding: 540 usable, which is (100+10)*5 - 10 exactly.
    expect(layout(100).columns).toBe(5);
    expect(layout(100, 559).columns).toBe(4);
    expect(layout(100, 670).columns).toBe(6);
  });

  it("keeps one column in a viewport too narrow for even that", () => {
    expect(layout(10, 20).columns).toBe(1);
    expect(layout(10, 0).columns).toBe(1);
  });

  it("measures content height including padding at both ends", () => {
    expect(layout(5).rows).toBe(1);
    expect(layout(5).contentHeight).toBe(10 + 50 + 10);
    expect(layout(6).rows).toBe(2);
    expect(layout(6).contentHeight).toBe(10 + 50 + 10 + 50 + 10);
  });

  it("has no height when there is nothing to show", () => {
    expect(layout(0).rows).toBe(0);
    expect(layout(0).contentHeight).toBe(0);
  });
});

describe("cellBox", () => {
  it("places cells across then down", () => {
    expect(cellBox(layout(12), 0)).toEqual({ x: 10, y: 10, width: 100, height: 50 });
    expect(cellBox(layout(12), 4)).toEqual({ x: 450, y: 10, width: 100, height: 50 });
    expect(cellBox(layout(12), 5)).toEqual({ x: 10, y: 70, width: 100, height: 50 });
  });

  it("returns null outside the range", () => {
    expect(cellBox(layout(3), 3)).toBeNull();
    expect(cellBox(layout(3), -1)).toBeNull();
    expect(cellBox(layout(3), 1.5)).toBeNull();
  });
});

describe("visibleCells", () => {
  it("covers the viewport plus the overscan rows", () => {
    // 100 cells, 5 columns, 20 rows. Viewport 120 tall from the top shows rows
    // 0 and 1; one row of overscan adds row 2.
    expect(visibleCells(layout(100), 0, 120)).toEqual({ first: 0, last: 14 });
  });

  it("moves the window as the grid scrolls", () => {
    // Scrolled to row 5 (y = 10 + 5*60 = 310), so rows 4..8 with overscan.
    expect(visibleCells(layout(100), 310, 120)).toEqual({ first: 20, last: 44 });
  });

  it("never runs past the last cell, even on a ragged final row", () => {
    // 12 cells over 5 columns: the last row holds only two.
    const range = visibleCells(layout(12), 0, 1000);
    expect(range).toEqual({ first: 0, last: 11 });
  });

  it("takes no overscan when asked for none", () => {
    expect(visibleCells(layout(100), 0, 120, 0)).toEqual({ first: 0, last: 9 });
  });

  it("returns null for an empty grid and for a scroll past the end", () => {
    expect(visibleCells(layout(0), 0, 500)).toBeNull();
    expect(visibleCells(layout(100), 100000, 120)).toBeNull();
  });
});

describe("cellIndexAt", () => {
  it("finds the cell under a point", () => {
    expect(cellIndexAt(layout(12), 15, 15)).toBe(0);
    expect(cellIndexAt(layout(12), 109, 59)).toBe(0);
    expect(cellIndexAt(layout(12), 120, 15)).toBe(1);
    expect(cellIndexAt(layout(12), 15, 75)).toBe(5);
  });

  it("treats the gap between cells as a miss, not as the nearest cell", () => {
    // x 110..119 is the gap between column 0 and column 1.
    expect(cellIndexAt(layout(12), 115, 15)).toBeNull();
    // y 60..69 is the gap between row 0 and row 1.
    expect(cellIndexAt(layout(12), 15, 65)).toBeNull();
  });

  it("treats the padding as a miss", () => {
    expect(cellIndexAt(layout(12), 5, 15)).toBeNull();
    expect(cellIndexAt(layout(12), 15, 5)).toBeNull();
    expect(cellIndexAt(layout(12), -20, -20)).toBeNull();
  });

  it("returns null past the last cell of a ragged row", () => {
    // 12 cells, 5 columns: row 2 holds indices 10 and 11 only.
    expect(cellIndexAt(layout(12), 15, 135)).toBe(10);
    expect(cellIndexAt(layout(12), 245, 135)).toBeNull();
  });
});

describe("scrollToCell", () => {
  const grid = layout(100); // 20 rows of 5

  it("says nothing to do when the cell is already in view", () => {
    expect(scrollToCell(grid, 0, 0, 300)).toBeNull();
  });

  it("scrolls up by the least that reveals the cell", () => {
    // Cell 0 sits at y = 10; from a scroll of 500 the minimum is its top edge.
    expect(scrollToCell(grid, 0, 500, 300)).toBe(0);
    // Row 5 starts at y = 310.
    expect(scrollToCell(grid, 25, 500, 300)).toBe(300);
  });

  it("scrolls down by the least that reveals the cell", () => {
    // Cell 30 is row 6, spanning y 370..420. A 300-tall viewport has to scroll
    // to 130 so that 420 plus the trailing padding sits at its bottom edge.
    expect(scrollToCell(grid, 30, 0, 300)).toBe(130);
  });

  it("returns null for a cell that does not exist", () => {
    expect(scrollToCell(grid, 500, 0, 300)).toBeNull();
  });
});
