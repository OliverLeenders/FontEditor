# Fonts the tests are run on

Real fonts, each as its makers released it, with its licence beside it. The tests read them;
nothing here is in anything that is shipped.

They are here because a font this editor wrote and then read back proves only that it agrees
with itself. Taking one real font round — in, out, and in again — found a dozen faults the
suite had passed for months: a ligature table that pointed into the middle of itself, icons
written out with part of them gone. These are fonts somebody else made, of the kinds people
bring to an editor.

| Folder              | Font                                    | What it is here for                                            | Licence          |
| ------------------- | --------------------------------------- | -------------------------------------------------------------- | ---------------- |
| `material-symbols/` | Material Symbols Outlined 28pt Regular  | 4,042 glyphs: size, a ligature for every name, overlapping pieces | Apache 2.0       |
| `source-sans/`      | Source Sans 3 Regular (OTF)             | CFF outlines, kerning by class, marks, Latin Greek and Cyrillic   | SIL OFL 1.1      |
| `noto-sans/`        | Noto Sans Regular (TTF)                 | TrueType outlines, wide coverage, mark attachment, many languages | SIL OFL 1.1      |
| `eb-garamond/`      | EB Garamond (variable TTF, weight)      | A variable font; ligatures, small caps, contextual alternates     | SIL OFL 1.1      |
| `latin-modern/`     | Latin Modern Roman 10 Regular (OTF)     | CFF outlines from another toolchain; the TeX world's text face    | GUST Font Licence |
| `mutator-sans/`     | MutatorSans (designspace and four UFOs) | Sources rather than a binary: two axes, layers drawn as masters   | MIT              |
| `noto-nastaliq-urdu/` | Noto Nastaliq Urdu (variable TTF, weight) | Letters joined on a slope: cursive attachment on 707 glyphs, right to left | SIL OFL 1.1 |

Where they came from:

- Material Symbols: <https://github.com/google/material-design-icons>
- Source Sans 3: <https://github.com/adobe-fonts/source-sans> (`release` branch, `OTF/`)
- Noto Sans: <https://github.com/notofonts/notofonts.github.io> (`fonts/NotoSans/unhinted/ttf/`)
- EB Garamond: <https://github.com/google/fonts> (`ofl/ebgaramond/`)
- Latin Modern: <https://ctan.org/pkg/lm> (`fonts/opentype/public/lm/`)
- MutatorSans: <https://github.com/LettError/mutatorSans>
- Noto Nastaliq Urdu: <https://github.com/google/fonts> (`ofl/notonastaliqurdu/`)

None of them is changed. A test that needs a font altered alters a copy in memory.
