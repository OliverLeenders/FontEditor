import { Glyph, type IconComponent } from "./glyph.js";

/**
 * The toolbar's icons, and the transform panel's.
 *
 * Copied from Lucide (ISC licence) rather than depended on: the toolbar set
 * came from lucide-static v1.40.0 and the transform panel's from v1.41.0, and
 * two dozen drawings is not worth a package, and copying them means there is
 * nothing to fetch at runtime, nothing to shift while a font loads, and no
 * difference between these and the ones we draw ourselves later. The editor is
 * a tool that should open offline.
 *
 * Each is Lucide's own path data, unchanged, on the box `Glyph` gives it.
 *
 * Two are not the obvious pick from the set. `Handles` is Lucide's *tangent* —
 * a curve with a line touching it at two points, which is what a Bézier handle
 * is — rather than a spline drawn without controls. `Fit` is *expand*, arrows
 * to all four corners, rather than the plain maximize box.
 */

/** Select: the arrow, which is the one icon nobody has to learn. */
export const SelectIcon: IconComponent = () => (
  <Glyph>
    <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" />
  </Glyph>
);

/** Pen: a nib with its control point, which is what the tool actually places. */
export const PenIcon: IconComponent = () => (
  <Glyph>
    <path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z" />
    <path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18" />
    <path d="m2.3 2.3 7.286 7.286" />
    <circle cx="11" cy="11" r="2" />
  </Glyph>
);

/** Knife: a blade drawn as a stroke across something, which is the gesture. */
export const KnifeIcon: IconComponent = () => (
  <Glyph>
    <path d="M11 16.586V19a1 1 0 0 1-1 1H2L18.37 3.63a1 1 0 1 1 3 3l-9.663 9.663a1 1 0 0 1-1.414 0L8 14" />
  </Glyph>
);

export const RectIcon: IconComponent = () => (
  <Glyph>
    <rect width="18" height="18" x="3" y="3" rx="2" />
  </Glyph>
);

export const EllipseIcon: IconComponent = () => (
  <Glyph>
    <circle cx="12" cy="12" r="10" />
  </Glyph>
);

export const MeasureIcon: IconComponent = () => (
  <Glyph>
    <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
    <path d="m14.5 12.5 2-2" />
    <path d="m11.5 9.5 2-2" />
    <path d="m8.5 6.5 2-2" />
    <path d="m17.5 15.5 2-2" />
  </Glyph>
);

/** Handles: a tangent — the curve, and the line that touches it. */
export const HandlesIcon: IconComponent = () => (
  <Glyph>
    <circle cx="17" cy="4" r="2" />
    <path d="M15.59 5.41 5.41 15.59" />
    <circle cx="4" cy="17" r="2" />
    <path d="M12 22s-4-9-1.5-11.5S22 12 22 12" />
  </Glyph>
);

/** Snap: a magnet, which is the settled metaphor for it everywhere else. */
export const SnapIcon: IconComponent = () => (
  <Glyph>
    <path d="m12 15 4 4" />
    <path d="M2.352 10.648a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.029-6.029a1 1 0 1 1 3 3l-6.029 6.029a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.365-6.367A1 1 0 0 0 8.716 4.282z" />
    <path d="m5 8 4 4" />
  </Glyph>
);

/** Overlap: two circles crossing, which is the shape of the problem it solves. */
export const OverlapIcon: IconComponent = () => (
  <Glyph>
    <circle cx="15" cy="9" r="7" />
    <circle cx="9" cy="15" r="7" />
  </Glyph>
);

export const UndoIcon: IconComponent = () => (
  <Glyph>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
  </Glyph>
);

export const RedoIcon: IconComponent = () => (
  <Glyph>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />
  </Glyph>
);

/** The stepper's arrows, beside a number field. */
export const ChevronUpIcon: IconComponent = () => (
  <Glyph>
    <path d="m18 15-6-6-6 6" />
  </Glyph>
);

export const ChevronDownIcon: IconComponent = () => (
  <Glyph>
    <path d="m6 9 6 6 6-6" />
  </Glyph>
);

/** Preferences: sliders, which is what most of the panel is. */
export const PreferencesIcon: IconComponent = () => (
  <Glyph>
    <path d="M10 5H3" />
    <path d="M12 19H3" />
    <path d="M14 3v4" />
    <path d="M16 17v4" />
    <path d="M21 12h-9" />
    <path d="M21 19h-5" />
    <path d="M21 5h-7" />
    <path d="M8 10v4" />
    <path d="M8 12H3" />
  </Glyph>
);

/** Fit: arrows to all four corners, which is what fitting the glyph does. */
export const FitIcon: IconComponent = () => (
  <Glyph>
    <path d="m15 15 6 6" />
    <path d="m15 9 6-6" />
    <path d="M21 16v5h-5" />
    <path d="M21 8V3h-5" />
    <path d="M3 16v5h5" />
    <path d="m3 21 6-6" />
    <path d="M3 8V3h5" />
    <path d="M9 9 3 3" />
  </Glyph>
);

/**
 * The transform panel's own.
 *
 * `Baseline` is the one drawn for exactly our meaning rather than borrowed
 * toward it: an A sitting on a line is a letterform on its baseline. `Slant` is
 * Lucide's *italic*, because an italic is a slant and in a font editor that
 * reads with no decoding step. There is nothing that shears the other way, so
 * the panel's Lean keeps its words.
 */
export const FlipHorizontalIcon: IconComponent = () => (
  <Glyph>
    <path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3" />
    <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
    <path d="M12 20v2" />
    <path d="M12 14v2" />
    <path d="M12 8v2" />
    <path d="M12 2v2" />
  </Glyph>
);

export const FlipVerticalIcon: IconComponent = () => (
  <Glyph>
    <path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3" />
    <path d="M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3" />
    <path d="M4 12H2" />
    <path d="M10 12H8" />
    <path d="M16 12h-2" />
    <path d="M22 12h-2" />
  </Glyph>
);

/** A turn anticlockwise: nearly a whole circle, so the direction reads small. */
export const RotateLeftIcon: IconComponent = () => (
  <Glyph>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </Glyph>
);

export const RotateRightIcon: IconComponent = () => (
  <Glyph>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </Glyph>
);

/** Baseline: an A standing on its line. */
export const BaselineIcon: IconComponent = () => (
  <Glyph>
    <path d="M4 20h16" />
    <path d="m6 16 6-12 6 12" />
    <path d="M8 12h8" />
  </Glyph>
);

/** The glyph's origin: a point, with the cross-hairs that say which point. */
export const OriginIcon: IconComponent = () => (
  <Glyph>
    <circle cx="12" cy="12" r="10" />
    <line x1="22" x2="18" y1="12" y2="12" />
    <line x1="6" x2="2" y1="12" y2="12" />
    <line x1="12" x2="12" y1="6" y2="2" />
    <line x1="12" x2="12" y1="22" y2="18" />
  </Glyph>
);

/** Slant: Lucide's italic, which is a slant drawn as the thing it makes. */
export const SlantIcon: IconComponent = () => (
  <Glyph>
    <line x1="19" x2="10" y1="4" y2="4" />
    <line x1="14" x2="5" y1="20" y2="20" />
    <line x1="15" x2="9" y1="4" y2="20" />
  </Glyph>
);
