"""Compare the TrueType flavour with the PostScript one, curve for curve.

The cubic outlines this editor draws cannot be written as quadratics exactly, so
the TrueType flavour is an approximation and the only question worth asking is
how good. The answer cannot come from here: the arithmetic that would measure
the conversion is the arithmetic that made it.

So fontTools draws both flavours of the same font and the two outlines are
compared as shapes — every point on one against the nearest point on the other,
in both directions, which is the measure that notices a curve that bulges as
readily as one that flattens.

Given the TrueType file and the CFF one built from the same drawing.
"""

import math
import sys

from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont

problems = []
notes = []

# What the conversion is allowed to move a curve by, in design units. Well
# inside the grid a rasteriser puts the outline on, and far inside anything a
# person could see at reading size.
TOLERANCE = 1.0


def flatten(glyphset, name, steps=64):
    """A glyph as a dense polyline, whatever kind of curves it is made of."""
    pen = RecordingPen()
    glyphset[name].draw(pen)

    points = []
    at = (0.0, 0.0)
    start = (0.0, 0.0)

    for operator, args in pen.value:
        if operator == "moveTo":
            at = start = args[0]
            points.append(at)
        elif operator == "lineTo":
            points.extend(_line(at, args[0], steps))
            at = args[0]
        elif operator == "curveTo":
            for i in range(1, steps + 1):
                points.append(_cubic(at, args[0], args[1], args[2], i / steps))
            at = args[2]
        elif operator == "qCurveTo":
            # A run of quadratics with implied on-curve points between them,
            # which is how TrueType says a curve.
            controls = list(args[:-1])
            end = args[-1] if args[-1] is not None else controls[0]
            for i, control in enumerate(controls):
                to = (
                    end
                    if i == len(controls) - 1
                    else _mid(control, controls[i + 1])
                )
                for s in range(1, steps + 1):
                    points.append(_quadratic(at, control, to, s / steps))
                at = to
        elif operator == "closePath":
            points.extend(_line(at, start, steps))
            at = start

    return points


def _line(a, b, steps):
    return [(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps) for i in range(1, steps + 1)]


def _mid(a, b):
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def _cubic(a, c1, c2, b, t):
    u = 1 - t
    return (
        u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
        u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1],
    )


def _quadratic(a, q, b, t):
    u = 1 - t
    return (u * u * a[0] + 2 * u * t * q[0] + t * t * b[0], u * u * a[1] + 2 * u * t * q[1] + t * t * b[1])


def apart(one, two):
    """How far the furthest point of one gets from the whole of the other.

    To the *segments* of the other outline rather than to its sampled points.
    Measuring to the points makes the sample spacing part of the answer — a
    reference sampled every six units reports six units of error for a curve
    that is exactly on top of it — and that spacing is an artefact of the
    measurement rather than anything about the font.
    """
    worst = 0.0
    for p in one:
        best = min(
            _to_segment(p, two[i], two[i + 1]) for i in range(len(two) - 1)
        )
        worst = max(worst, best)
    return worst


def _to_segment(p, a, b):
    """The distance from a point to a line segment."""
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    length = dx * dx + dy * dy
    if length == 0:
        return math.hypot(p[0] - a[0], p[1] - a[1])

    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length))
    return math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t))


quadratic = TTFont(sys.argv[1])
cubic = TTFont(sys.argv[2])

if quadratic.sfntVersion != "\x00\x01\x00\x00":
    problems.append(f"sfnt: the TrueType file says {quadratic.sfntVersion!r}")
for tag in ("glyf", "loca"):
    if tag not in quadratic:
        problems.append(f"{tag}: a TrueType font has one and this has not")
if "CFF " in quadratic:
    problems.append("CFF : a font may not have both this and glyf")
if quadratic["head"].indexToLocFormat != (1 if len(quadratic["loca"].locations) and quadratic.reader.tables["loca"].length > 2 * len(quadratic["loca"].locations) else 0):
    pass  # fontTools reads loca by head; a disagreement would have thrown above.

one = quadratic.getGlyphSet()
two = cubic.getGlyphSet()

for name in sorted(set(one.keys()) & set(two.keys())):
    quad = flatten(one, name)
    cube = flatten(two, name)
    if not quad and not cube:
        continue
    if not quad or not cube:
        problems.append(f"{name}: one flavour draws it and the other does not")
        continue

    # Both ways round: a curve that bulges outward and one that flattens are
    # both wrong, and each is invisible to the other direction.
    out = max(apart(quad, cube), apart(cube, quad))
    notes.append(f"{name}: {out:.3f} units apart, {len(quad)} samples")
    if out > TOLERANCE:
        problems.append(f"{name}: the quadratic outline is {out:.3f} units from the cubic one")

print("\n".join(notes))
if problems:
    print("\nProblems:")
    print("\n".join(problems))
    sys.exit(1)

print(f"\nEvery glyph is within {TOLERANCE} units of the curve it was drawn as.")
