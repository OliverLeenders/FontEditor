"""Instantiate a variable font at each master and see whether it is that master.

The one check that matters, and the one this repository cannot make of itself:
whether the deltas are right. The arithmetic that would verify them here is the
arithmetic that wrote them, so a test in the suite would only ask whether we
agree with ourselves.

So the font is handed to fontTools, pinned to each master's own location, and
the outlines that come out are compared with what that master was drawn as. A
variable font that is exactly its masters at its masters' locations is a
variable font whose blends are in the right order, whose regions are the right
regions, and whose offsets point where they say.

Given the font and a JSON file of the masters — name, location, and each glyph's
points as the editor drew them.
"""

import json
import sys

from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

problems = []
notes = []


def problem(where, what):
    problems.append(f"{where}: {what}")


def note(what):
    notes.append(what)


path = sys.argv[1]
expected = json.load(open(sys.argv[2], encoding="utf-8"))

font = TTFont(path)
for tag in ("CFF2", "fvar", "STAT"):
    if tag not in font:
        problem(tag, "a variable font has one and this has not")
if "CFF " in font:
    problem("CFF ", "a font may not have both this and CFF2")

if problems:
    print("\n".join(problems))
    sys.exit(1)

note(f"axes: {[(a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in font['fvar'].axes]}")
note(f"{len(font['fvar'].instances)} named instances")


def points_of(glyphset, name):
    """Every on-curve and off-curve point a glyph draws, in order."""
    pen = RecordingPen()
    glyphset[name].draw(pen)

    out = []
    for operator, args in pen.value:
        for point in args:
            if isinstance(point, tuple):
                out.append((round(point[0], 3), round(point[1], 3)))
    return out


for master in expected["masters"]:
    # A fresh copy each time: instancing is destructive.
    pinned = instancer.instantiateVariableFont(TTFont(path), master["location"])
    glyphset = pinned.getGlyphSet()
    note(f"at {master['location']}, {master['name']}")

    for name, wanted in master["glyphs"].items():
        if name not in glyphset:
            problem(master["name"], f"{name} is not in the font")
            continue

        got = points_of(glyphset, name)
        want = [(round(p[0], 3), round(p[1], 3)) for p in wanted]

        if len(got) != len(want):
            problem(
                master["name"],
                f"{name} has {len(got)} points here and {len(want)} in the master",
            )
            continue

        for i, (a, b) in enumerate(zip(got, want)):
            # A unit of slack: the charstring holds fixed-point numbers, and a
            # delta that does not land on a unit is rounded on the way in.
            if abs(a[0] - b[0]) > 1 or abs(a[1] - b[1]) > 1:
                problem(master["name"], f"{name} point {i} is {a} here and {b} in the master")
                break

    # And the advances, which vary as much as the outlines do.
    widths = pinned["hmtx"].metrics
    for name, wanted in master.get("advances", {}).items():
        got = widths.get(name, (None,))[0]
        if got is None:
            continue
        if abs(got - wanted) > 1:
            problem(master["name"], f"{name} is {got} wide here and {wanted} in the master")

print("\n".join(notes))
if problems:
    print("\nProblems:")
    print("\n".join(problems))
    sys.exit(1)

print("\nEvery master comes back out of the variable font as itself.")
