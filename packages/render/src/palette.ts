/**
 * Every colour the renderer draws with, as data.
 *
 * Passed in rather than read from CSS custom properties, so the drawing code
 * stays free of the DOM and a test can assert on exact colour strings. The
 * application resolves its theme into one of these and hands it over.
 */
export type RenderPalette = {
  readonly background: string;
  /** Baseline, x-height and other horizontal metric lines. */
  readonly guide: string;
  readonly guideEmphasis: string;
  /**
   * The names written along the metric lines.
   *
   * Deliberately not the colour of the line itself. A rule can afford to be
   * nearly invisible — it is a straight edge two hundred pixels long and the eye
   * finds it anyway — where five characters at eleven pixels in the same colour
   * cannot be read at all.
   */
  readonly guideLabel: string;
  /** The lines the designer put there, as against the font's own metrics. */
  /** An instance between the masters: a reading, not a drawing. */
  readonly instance: string;
  /** The glyph's other drawings, shown behind the one being edited. */
  readonly behind: string;
  readonly designGuide: string;
  readonly designGuideSelected: string;
  readonly outline: string;
  /** Fill for the glyph preview. Expected to carry its own alpha. */
  readonly fill: string;
  readonly node: string;
  readonly nodeSelected: string;
  /** Drawn behind a mark so it stays legible over the filled preview. */
  readonly halo: string;
  readonly handle: string;
  readonly handleSelected: string;
  readonly handleLine: string;
  readonly tunniLine: string;
  readonly tunniPoint: string;
  readonly intersection: string;
  readonly marqueeFill: string;
  readonly marqueeStroke: string;
  readonly preview: string;
  /** Border around a glyph browser cell. */
  readonly cellRule: string;
  /** The glyph name and code point beneath a cell. */
  readonly cellLabel: string;
  /**
   * The character a cell stands for, drawn in a system font where the font
   * being made has not drawn it yet.
   *
   * Faint on purpose, and fainter than anything the font itself draws: it is a
   * note about what belongs in the cell, and must never be mistaken for work.
   */
  readonly cellSample: string;
  /** Behind the cell the keyboard is on. */
  readonly cellFocus: string;
  /** Behind the cell that is open in the editor. */
  readonly cellCurrent: string;
  /** The origin and advance lines bounding the advance width. */
  readonly margin: string;
  /**
   * A line a drag is currently caught on, and the ring marking what produced it.
   *
   * The same accent that marks a selected node, deliberately: the rule this
   * palette already follows is that what is live is ochre, and a snap is as live
   * as anything on the canvas gets.
   */
  readonly snapGuide: string;
  /** Glyphs drawn either side for spacing context. */
  readonly neighbour: string;
  /** Outlines a component contributes: present, but not yours to edit here. */
  readonly component: string;
  /**
   * The cross marking an anchor, and the name that appears beside it on hover.
   *
   * Its own colour rather than a node's: an anchor is not part of the outline,
   * and anything that reads as a point invites being dragged into the shape.
   */
  readonly anchor: string;
  readonly anchorSelected: string;
  /** The component being worked on, so a drag says what it has hold of. */
  readonly componentSelected: string;
  /**
   * The section ruler's line, and the widths along it.
   *
   * Two colours, because the line reads as two kinds of measurement: the
   * stretches inside the ink are stems and bars, and the ones between them are
   * counters and gaps. Both are worth knowing and only one of them is usually
   * being looked for.
   */
  readonly section: string;
  readonly sectionInk: string;
  /**
   * The curvature comb: its hairs, and the envelope joining their tips.
   *
   * The hairs are faint and the envelope is not. What is read is the envelope —
   * a step in it is a curvature break — and a hundred hairs at the same weight
   * would be a hedge with a line hidden in it.
   *
   * Both are drawn lightly. The comb is an instrument laid over the drawing and
   * the drawing is the thing being judged: hairs solid enough to read as ink
   * put a second shape on the canvas, and at a hundred hairs a letter their
   * overlaps darken into one. Light enough to be looked past, dark enough to be
   * looked at.
   */
  readonly comb: string;
  readonly combEdge: string;
};

export const LIGHT_PALETTE: RenderPalette = {
  background: "#FFFFFF",
  guide: "#E8EDF3",
  guideEmphasis: "#C2CDD8",
  guideLabel: "#7C8896",
  instance: "#B9A2D8",
  behind: "#8FA3B8",
  designGuide: "#7FA8D6",
  designGuideSelected: "#2C6DAF",
  outline: "#131922",
  fill: "rgba(44,109,175,0.10)",
  node: "#2C6DAF",
  nodeSelected: "#A96F22",
  halo: "#FFFFFF",
  handle: "#7C8896",
  handleSelected: "#A96F22",
  handleLine: "#B4BFCA",
  tunniLine: "#2C6DAF",
  tunniPoint: "#A96F22",
  intersection: "#B4BFCA",
  marqueeFill: "rgba(44,109,175,0.08)",
  marqueeStroke: "#2C6DAF",
  preview: "#7C8896",
  cellRule: "#E3E9EF",
  cellLabel: "#6B7783",
  cellSample: "rgba(107,119,131,0.42)",
  cellFocus: "rgba(44,109,175,0.12)",
  cellCurrent: "rgba(169,111,34,0.14)",
  margin: "#9AAEC4",
  snapGuide: "#A96F22",
  neighbour: "rgba(19,25,34,0.22)",
  component: "rgba(19,25,34,0.55)",
  anchor: "#2E8B72",
  anchorSelected: "#A96F22",
  componentSelected: "#A96F22",
  section: "#7C8896",
  sectionInk: "#A96F22",
  comb: "rgba(44,109,175,0.16)",
  combEdge: "rgba(44,109,175,0.72)",
};

export const DARK_PALETTE: RenderPalette = {
  background: "#10171F",
  guide: "#1E2833",
  guideEmphasis: "#33404E",
  guideLabel: "#8B99A8",
  instance: "#6E5A8C",
  behind: "#5C6F83",
  designGuide: "#4E7BA8",
  designGuideSelected: "#7FB4EE",
  outline: "#E5EBF2",
  fill: "rgba(116,174,226,0.13)",
  node: "#74AEE2",
  nodeSelected: "#D6A05A",
  halo: "#10171F",
  handle: "#74828F",
  handleSelected: "#D6A05A",
  handleLine: "#3A4655",
  tunniLine: "#74AEE2",
  tunniPoint: "#D6A05A",
  intersection: "#3A4655",
  marqueeFill: "rgba(116,174,226,0.10)",
  marqueeStroke: "#74AEE2",
  preview: "#74828F",
  cellRule: "#232F3C",
  cellLabel: "#8B98A5",
  cellSample: "rgba(139,152,165,0.45)",
  cellFocus: "rgba(116,174,226,0.16)",
  cellCurrent: "rgba(214,160,90,0.18)",
  margin: "#4B5D70",
  snapGuide: "#D6A05A",
  neighbour: "rgba(229,235,242,0.20)",
  component: "rgba(229,235,242,0.55)",
  anchor: "#5FBFA0",
  anchorSelected: "#D6A05A",
  componentSelected: "#D6A05A",
  section: "#8B99A8",
  sectionInk: "#D6A05A",
  comb: "rgba(116,174,226,0.16)",
  combEdge: "rgba(116,174,226,0.72)",
};
