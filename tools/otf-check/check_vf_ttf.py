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
import math
import os
import sys

from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

problems = []
notes = []

# What instantiating is allowed to move a curve by, in design units. The
# conversion itself is allowed one unit, and rounding to the integer grid can
# cost most of another; anything past this is a delta that is wrong rather than
# a curve that is approximate.
TOLERANCE = 2.5


def problem(where, what):
    problems.append(f"{where}: {what}")


def flatten(glyphset, name, steps=32):
    """A glyph's outline as a list of points along it."""
    pen = RecordingPen()
    glyphset[name].draw(pen)

    points = []
    here = None
    start = None

    for verb, args in pen.value:
        if verb == "moveTo":
            here = start = args[0]
            points.append(here)
        elif verb == "lineTo":
            points.extend(_line(here, args[0], steps))
            here = args[0]
        elif verb == "qCurveTo":
            # A run of quadratics, the last point on the curve. An implied
            # on-curve point sits at the midpoint of each pair of controls.
            controls = list(args[:-1])
            end = args[-1]
            if end is None:
                # A contour of nothing but off-curve points closes on itself.
                end = _mid(controls[0], controls[-1])
            previous = here
            for i, control in enumerate(controls):
                stop = end if i == len(controls) - 1 else _mid(control, controls[i + 1])
                points.extend(_quadratic(previous, control, stop, steps))
                previous = stop
            here = end
        elif verb == "curveTo":
            points.extend(_cubic(here, args[0], args[1], args[2], steps))
            here = args[2]
        elif verb == "closePath" and here is not None and start is not None:
            points.extend(_line(here, start, steps))
            here = start

    return points


def _line(a, b, steps):
    return [(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps) for i in range(1, steps + 1)]


def _mid(a, b):
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def _quadratic(a, q, b, steps):
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        out.append(
            (
                u * u * a[0] + 2 * u * t * q[0] + t * t * b[0],
                u * u * a[1] + 2 * u * t * q[1] + t * t * b[1],
            )
        )
    return out


def _cubic(a, c1, c2, b, steps):
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        out.append(
            (
                u**3 * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t**3 * b[0],
                u**3 * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t**3 * b[1],
            )
        )
    return out


def apart(one, two):
    """The furthest either outline strays from the other."""
    if not one or not two:
        return math.inf if (one or two) else 0.0
    return max(_furthest(one, two), _furthest(two, one))


def _furthest(one, two):
    worst = 0.0
    for p in one:
        near = min(math.dist(p, q) for q in two)
        worst = max(worst, near)
    return worst


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
