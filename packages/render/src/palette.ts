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
};

export const LIGHT_PALETTE: RenderPalette = {
  background: "#FFFFFF",
  guide: "#E8EDF3",
  guideEmphasis: "#C2CDD8",
  guideLabel: "#7C8896",
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
  cellFocus: "rgba(44,109,175,0.12)",
  cellCurrent: "rgba(169,111,34,0.14)",
  margin: "#9AAEC4",
  snapGuide: "#A96F22",
  neighbour: "rgba(19,25,34,0.22)",
  component: "rgba(19,25,34,0.55)",
};

export const DARK_PALETTE: RenderPalette = {
  background: "#10171F",
  guide: "#1E2833",
  guideEmphasis: "#33404E",
  guideLabel: "#8B99A8",
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
  cellFocus: "rgba(116,174,226,0.16)",
  cellCurrent: "rgba(214,160,90,0.18)",
  margin: "#4B5D70",
  snapGuide: "#D6A05A",
  neighbour: "rgba(229,235,242,0.20)",
  component: "rgba(229,235,242,0.55)",
};
