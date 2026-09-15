"""Compile a feature file into a copy of a font with fontTools, for comparison.

The editor compiles its own GSUB and GPOS. This takes a font it exported, throws
those two tables away, and has fontTools' feaLib — the compiler fontmake and
most build pipelines use — compile the same feature file into their place. The
test in `packages/font-io/test/proof-features.test.ts` then sets text with both
fonts and requires them to agree.

GDEF is left as the editor wrote it, from the glyphs' anchors, which is where
this editor keeps which glyphs are marks; the feature file does not say.

    python compile_fea.py Features.otf features.fea FromFeaLib.otf
"""

import sys

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTFont

source, features, target = sys.argv[1:4]

font = TTFont(source)
for tag in ("GSUB", "GPOS"):
    if tag in font:
        del font[tag]

with open(features, encoding="utf-8") as handle:
    text = handle.read()

addOpenTypeFeaturesFromString(font, text, tables=["GSUB", "GPOS"])
font.save(target)

lookups = {tag: len(font[tag].table.LookupList.Lookup) for tag in ("GSUB", "GPOS") if tag in font}
print(f"fontTools compiled {features} into {target}: {lookups}")
