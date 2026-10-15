# Changelog

What changed in each version of Typewright, for somebody using it. The newest first.

Kept from 0.1.110 on. What came before is in the notes of each
[release](https://github.com/OliverLeenders/FontEditor/releases), and how the editor came to
be what it is, phase by phase, is in the [roadmap](docs/roadmap.md).

## Unreleased

### Variable fonts

- More strokes drawn with a pen vary in a variable font, where they were written as the
  default master draws them at every weight:
  - a hairpin narrower than the pen;
  - a broad edge whose masters turn it by different amounts along the stroke;
  - a pen with corners still turning where an open path begins or ends.
- A stroke that still cannot vary is named when the masters are checked against each other,
  and the export says why, with what about its pen to change.
- A rectangular pen turning at an open end is drawn closer to the shape it sweeps.

## 0.1.111

### New

- **Firefox.** Typewright opens and keeps fonts in Firefox. Saving to a folder on disk is not
  there, since Firefox has no way to ask for one; a font is taken out by exporting it.
- Fitting glyphs to the fixed width takes the layers behind the drawing along.

### Faster

- **Opening and saving a large font.** A font's glyphs are kept in one file in the browser,
  where each was a file of its own. A font of four thousand glyphs is saved in two seconds
  where Chrome took five and Firefox three minutes. Fonts already in the browser are moved
  over the first time they are opened, without anything to do.

- **Saving a large font to a folder.** Glyph files are written sixteen at a time where they
  were written one after another, each waiting for the last. Chrome on Windows takes about a
  tenth of a second for every file written to a disk, whatever is in it, so a font of four
  thousand glyphs took minutes.

### Fixed

- A component dragged lands on the font's grid, as a node does.
- A save there was no room for says so — _this browser's storage is full_ — and is tried
  again by itself. A font being opened when the room ran out is written once there is room,
  where it used to stay on screen and unsaved.
- A view that fails while it is drawn says so in its own pane, with **Try again**, and the
  rest of the window carries on. It used to take the whole window with it.
- What a font came in without is said on the status line, a line to each thing: the warnings
  of a font file or folder opened, and the glyphs a master, a copy put back or the browser's
  own copy could not give back. It was said as a number, or not at all.

## 0.1.110

- A pen with corners that turns as the path comes to a point is drawn by its corners, and
  varies in a variable font.

## 0.1.109

- **One glyph as an SVG**: **Export → SVG** for the glyph picked in the grid, and **Export as
  SVG** and **Copy as SVG** on a glyph's menu.
- A stroke ending in a drop shorter than the pen is thick varies in a variable font.
- A node off the grid lands on it when it is dragged, where it used to keep its distance from
  the lines.
