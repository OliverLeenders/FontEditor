# Checking the OTF's mark attachment against fontTools

The sibling of [`../ufo-check`](../ufo-check/README.md), for the binary. The argument is
the same: a font only this repository has ever read proves consistency, not correctness.

What it checks is the part of GPOS that puts accents on letters. That table is a tree of
offsets into offsets — a coverage table for the marks, another for the bases, a mark array
with one class and one anchor each, a base array with one anchor per class per glyph, and
a null offset wherever a base does not take that class. Every one of those can be the
right length and the wrong number, and a test written here would be checking our arithmetic
against our own arithmetic.

So the font is handed to [fontTools](https://github.com/fonttools/fonttools), which
decompiles the tables structurally and knows nothing about how they were written. The
check then asks for the anchors back by name and compares them with what was drawn.

```bash
pip install -r ../ufo-check/requirements.txt
OTF_OUT=/tmp/otf pnpm --filter @typewright/font-io exec vitest run proof-otf
python check_otf.py /tmp/otf/TunniMarks-SemiboldItalic.otf
```

The font it reads comes from `packages/font-io/test/proof-otf.test.ts`: a letter offering
two places, an accent that attaches by one of them and offers a place of its own, a second
accent that stacks there, and a mark for the class the letter's other anchor names. That
covers a base with a null anchor for a class it does not take, and the difference between
mark-to-base and mark-to-mark.

## The feature file

`compile_fea.py` checks the feature compiler by comparison rather than by reading bytes
back. A font's substitutions and positioning are only right if text set with it comes out
right, and the arithmetic that would check the tables here is the arithmetic that wrote
them.

So the proof font's feature file — which uses every construct the editor compiles:
language systems, classes, named lookups and the rules that call them, lookup flags,
one-into-several and alternates, ligatures, rules in a context and their exceptions,
scripts and languages, and positioning plain and in a context — is compiled twice. Once by
the editor, and once by fontTools' feaLib, which this script puts into a copy of the same
font. HarfBuzz then sets a list of strings with both, and every glyph and position has to
agree.

The file fontTools is given ends with the Marks file the editor writes from the proof
font's anchors — `markClass`, `pos base` and `pos mark`. The editor compiles attachment
from the anchors themselves, so the accents landing in the same place in both fonts proves
the Marks file says what the anchors do.

```bash
FEATURES_OUT=/tmp/fea pnpm --filter @typewright/font-io exec vitest run proof-features
python compile_fea.py /tmp/fea/Features.otf /tmp/fea/features.fea /tmp/fea/FromFeaLib.otf
FEATURES_REFERENCE=/tmp/fea/FromFeaLib.otf pnpm --filter @typewright/font-io exec vitest run proof-features
```

## Opening a font

The same run doubles as the check of the importer. With `FEATURES_REFERENCE` set, the font
fontTools compiled is opened here as a binary — its GSUB and GPOS read back into feature
source, anchors and kerning — exported again, and set against itself. A second file,
`extras.fea`, holds what the editor keeps as source without compiling; `--plain` compiles
it without the proof's GDEF checks, and `IMPORT_REFERENCE` opens the result, checks the
source and the warnings, and sets the parts the editor does compile against the original.

```bash
python compile_fea.py --plain /tmp/fea/Features.otf /tmp/fea/extras.fea /tmp/fea/Extras.otf
IMPORT_REFERENCE=/tmp/fea/Extras.otf pnpm --filter @typewright/font-io exec vitest run proof-features
```

## The variable font

`check_vf.py` is the same idea taken further. A variable font's deltas cannot be
checked here at all: the arithmetic that would verify them is the arithmetic that
wrote them, so a test in the suite would only ask whether we agree with
ourselves.

So fontTools is given the font and pinned to each master's own location, and the
outlines and advances that come out are compared with what that master was drawn
as. A variable font that is exactly its masters at its masters' locations has its
blends in the right order, its regions right, and its offsets pointing where they
say — and getting any one of those wrong gives a font that is perfect at the
default and wrong everywhere else, which is the failure that would otherwise
reach somebody's screen.

## Between the masters

`check_designspace_vf.py` asks what `check_vf.py` cannot see, because it only shows
between the masters: a delta at the corner of two axes, a master drawn as a layer for a
few glyphs, a weight map carried in `avar`, and rules carried as feature variations. The
proof family is read with `designspaceLib`, and fontTools' own `VariationModel` works
out from the masters' points what every glyph should be at eight places; both flavours of
the variable font are pinned there and compared — the CFF2 font point for point, the
TrueType one against it as a shape — and what `rvrn` substitutes is compared with what
`processRules` says. `outline.py` holds the shape comparison both TrueType checks use.

```sh
DESIGNSPACE_OUT=/tmp/ds pnpm --filter @typewright/font-io exec vitest run proof-designspace
python check_designspace_vf.py /tmp/ds
```

## The TrueType flavour

`check_ttf.py` asks the one question the conversion raises. A cubic cannot be
written as quadratics exactly, so the TrueType outlines are an approximation of
the drawing, and how good an approximation is not something the code that made
them can answer.

So fontTools draws both flavours of the same font and the two outlines are
compared as shapes — every point on one measured to the nearest _segment_ of the
other, in both directions. Both directions because a curve that bulges outward
and one that flattens are each invisible to the other test; to the segments
rather than to sampled points because otherwise the sample spacing becomes part
of the answer, which is how a conversion within half a unit first read as four
and a half.
