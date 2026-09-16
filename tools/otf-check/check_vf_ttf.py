"""Instantiate a variable TrueType font at each master and see whether it is that master.

The same question `check_vf.py` asks of the CFF2 flavour, and it cannot be asked
the same way. That check compares points straight across, because CFF2 keeps the
cubics as drawn and the font's points are the drawing's points. This flavour is
quadratic: the outlines are an approximation of the drawing, with a different
number of points, so there is nothing to compare index for index.

What there is, is the shape. The font is pinned to each master's location and
the outline that comes out is compared with the same master compiled on its own
as a static TrueType font — every point on one against the nearest point on the
other, in both directions, which is the measure that notices a curve that bulges
as readily as one that flattens. A variable font that is *shaped* like each of
its masters at each of its masters' locations has its deltas in the right order,
its regions right, and its offsets pointing where they say.

Given the variable font, a JSON file naming the masters and their locations, and
a directory of the static TrueType fonts built from those same masters.
"""

import json
import os
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

from outline import apart, flatten

problems = []
notes = []

# What instantiating is allowed to move a curve by, in design units. The
# conversion itself is allowed one unit, and rounding to the integer grid can
# cost most of another; anything past this is a delta that is wrong rather than
# a curve that is approximate.
TOLERANCE = 2.5


def problem(where, what):
    problems.append(f"{where}: {what}")




path = sys.argv[1]
expected = json.load(open(sys.argv[2], encoding="utf-8"))
statics = sys.argv[3]

font = TTFont(path)

for table in ("glyf", "loca", "gvar", "fvar", "HVAR"):
    if table not in font:
        problem(table, "is not in the font")
if "CFF2" in font or "CFF " in font:
    problem("CFF", "a TrueType flavour must not carry a CFF table as well")

if problems:
    print("\n".join(problems))
    sys.exit(1)

for master in expected["masters"]:
    name = master["name"]
    at = {tag: float(value) for tag, value in master["location"].items()}

    pinned = instancer.instantiateVariableFont(TTFont(path), at, inplace=False)
    here = pinned.getGlyphSet()

    alone = TTFont(os.path.join(statics, f"{name}.ttf"))
    theirs = alone.getGlyphSet()

    for glyph in master["glyphs"]:
        if glyph not in here:
            problem(f"{name}/{glyph}", "is not in the instantiated font")
            continue

        moved = apart(flatten(here, glyph), flatten(theirs, glyph))
        if moved > TOLERANCE:
            problem(f"{name}/{glyph}", f"is {moved:.2f} units from the master, which is too far")

    for glyph, advance in master["advances"].items():
        got = pinned["hmtx"][glyph][0]
        if abs(got - advance) > 1:
            problem(f"{name}/{glyph}", f"advance is {got}, expected {advance}")

    notes.append(f"at {at}, {name}")

print("\n".join(notes))
if problems:
    print()
    print("\n".join(problems))
    sys.exit(1)

print()
print("Every master comes back out of the variable TrueType font as itself.")
