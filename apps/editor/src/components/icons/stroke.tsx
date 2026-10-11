import { Glyph, type IconComponent } from "./glyph.js";

/**
 * The icons of a stroke's end: how it is cut, what it is closed with, and the
 * numbers of a serif.
 *
 * Drawn for this editor, not copied from Lucide, which has nothing for any of
 * them — but on Lucide's box and by its rules, so they sit beside the ones that
 * are: 24 units, a 2-unit stroke, round ends, no fill. One rule of their own on
 * top: a solid line is ink, and a dashed one is something the ink is measured
 * against or made with — the line of a cut, the outline of the pen, the levels
 * a serif stands between. The first of them, the cut square to the path, was
 * drawn by the font's designer and the rest follow it.
 */

/** A cut level: a stem standing on a level line. */
export const CutLevelIcon: IconComponent = () => (
  <Glyph>
    <path d="M12 3v14" />
    <path d="M10.5 17h3" />
    <path d="M3 17h3" />
    <path d="M18 17h3" />
  </Glyph>
);

/** A cut upright: a bar ending on an upright line. */
export const CutUprightIcon: IconComponent = () => (
  <Glyph>
    <path d="M3 12h14" />
    <path d="M17 10.5v3" />
    <path d="M17 3v3" />
    <path d="M17 18v3" />
  </Glyph>
);

/** A cut square to the path: a stroke on the slant, ending on a line square to it. */
export const CutSquareIcon: IconComponent = () => (
  <Glyph>
    <path d="M14 16L16 14" />
    <path d="M14.5 14.5L3.5 3.5" />
    <path d="M19 11L21 9" />
    <path d="M9 21L11 19" />
  </Glyph>
);

/** An end closed with the cut itself: the stroke's two sides, and the line across them. */
export const CloseStraightIcon: IconComponent = () => (
  <Glyph>
    <path d="M5 3v16" />
    <path d="M19 3v16" />
    <path d="M3.5 19h3" />
    <path d="M10.5 19h3" />
    <path d="M17.5 19h3" />
  </Glyph>
);

/**
 * An end closed with the pen's shape: the stroke's two sides, and the pen's
 * outline at their end. Six arcs of the one oval, three to a side and each the
 * mirror of one across the middle.
 */
export const CloseNibIcon: IconComponent = () => (
  <Glyph>
    <path d="M5 3v12" />
    <path d="M19 3v12" />
    <path d="M18.82 13.86A7 5 0 0 1 18.82 16.14" />
    <path d="M16.11 19.05A7 5 0 0 1 13.93 19.81" />
    <path d="M10.07 19.81A7 5 0 0 1 7.89 19.05" />
    <path d="M5.18 16.14A7 5 0 0 1 5.18 13.86" />
    <path d="M7.89 10.95A7 5 0 0 1 10.07 10.19" />
    <path d="M13.93 10.19A7 5 0 0 1 16.11 10.95" />
  </Glyph>
);

/** An end closed with a serif: the stroke's two sides, and the serif they stand on. */
export const CloseSerifIcon: IconComponent = () => (
  <Glyph>
    <path d="M7 3v12" />
    <path d="M17 3v12" />
    <path d="M7 15H4" />
    <path d="M3 17.5V19h2.5" />
    <path d="M10.5 19h3" />
    <path d="M17 15h3" />
    <path d="M21 17.5V19h-2.5" />
  </Glyph>
);

/** A serif's reach to the left: the left half of a bracketed serif, from the stroke's edge out. */
export const SerifReachLeftIcon: IconComponent = () => (
  <Glyph>
    <path d="M16 3v7c0 3.5-3.5 6-10 6v3h10" />
  </Glyph>
);

/** A serif's reach to the right: the other half. */
export const SerifReachRightIcon: IconComponent = () => (
  <Glyph>
    <path d="M8 3v7c0 3.5 3.5 6 10 6v3H8" />
  </Glyph>
);

/** A serif's height: a slab between the two levels it stands between. */
export const SerifHeightIcon: IconComponent = () => (
  <Glyph>
    <path d="M9 3v8H7v8h10v-8h-2V3" />
    <path d="M1 11h3" />
    <path d="M20 11h3" />
    <path d="M1 19h3" />
    <path d="M20 19h3" />
  </Glyph>
);

/** A serif's bracket: the corner between serif and stroke a curve, the tips square. */
export const SerifBracketIcon: IconComponent = () => (
  <Glyph>
    <path d="M9 3v7c0 3.5-2 6-6 6v3h18v-3c-4 0-6-2.5-6-6V3" />
  </Glyph>
);

/** A serif's slope: thinning in straight lines to a point at each tip. */
export const SerifSlopeIcon: IconComponent = () => (
  <Glyph>
    <path d="M9 3v10l-7 6h20l-7-6V3" />
  </Glyph>
);

/** A serif's cup: its foot hollowed. */
export const SerifCupIcon: IconComponent = () => (
  <Glyph>
    <path d="M9 3v11H3v5c5.5-3 12.5-3 18 0v-5h-6V3" />
  </Glyph>
);

/** The round of a serif's tips. */
export const SerifRoundIcon: IconComponent = () => (
  <Glyph>
    <path d="M9 3v11H5.5a2.5 2.5 0 0 0 0 5h13a2.5 2.5 0 0 0 0-5H15V3" />
  </Glyph>
);
