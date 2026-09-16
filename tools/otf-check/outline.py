"""Outlines as points along them, and how far apart two of them are.

Shared by the checks that compare a variable font's outlines as shapes: a
quadratic outline and a cubic one have no points in common, so the only
comparison there is is how far each strays from the other.
"""

import math

from fontTools.pens.recordingPen import RecordingPen


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
