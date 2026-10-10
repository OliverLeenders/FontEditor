"""Draw a variable font at a weight and see whether a stroke fills as it was drawn there.

A stroke goes into a variable font as a line round its ink that crosses itself,
drawn to the same points in every master so that the points can move between
them. Whether they move to the right places is a question about the deltas, and
whether a line that crosses itself fills as the ink is a question about the
non-zero rule: neither is one this repository can ask of itself.

So fontTools draws the font at each weight, and a grid of points is asked of the
glyph there and of the same stroke exported as a static font at that weight,
where its ink is one joined outline. A point counts when the static font says
the same of it and of the points a margin around it: the edge is each stroker's
to place to within its tolerance, and half way along the axis the points have
moved in straight lines where the ink did not quite.

    python check_vf_strokes.py <dir> [glyph]

The directory is what `STROKES_OUT` writes from `variable-strokes.test.ts`:
`Penned.otf`, `Penned.ttf`, and `static-<weight>.otf` for each weight.
"""

import glob
import os
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.pointInsidePen import PointInsidePen
from fontTools.ttLib import TTFont

ACROSS = 48
# At a master the outline is that master's own; between them it is a blend.
MARGIN_AT_MASTER = 1.5
MARGIN_BETWEEN = 4.0

folder = sys.argv[1]
name = sys.argv[2] if len(sys.argv) > 2 else "s"

statics = {}
for path in glob.glob(os.path.join(folder, "static-*.otf")):
    weight = int(os.path.basename(path)[len("static-") : -len(".otf")])
    statics[weight] = TTFont(path)
weights = sorted(statics)
if len(weights) < 2:
    print(f"{folder}: no static fonts to compare with")
    sys.exit(1)


def inside(glyphs, x, y):
    pen = PointInsidePen(glyphs, (x, y), evenOdd=False)
    glyphs[name].draw(pen)
    return pen.getResult()


problems = []
for variable in ("Penned.otf", "Penned.ttf"):
    for weight in weights:
        # Drawn at the weight rather than made into a font of that weight first:
        # an instance has its coordinates rounded, each a step on from the one
        # before it, and round a line of two hundred points that adds up to a
        # couple of units which are the rounding and not the font.
        ours = TTFont(os.path.join(folder, variable)).getGlyphSet(location={"wght": weight})
        theirs = statics[weight].getGlyphSet()

        box = BoundsPen(theirs)
        theirs[name].draw(box)
        x0, y0, x1, y1 = box.bounds
        step = max(x1 - x0, y1 - y0) / ACROSS
        margin = MARGIN_AT_MASTER if weight in (weights[0], weights[-1]) else MARGIN_BETWEEN
        ring = [(-margin, 0), (margin, 0), (0, -margin), (0, margin)]

        checked = missing = extra = 0
        # Off the whole numbers a font is drawn on. A row of the grid that runs
        # along a level edge - the foot of a stem cut on the baseline - is on
        # the outline from end to end, and says whatever the pen asking
        # happens to make of that.
        y = y0 - step + 0.37
        while y <= y1 + step:
            x = x0 - step + 0.29
            while x <= x1 + step:
                here = inside(theirs, x, y)
                if all(inside(theirs, x + dx, y + dy) == here for dx, dy in ring):
                    checked += 1
                    filled = inside(ours, x, y)
                    if here and not filled:
                        missing += 1
                    if filled and not here:
                        extra += 1
                x += step
            y += step

        print(
            f"{variable} at {weight}: {checked} points, {missing} missing, {extra} extra"
        )
        # A stem is a narrow thing, and most of a grid laid over it is near an edge.
        if checked < 300:
            problems.append(f"{variable} at {weight}: only {checked} points to go by")
        if missing or extra:
            problems.append(
                f"{variable} at {weight}: {missing} points of ink not filled, {extra} filled that are not ink"
            )

if problems:
    print("\n".join(problems))
    sys.exit(1)
print(f"{name} fills as it was drawn at {', '.join(str(w) for w in weights)}")
