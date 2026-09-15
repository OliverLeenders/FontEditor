import { Glyph, type IconComponent } from "./glyph.js";

/**
 * The interface icons: everything outside the toolbar and the transform panel.
 *
 * Copied from lucide-static v1.43.0 (ISC licence), as the toolbar's were from
 * v1.40.0 — same reasons, and the same rule: Lucide's own path data, unchanged,
 * on its 24-unit box. Colour comes from `currentColor`, so a pressed button, a
 * disabled one and a warning colour are all handled by whatever is around it.
 *
 * They are here rather than beside the toolbar's because these say what a
 * control *is for*, and those say which tool is in your hand. Two sets, two
 * files, one wrapper.
 */

/** Dismiss: the plain cross, which every panel in every app closes with. */
export const XIcon: IconComponent = () => (
  <Glyph>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Glyph>
);

/** Two panes side by side: splitting the window, or unstacking its panes. */
export const Columns2Icon: IconComponent = () => (
  <Glyph>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M12 3v18" />
  </Glyph>
);

/** Two panes one above the other. */
export const Rows2Icon: IconComponent = () => (
  <Glyph>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M3 12h18" />
  </Glyph>
);

/** The inspector docked to the left edge. */
export const PanelLeftIcon: IconComponent = () => (
  <Glyph>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
  </Glyph>
);

/** The inspector docked to the right edge. */
export const PanelRightIcon: IconComponent = () => (
  <Glyph>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M15 3v18" />
  </Glyph>
);

/** The two columns of dots that say a thing is draggable. */
export const GripVerticalIcon: IconComponent = () => (
  <Glyph>
    <circle cx="9" cy="12" r="1" />
    <circle cx="9" cy="5" r="1" />
    <circle cx="9" cy="19" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="15" cy="5" r="1" />
    <circle cx="15" cy="19" r="1" />
  </Glyph>
);

/** A folded section, turned a quarter when it opens. */
export const ChevronRightIcon: IconComponent = () => (
  <Glyph>
    <path d="m9 18 6-6-6-6" />
  </Glyph>
);

/** Removing something from the font, as opposed to closing a panel. */
export const TrashIcon: IconComponent = () => (
  <Glyph>
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Glyph>
);

/** An error: something that will not compile or will not open. */
export const CircleAlertIcon: IconComponent = () => (
  <Glyph>
    <circle cx="12" cy="12" r="10" />
    <line />
    <line />
  </Glyph>
);

/** A warning: something that compiles and is probably wrong. */
export const TriangleAlertIcon: IconComponent = () => (
  <Glyph>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Glyph>
);

/** A note: worth knowing, wrong only in somebody's judgement. */
export const InfoIcon: IconComponent = () => (
  <Glyph>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </Glyph>
);

/** Preflight: everything findable before the font goes out. */
export const ShieldCheckIcon: IconComponent = () => (
  <Glyph>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </Glyph>
);

/** Saved, and nothing waiting. */
export const CircleCheckIcon: IconComponent = () => (
  <Glyph>
    <circle cx="12" cy="12" r="10" />
    <path d="m16 9-5.5 5.5L8 12" />
  </Glyph>
);

/** Saving, or connecting: work in progress. */
export const LoaderCircleIcon: IconComponent = () => (
  <Glyph>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </Glyph>
);

/** Not saving at all, which is the one state worth alarming about. */
export const CloudOffIcon: IconComponent = () => (
  <Glyph>
    <path d="M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057" />
    <path d="M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78" />
    <path d="m2 2 20 20" />
  </Glyph>
);

/** The snapshots, and the work recovered from them. */
export const HistoryIcon: IconComponent = () => (
  <Glyph>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </Glyph>
);

/** What the keys do, which is what the hint line says. */
export const KeyboardIcon: IconComponent = () => (
  <Glyph>
    <path d="M10 8h.01" />
    <path d="M12 12h.01" />
    <path d="M14 8h.01" />
    <path d="M16 12h.01" />
    <path d="M18 8h.01" />
    <path d="M6 8h.01" />
    <path d="M7 16h10" />
    <path d="M8 12h.01" />
    <rect width="20" height="16" x="2" y="4" rx="2" />
  </Glyph>
);

/** Something the compiler did in fact support. */
export const CheckIcon: IconComponent = () => (
  <Glyph>
    <path d="M20 6 9 17l-5-5" />
  </Glyph>
);

/** Adding a point where the pointer is. */
export const CirclePlusIcon: IconComponent = () => (
  <Glyph>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 12h8" />
    <path d="M12 8v8" />
  </Glyph>
);

/** A curve with its controls: the segment, and what a curve section is about. */
export const SplineIcon: IconComponent = () => (
  <Glyph>
    <circle cx="19" cy="5" r="2" />
    <circle cx="5" cy="19" r="2" />
    <path d="M5 17A12 12 0 0 1 17 5" />
  </Glyph>
);

/** A straight segment, which is a curve with nothing left in it. */
export const MinusIcon: IconComponent = () => (
  <Glyph>
    <path d="M5 12h14" />
  </Glyph>
);

/** Reversing a contour: the same path, walked the other way. */
export const IterationCcwIcon: IconComponent = () => (
  <Glyph>
    <path d="m16 14 4 4-4 4" />
    <path d="M20 10a8 8 0 1 0-8 8h8" />
  </Glyph>
);

/** Harmonising: the curvature either side of a node agreeing. */
export const WavesIcon: IconComponent = () => (
  <Glyph>
    <path d="M2 12q2.5 2 5 0t5 0 5 0 5 0" />
    <path d="M2 19q2.5 2 5 0t5 0 5 0 5 0" />
    <path d="M2 5q2.5 2 5 0t5 0 5 0 5 0" />
  </Glyph>
);

/** Balancing handles: two things put an equal distance from the middle. */
export const DistributeCentreIcon: IconComponent = () => (
  <Glyph>
    <rect width="6" height="14" x="4" y="5" rx="2" />
    <rect width="6" height="10" x="14" y="7" rx="2" />
    <path d="M17 22v-5" />
    <path d="M17 7V2" />
    <path d="M7 22v-3" />
    <path d="M7 5V2" />
  </Glyph>
);

/** Retracting a handle into its own node. */
export const MinimizeIcon: IconComponent = () => (
  <Glyph>
    <path d="m14 10 7-7" />
    <path d="M20 10h-6V4" />
    <path d="m3 21 7-7" />
    <path d="M4 14h6v6" />
  </Glyph>
);

/** Pulling handles back out of a node that had none. */
export const MaximizeIcon: IconComponent = () => (
  <Glyph>
    <path d="M15 3h6v6" />
    <path d="m21 3-7 7" />
    <path d="m3 21 7-7" />
    <path d="M9 21H3v-6" />
  </Glyph>
);

/** A handle held to its axis until somebody says otherwise. */
export const LockIcon: IconComponent = () => (
  <Glyph>
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Glyph>
);

/** Decomposing: a component becoming the outlines it stood for. */
export const UngroupIcon: IconComponent = () => (
  <Glyph>
    <rect x="11" y="14" width="10" height="7" rx="2" />
    <rect x="3" y="3" width="10" height="7" rx="2" />
  </Glyph>
);

/** Taking everything there is to take. */
export const SelectAllIcon: IconComponent = () => (
  <Glyph>
    <path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z" />
    <path d="M5 3a2 2 0 0 0-2 2" />
    <path d="M19 3a2 2 0 0 1 2 2" />
    <path d="M5 21a2 2 0 0 1-2-2" />
    <path d="M9 3h1" />
    <path d="M9 21h2" />
    <path d="M14 3h1" />
    <path d="M3 9v1" />
    <path d="M21 9v2" />
    <path d="M3 14v1" />
  </Glyph>
);

/** The sweeps made over the whole font at once. */
export const MopIcon: IconComponent = () => (
  <Glyph>
    <path d="M10 22a3 3 0 01-3-3" />
    <path d="M10 22c2.761 0 5-1.79 5-4-4.42 0-4.08-5-8.5-5a4.501 4.501 0 000 9z" />
    <path d="M10 3H8" />
    <path d="M12.5 11.5 22 2" />
    <path d="M20 13v4" />
    <path d="M22 15h-4" />
    <path d="M4 5v4" />
    <path d="M6 7H2" />
    <path d="m6.98 13.02 2.665-2.664a1.21 1.21 0 011.71 0l2.29 2.288a1.21 1.21 0 010 1.712l-2.088 2.087" />
    <path d="M9 2v2" />
  </Glyph>
);

/** Rounding to whole units, which is putting the drawing on the grid. */
export const GridIcon: IconComponent = () => (
  <Glyph>
    <path d="M12 3v18" />
    <path d="M3 12h18" />
    <rect x="3" y="3" width="18" height="18" rx="2" />
  </Glyph>
);

/** A guide laid flat: the line, and the way the drawing parts round it. */
export const GuideAcrossIcon: IconComponent = () => (
  <Glyph>
    <path d="m16 16-4 4-4-4" />
    <path d="M3 12h18" />
    <path d="m8 8 4-4 4 4" />
  </Glyph>
);

/** A guide stood up. */
export const GuideUpIcon: IconComponent = () => (
  <Glyph>
    <path d="M12 3v18" />
    <path d="m16 16 4-4-4-4" />
    <path d="m8 8-4 4 4 4" />
  </Glyph>
);

/** A guide: the lines a drawing is squared up against. */
export const FrameIcon: IconComponent = () => (
  <Glyph>
    <line x1="22" x2="2" y1="6" y2="6" />
    <line x1="22" x2="2" y1="18" y2="18" />
    <line x1="6" x2="6" y1="2" y2="22" />
    <line x1="18" x2="18" y1="2" y2="22" />
  </Glyph>
);

/** Where an accent attaches, which is what the word already means. */
export const AnchorIcon: IconComponent = () => (
  <Glyph>
    <path d="M12 6v16" />
    <path d="m19 13 2-1a9 9 0 0 1-18 0l2 1" />
    <path d="M9 11h6" />
    <circle cx="12" cy="4" r="2" />
  </Glyph>
);

/** Leaving this glyph for another one. */
export const ExternalLinkIcon: IconComponent = () => (
  <Glyph>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Glyph>
);

/** Centring the drawing between its sidebearings. */
export const CentreGlyphIcon: IconComponent = () => (
  <Glyph>
    <rect width="6" height="14" x="2" y="5" rx="2" />
    <rect width="6" height="10" x="16" y="7" rx="2" />
    <path d="M12 2v20" />
  </Glyph>
);

/** The glyph workspace: the place where the drawing happens. */
export const PenToolIcon: IconComponent = () => (
  <Glyph>
    <path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z" />
    <path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18" />
    <path d="m2.3 2.3 7.286 7.286" />
    <circle cx="11" cy="11" r="2" />
  </Glyph>
);

/** The spacing workspace: the space between two letters. */
export const GapHorizontalIcon: IconComponent = () => (
  <Glyph>
    <path d="M12 2v2" />
    <path d="M12 8v2" />
    <path d="M12 14v2" />
    <path d="M12 20v2" />
    <path d="M21 3h-3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" />
    <path d="M3 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3" />
  </Glyph>
);

/** The features workspace, which is a file of code. */
export const CodeIcon: IconComponent = () => (
  <Glyph>
    <path d="m16 18 6-6-6-6" />
    <path d="m8 6-6 6 6 6" />
  </Glyph>
);

/** The proof workspace: the font as a page of text. */
export const FileTextIcon: IconComponent = () => (
  <Glyph>
    <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
    <path d="M14 2v5a1 1 0 0 0 1 1h5" />
    <path d="M10 9H8" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </Glyph>
);

/** Opening a UFO folder on the disk. */
export const FolderOpenIcon: IconComponent = () => (
  <Glyph>
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
  </Glyph>
);

/** The folder this editor was working in last time. */
export const FolderClockIcon: IconComponent = () => (
  <Glyph>
    <path d="M16 14v2.2l1.6 1" />
    <path d="M7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2" />
    <circle cx="16" cy="16" r="6" />
  </Glyph>
);

/** Writing the font back to the folder it came from. */
export const SaveIcon: IconComponent = () => (
  <Glyph>
    <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
    <path d="M7 3v4a1 1 0 0 0 1 1h7" />
  </Glyph>
);

/** Writing it to a different folder, and working there instead. */
export const FolderOutputIcon: IconComponent = () => (
  <Glyph>
    <path d="M2 7.5V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-1.5" />
    <path d="M2 13h10" />
    <path d="m5 10-3 3 3 3" />
  </Glyph>
);

/** Unsaved: the font on screen is ahead of the one on the disk. */
export const CircleDotIcon: IconComponent = () => (
  <Glyph>
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="12" r="10" />
  </Glyph>
);

/** Opening a font from a file the reader chooses. */
export const UploadIcon: IconComponent = () => (
  <Glyph>
    <path d="M12 3v12" />
    <path d="m17 8-5-5-5 5" />
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
  </Glyph>
);

/** A new font, from nothing. */
export const FilePlusIcon: IconComponent = () => (
  <Glyph>
    <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
    <path d="M14 2v5a1 1 0 0 0 1 1h5" />
    <path d="M9 15h6" />
    <path d="M12 18v-6" />
  </Glyph>
);

/** A new glyph in this font. */
export const SquarePlusIcon: IconComponent = () => (
  <Glyph>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M8 12h8" />
    <path d="M12 8v8" />
  </Glyph>
);

/** Exporting: a file that leaves the editor. */
export const DownloadIcon: IconComponent = () => (
  <Glyph>
    <path d="M12 15V3" />
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
  </Glyph>
);

/** Keeping a copy of the whole font as it is now. */
export const CameraIcon: IconComponent = () => (
  <Glyph>
    <path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
    <circle cx="12" cy="13" r="3" />
  </Glyph>
);

/** Going back to one of those copies. */
export const RotateCcwIcon: IconComponent = () => (
  <Glyph>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </Glyph>
);

/** The masters: the drawings this typeface is interpolated between. */
export const LayersIcon: IconComponent = () => (
  <Glyph>
    <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
    <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
    <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
  </Glyph>
);

/** A new master, drawn from one that already exists. */
export const CopyPlusIcon: IconComponent = () => (
  <Glyph>
    <line />
    <line />
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </Glyph>
);

/** An instance: the shape between two masters, which is what blending is. */
export const BlendIcon: IconComponent = () => (
  <Glyph>
    <circle cx="15" cy="9" r="7" />
    <circle cx="9" cy="15" r="7" />
  </Glyph>
);

/** The glyph itself — what it stands for and how wide it is. */
export const TypeIcon: IconComponent = () => (
  <Glyph>
    <path d="M12 4v16" />
    <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
    <path d="M9 20h6" />
  </Glyph>
);

/** A glyph placed inside another one. */
export const ComponentIcon: IconComponent = () => (
  <Glyph>
    <path d="M15.536 11.293a1 1 0 0 0 0 1.414l2.376 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z" />
    <path d="M2.297 11.293a1 1 0 0 0 0 1.414l2.377 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414L6.088 8.916a1 1 0 0 0-1.414 0z" />
    <path d="M8.916 17.912a1 1 0 0 0 0 1.415l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.415l-2.377-2.376a1 1 0 0 0-1.414 0z" />
    <path d="M8.916 4.674a1 1 0 0 0 0 1.414l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z" />
  </Glyph>
);

/** Drawing a box round one letter in a sheet of them. */
export const CropIcon: IconComponent = () => (
  <Glyph>
    <path d="M6 2v14a2 2 0 0 0 2 2h14" />
    <path d="M18 22V8a2 2 0 0 0-2-2H2" />
  </Glyph>
);

/** The picture behind the letter. */
export const ImageIcon: IconComponent = () => (
  <Glyph>
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </Glyph>
);

/** The selected point: a node on the line it sits in. */
export const PointIcon: IconComponent = () => (
  <Glyph>
    <circle cx="12" cy="12" r="3" />
    <line x1="3" x2="9" y1="12" y2="12" />
    <line x1="15" x2="21" y1="12" y2="12" />
  </Glyph>
);

/** Transforming the drawing: scale, rotate, flip, slant. */
export const ScalingIcon: IconComponent = () => (
  <Glyph>
    <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M14 15H9v-5" />
    <path d="M16 3h5v5" />
    <path d="M21 3 9 15" />
  </Glyph>
);
