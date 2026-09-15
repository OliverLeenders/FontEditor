# Typewright

<img src="brand/mark.svg" alt="" width="88" align="right">

A font editor that runs in a browser and ships as a desktop application. It draws,
spaces, interpolates and exports a whole family — masters, instances, static fonts and
variable fonts — and it offers **Tunni lines** as an additional way to control cubic
Bézier splines.

The Tunni lines concept was devised by Eduardo Tunni and Fontlab Ltd., and is used in the
FontLab font editor. The maths in this repository derives from the reverse-engineering
write-up in [Tunni-Lines](https://github.com/OliverLeenders/Tunni-Lines).

## Download

Installers for Windows and Linux are on the
[releases page](https://github.com/OliverLeenders/FontEditor/releases). They are not
code-signed, so Windows SmartScreen warns the first time the installer runs: choose _More
info_, then _Run anyway_. Once installed, the application offers each new release when it
starts.

## What it does

- **Drawing.** Select, pen, knife, rectangle, ellipse and measuring tools, snapping,
  boolean union, anchors and components, Tunni lines, curvature combs and harmonising.
- **A whole family.** Masters along axes, instances, a `.designspace` with one `.ufo` per
  master, and a variable font from them.
- **Spacing and features.** Kerning, spacing that follows other glyphs, and a `.fea`
  subset, set by HarfBuzz in the spacing line and the proof.
- **In and out.** OTF, TTF, WOFF, WOFF2, variable fonts and UFO, a UFO folder on disk
  opened and saved back to, and a hinted TrueType from the desktop application.
- **Checks before export.** Nineteen of them, reported and never repaired.
- **Nothing lost.** Every font autosaves to a working copy of its own, with snapshots kept
  as you work.
- **Panes and windows.** The drawing beside the spacing line or the proof, side by side or
  stacked, and a second font in a window of its own.

## Run it from source

Requires Node 22.13+ and pnpm.

```bash
pnpm install
```

```bash
pnpm dev
```

Then open http://localhost:5174. The desktop application, the tests and releases are in
[docs/development.md](docs/development.md).

## More

- [Using Typewright](docs/using.md): the tools, the keys and the workspaces.
- [Roadmap](docs/roadmap.md): what has been built, phase by phase, and what is next.
- [Development](docs/development.md): building, testing, releasing, and the rules the code
  keeps.

## Credits

Typewright is built on other people's work, and says so here.

**Tunni lines.** The Tunni lines concept was devised by Eduardo Tunni and Fontlab Ltd., and
is used in the FontLab font editor. The maths that drives them here was ported from
[Tunni-Lines](https://github.com/OliverLeenders/Tunni-Lines), a prototype that reverse-engineers
FontLab's controls, published with FontLab's permission on the condition that Eduardo Tunni
and FontLab are credited — which they are, here and in the code that implements them, and
which the licence requires of anyone who redistributes the feature (see [Licence](#licence)).

**Icons.** The toolbar and interface icons are [Lucide](https://lucide.dev)'s, copied into
the source unchanged under the ISC License; some of them come from
[Feather](https://feathericons.com) by Cole Bemis, under the MIT License.

**Libraries the application ships.** [opentype.js](https://github.com/opentypejs/opentype.js)
reads and writes font binaries; [HarfBuzz](https://harfbuzz.github.io), through
[harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs), sets text in the Proof and the Spacing
line; [woff2-encoder](https://github.com/itskyedo/woff2-encoder) compresses WOFF2 with Google's
[WOFF2](https://github.com/google/woff2) and [Brotli](https://github.com/google/brotli);
[React](https://react.dev) draws the interface; [Tauri](https://tauri.app) is the desktop
application. The desktop application's hinted TrueType export runs
[ttfautohint](https://freetype.org/ttfautohint/) by Werner Lemberg, which it bundles under
the FreeType License. Portions of this software are copyright © 2011–2022 The FreeType
Project (www.freetype.org). All rights reserved. The build of it that is bundled comes from
the [ttfautohint-py](https://github.com/fonttools/ttfautohint-py) wheels published by the
fontTools project.

**Specifications and conventions.** What the editor reads and writes is defined by the
[OpenType specification](https://learn.microsoft.com/typography/opentype/spec/), the
[Unified Font Object](https://unifiedfontobject.org) and designspace formats,
[WOFF](https://www.w3.org/TR/WOFF/) and [WOFF2](https://www.w3.org/TR/WOFF2/), and Adobe's
[feature file syntax](https://adobe-type-tools.github.io/afdko/OpenTypeFeatureFileSpecification.html).
Several conventions are borrowed on purpose, and named where they are used: the `/name`
text of [Glyphs](https://glyphsapp.com); the designspace layout that
[fontmake](https://github.com/googlefonts/fontmake) reads; the `gasp` table and dropout
program that Google Fonts' [gftools](https://github.com/googlefonts/gftools) gives an
unhinted font; and the [Adobe Glyph List](https://github.com/adobe-type-tools/agl-aglfn)'s
glyph names. CI reads everything written here with
[fontTools](https://github.com/fonttools/fonttools) and draws it with
[FreeType](https://freetype.org).

**Written with Claude.** Typewright is written with Anthropic's
[Claude](https://claude.ai) as a pair programmer, and every commit in its history is
co-authored by it.

## Licence

Typewright is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3 of
the License, or (at your option) any later version. It is distributed in the hope that it will
be useful, but without any warranty; see [LICENSE](LICENSE) for the full text.

**Additional term, under section 7(b) of the GPL.** Any redistribution of the Tunni-line
feature, including the Tunni point, must keep this attribution, word for word:

> The Tunni lines concept was devised by Eduardo Tunni and Fontlab Ltd., and is used in the
> FontLab font editor.

The same term applies to the [Tunni-Lines](https://github.com/OliverLeenders/Tunni-Lines)
prototype the feature was ported from.

The licence covers Typewright itself, not the fonts made with it.

Third-party material has its own licences, which are compatible with this one, and their
texts are collected in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt). It ships with the
web build and the desktop installer, and is regenerated with
`node tools/notices/generate-notices.mjs`.
