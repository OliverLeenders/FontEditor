"""Render both flavours of the proof font with FreeType and compare with the drawing.

Everything else that reads these fonts reads them as data: fontTools decompiles
the tables and draws the curves back, and a font can pass all of that and still
come out of a rasteriser wrong. An overlap left in a CFF outline fills with a
notch where two strokes cross; a counter running the wrong way fills solid; a
hairline drops out of a small size. None of those is a malformed table.

So FreeType — the rasteriser behind Android, ChromeOS, most Linux desktops and
a good share of browsers — draws every glyph of both files, unhinted and
antialiased, at a reading size, a display size and a large one, and the pixels
are compared with the drawing the fonts were compiled from, filled here.

The fill is the rule the editor draws by, written again rather than borrowed: a
contour lying wholly inside an odd number of others is a counter and takes ink
away, and every other contour adds it, so overlapping strokes join and a counter
is a hole whichever way round it was drawn. That is the drawing as the designer
sees it, and it is what the compiled font has to look like.

Given the directory the export step wrote: Render.otf, Render.ttf, drawing.json.
"""

import json
import math
import sys
from pathlib import Path

import freetype
import numpy as np

# Pixel sizes, and how far each may be from the drawing: the ink that differs,
# as a share of the glyph's ink. Looser at small sizes, where nearly every pixel
# is an edge pixel and the smallest disagreement about where an edge falls is a
# large share of a glyph a dozen pixels tall.
SIZES = {16: 0.12, 48: 0.05, 256: 0.02}

# Samples per pixel along each side, for the drawing's coverage. FreeType
# measures the area under each pixel exactly; sixty-four samples measure it to
# within a sixty-fourth, which is well inside every tolerance above.
SAMPLES = 8

# Steps per curve when the drawing is flattened: a chord error far below a
# sampled pixel at the largest size.
STEPS = 64


def flatten(contour, scale):
    """A contour as a polygon in pixels, curves and all."""
    nodes = contour["nodes"]
    points = []
    count = len(nodes)
    for i, a in enumerate(nodes):
        if i == count - 1 and not contour["closed"]:
            points.append((a["x"], a["y"]))
            break
        b = nodes[(i + 1) % count]
        # A segment is a curve only where both of its handles are there, which
        # is how the editor and the compiler both read it.
        if a["out"] is None or b["in"] is None:
            points.append((a["x"], a["y"]))
            continue
        c1, c2 = a["out"], b["in"]
        for s in range(STEPS):
            t = s / STEPS
            u = 1 - t
            points.append(
                (
                    u**3 * a["x"] + 3 * u * u * t * c1["x"] + 3 * u * t * t * c2["x"] + t**3 * b["x"],
                    u**3 * a["y"] + 3 * u * u * t * c1["y"] + 3 * u * t * t * c2["y"] + t**3 * b["y"],
                )
            )
    return np.array(points, dtype=float) * scale


def edges(polygon):
    x0, y0 = polygon[:, 0], polygon[:, 1]
    return x0, y0, np.roll(x0, -1), np.roll(y0, -1)


def contains(polygon, points):
    """Which points lie inside a polygon, by counting crossings to the right."""
    x0, y0, x1, y1 = edges(polygon)
    px = points[:, 0][:, None]
    py = points[:, 1][:, None]
    crosses = (y0 <= py) != (y1 <= py)
    with np.errstate(divide="ignore", invalid="ignore"):
        at = x0 + (py - y0) * (x1 - x0) / (y1 - y0)
    return ((crosses & (at > px)).sum(axis=1) % 2) == 1


def inside(polygon, xs, ys):
    """Every sample inside one polygon, a row of samples at a time."""
    x0, y0, x1, y1 = edges(polygon)
    grid = np.zeros((len(ys), len(xs)), dtype=bool)
    for row, y in enumerate(ys):
        crosses = (y0 <= y) != (y1 <= y)
        if not crosses.any():
            continue
        at = x0[crosses] + (y - y0[crosses]) * (x1[crosses] - x0[crosses]) / (
            y1[crosses] - y0[crosses]
        )
        at.sort()
        grid[row] = (np.searchsorted(at, xs) % 2) == 1
    return grid


def drawn(polygons, left, top, width, height):
    """The drawing's coverage of each pixel, 0 to 1, rows from the top."""
    step = 1 / SAMPLES
    xs = left + (np.arange(width * SAMPLES) + 0.5) * step
    ys = top - (np.arange(height * SAMPLES) + 0.5) * step

    winding = np.zeros((len(ys), len(xs)), dtype=int)
    for i, polygon in enumerate(polygons):
        depth = sum(
            1 for j, other in enumerate(polygons) if j != i and contains(other, polygon).all()
        )
        sense = 1 if depth % 2 == 0 else -1
        winding += sense * inside(polygon, xs, ys)

    filled = (winding > 0).astype(float)
    return filled.reshape(height, SAMPLES, width, SAMPLES).mean(axis=(1, 3))


def rendered(face, code_point, size):
    """FreeType's bitmap for a character: coverage 0 to 1, and where it sits."""
    face.set_pixel_sizes(0, size)
    face.load_char(chr(code_point), freetype.FT_LOAD_RENDER | freetype.FT_LOAD_NO_HINTING)
    slot = face.glyph
    bitmap = slot.bitmap
    if bitmap.rows == 0 or bitmap.width == 0:
        return np.zeros((0, 0)), slot.bitmap_left, slot.bitmap_top
    pixels = np.array(bitmap.buffer, dtype=float).reshape(bitmap.rows, abs(bitmap.pitch))
    return pixels[:, : bitmap.width] / 255, slot.bitmap_left, slot.bitmap_top


def compare(face, glyph, units_per_em, size):
    """How far FreeType's rendering is from the drawing: (differing ink, drawn ink, rendered ink)."""
    scale = size / units_per_em
    polygons = [
        polygon
        for polygon in (flatten(c, scale) for c in glyph["contours"] if len(c["nodes"]) >= 2)
        if len(polygon) >= 3
    ]
    bitmap, bitmap_left, bitmap_top = rendered(face, glyph["codePoint"], size)

    xs = [bitmap_left, bitmap_left + bitmap.shape[1]]
    ys = [bitmap_top, bitmap_top - bitmap.shape[0]]
    for polygon in polygons:
        xs += [polygon[:, 0].min(), polygon[:, 0].max()]
        ys += [polygon[:, 1].min(), polygon[:, 1].max()]

    left = math.floor(min(xs)) - 1
    top = math.ceil(max(ys)) + 1
    width = math.ceil(max(xs)) + 1 - left
    height = top - (math.floor(min(ys)) - 1)

    reference = drawn(polygons, left, top, width, height)
    canvas = np.zeros((height, width))
    row, col = top - bitmap_top, bitmap_left - left
    canvas[row : row + bitmap.shape[0], col : col + bitmap.shape[1]] = bitmap

    return float(np.abs(canvas - reference).sum()), float(reference.sum()), float(canvas.sum())


def main(directory):
    folder = Path(directory)
    drawing = json.loads((folder / "drawing.json").read_text())
    units_per_em = drawing["unitsPerEm"]
    problems = []

    for flavour in ("Render.otf", "Render.ttf"):
        face = freetype.Face(str(folder / flavour))
        for glyph in drawing["glyphs"]:
            if glyph["codePoint"] is None:
                continue
            for size, tolerance in SIZES.items():
                differing, ink, rendered_ink = compare(face, glyph, units_per_em, size)
                if ink == 0:
                    if rendered_ink > 0:
                        problems.append(f"{flavour} {glyph['name']} at {size}px: ink where nothing is drawn")
                    continue
                share = differing / ink
                print(f"{flavour:11} {glyph['name']:10} {size:4}px  differs by {share:6.2%} of its ink")
                if rendered_ink == 0:
                    problems.append(f"{flavour} {glyph['name']} at {size}px: renders nothing")
                elif share > tolerance:
                    problems.append(
                        f"{flavour} {glyph['name']} at {size}px: differs from the drawing by "
                        f"{share:.2%} of its ink, more than {tolerance:.0%}"
                    )

    if problems:
        print("\nFreeType does not draw what was drawn:")
        for problem in problems:
            print(f"  {problem}")
        return 1
    print("\nBoth flavours render as drawn at every size.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: check_render.py <directory with Render.otf, Render.ttf, drawing.json>")
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
