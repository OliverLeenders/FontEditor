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
};

export const LIGHT_PALETTE: RenderPalette = {
  background: "#FFFFFF",
  guide: "#E8EDF3",
  guideEmphasis: "#C2CDD8",
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
};

export const DARK_PALETTE: RenderPalette = {
  background: "#10171F",
  guide: "#1E2833",
  guideEmphasis: "#33404E",
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
};
