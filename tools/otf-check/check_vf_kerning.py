"""Pin a variable font at places in its designspace and read its kerning there.

A bold kerned more tightly than its light is kerning that changes with the
weight. The editor writes it as each pair's value at the default and what it
changes by: a variation store in GDEF, which becomes version 1.3 to hold it,
and a device table on each value in GPOS pointing at its own row of the store.
HarfBuzz reads that and sets text with it, which the tests ask of it. This is
the other reader.

fontTools' instancer pins the font at a place, working every device table out
from the store and writing the plain number in its stead. What is left is a
font with ordinary kerning, and each pair of it is looked up here the way a
shaper does — the first subtable of each lookup that covers the first glyph —
and compared with what the masters' own kerning says it should be there.

    python check_vf_kerning.py <font> <kerning.json>

The json is written beside the font by
`packages/font-io/test/varying-kerning.test.ts`: a list of places, each with
the pairs expected there.
"""

import json
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

problems = []


def problem(where, what):
    problems.append(f"{where}: {what}")


path, expected_path = sys.argv[1:3]
expected = json.load(open(expected_path, encoding="utf-8"))


def subtables(lookup):
    """A lookup's subtables, out of the extension they may be wrapped in."""
    for subtable in lookup.SubTable:
        yield subtable.ExtSubTable if subtable.LookupType == 9 else subtable


def kerned(font, left, right):
    """How far `right` is moved towards `left` by the kern feature."""
    gpos = font["GPOS"].table
    indices = sorted(
        {
            index
            for record in gpos.FeatureList.FeatureRecord
            if record.FeatureTag == "kern"
            for index in record.Feature.LookupListIndex
        }
    )
    total = 0
    for index in indices:
        for subtable in subtables(gpos.LookupList.Lookup[index]):
            if subtable.LookupType != 2 or left not in subtable.Coverage.glyphs:
                continue
            if subtable.Format == 1:
                pairs = subtable.PairSet[subtable.Coverage.glyphs.index(left)]
                found = [r for r in pairs.PairValueRecord if r.SecondGlyph == right]
                if not found:
                    continue
                value = found[0].Value1
            else:
                first = subtable.ClassDef1.classDefs.get(left, 0)
                second = subtable.ClassDef2.classDefs.get(right, 0)
                value = subtable.Class1Record[first].Class2Record[second].Value1
            total += getattr(value, "XAdvance", 0) or 0 if value is not None else 0
            # The first subtable that has the pair is the lookup's answer.
            break
    return total


# ------------------------------------------------------------ the font as it is
font = TTFont(path)
gdef = font["GDEF"].table
if gdef.Version != 0x00010003:
    problem("GDEF", f"version {gdef.Version:#x}, which has no place for a variation store")
store = getattr(gdef, "VarStore", None)
if store is None:
    problem("GDEF", "no variation store, so nothing in GPOS can vary")
else:
    rows = sum(len(data.Item) for data in store.VarData)
    if rows == 0:
        problem("GDEF", "the variation store holds no rows")

varying = 0
for lookup in font["GPOS"].table.LookupList.Lookup:
    for subtable in subtables(lookup):
        if subtable.LookupType != 2:
            continue
        if subtable.Format == 1:
            values = [r.Value1 for pairs in subtable.PairSet for r in pairs.PairValueRecord]
        else:
            values = [c.Value1 for row in subtable.Class1Record for c in row.Class2Record]
        varying += sum(1 for v in values if v is not None and getattr(v, "XAdvDevice", None))
if varying == 0:
    problem("GPOS", "no pair's value points into the variation store")

if problems:
    print("\n".join(problems))
    sys.exit(1)

# ------------------------------------------------------- and pinned at each place
checked = 0
for place in expected["places"]:
    at = place["at"]
    pinned = instancer.instantiateVariableFont(TTFont(path), at)
    where = ", ".join(f"{tag} {value:g}" for tag, value in at.items())
    for pair, want in place["pairs"].items():
        left, right = pair.split(" ")
        got = kerned(pinned, left, right)
        checked += 1
        # A whole unit: the place may be between masters, and a font is whole.
        if abs(got - want) > 1:
            problem(where, f"{left} {right} is kerned {got}, and the masters say {want:g}")

if problems:
    print("\n".join(problems))
    sys.exit(1)

print(
    f"{path}: {varying} values vary, by {rows} rows of the store; "
    f"{checked} pairs agree with the masters at {len(expected['places'])} places"
)
