"""Compile a feature file into a copy of a font with fontTools, for comparison.

The editor compiles its own GSUB and GPOS. This takes a font it exported, throws
those two tables away, and has fontTools' feaLib — the compiler fontmake and
most build pipelines use — compile the same feature file into their place. The
test in `packages/font-io/test/proof-features.test.ts` then sets text with both
fonts and requires them to agree.

GDEF is left as the editor wrote it, from the glyphs' anchors, which is where
this editor keeps which glyphs are marks; the feature file does not say.

    python compile_fea.py Features.otf features.fea FromFeaLib.otf

With `--plain` it only compiles, for a feature file that is not the proof's and
has none of the GDEF the checks below look for — the one the import test opens.
"""

import sys

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTFont

plain = "--plain" in sys.argv
source, features, target = [arg for arg in sys.argv[1:] if arg != "--plain"][:3]

font = TTFont(source)
for tag in ("GSUB", "GPOS"):
    if tag in font:
        del font[tag]

with open(features, encoding="utf-8") as handle:
    text = handle.read()

# A plain file may name its stylistic sets, and those names live in `name`.
addOpenTypeFeaturesFromString(font, text, tables=["GSUB", "GPOS", *(["name"] if plain else [])])
font.save(target)

lookups = {tag: len(font[tag].table.LookupList.Lookup) for tag in ("GSUB", "GPOS") if tag in font}
print(f"fontTools compiled {features} into {target}: {lookups}")
if plain:
    sys.exit(0)

# What the shaping comparison cannot see.
#
# Both fonts are given the editor's own GDEF, so setting text with them says
# nothing about whether that table holds what the feature file asked for. So it
# is read here, by something that did not write it: the mark glyph sets a
# lookupflag named, the ligature carets, and the glyph classes.
gdef = TTFont(source)["GDEF"].table
assert gdef.GlyphClassDef is not None, "GDEF says nothing about which glyphs are marks"

sets = gdef.MarkGlyphSetsDef
assert sets is not None and sets.MarkSetCount > 0, "GDEF has no mark glyph set for the lookupflag"
named = {glyph for coverage in sets.Coverage for glyph in coverage.glyphs}
assert "acutecomb" in named, f"the mark set does not hold the marks it named: {named}"

carets = gdef.LigCaretList
assert carets is not None and carets.LigGlyphCount > 0, "GDEF has no ligature carets"
positions = {
    glyph: [caret.Coordinate for caret in lig.CaretValue]
    for glyph, lig in zip(carets.Coverage.glyphs, carets.LigGlyph)
}
assert positions.get("f_f_i") == [200, 400], f"the carets are not where the file put them: {positions}"

print(f"GDEF holds {sets.MarkSetCount} mark set(s) and carets for {sorted(positions)}")
