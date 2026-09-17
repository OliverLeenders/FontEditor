"""Read a UFO with fontTools and say everything that is wrong with it.

fontTools.ufoLib is the reference reader: Glyphs, RoboFont, fontmake and every
build pipeline in the type world go through it or through something built on it.
Validation is turned on everywhere it can be, so a plist with the wrong type or
a kerning entry naming a group that is not there is an error rather than a
shrug.
"""

import sys
from types import SimpleNamespace

from fontTools.ufoLib import UFOReader
from fontTools.ufoLib.validators import (
    fontInfoStyleMapStyleNameValidator,
    groupsValidator,
)
from fontTools.pens.recordingPen import RecordingPointPen

problems = []
notes = []


def problem(where, what):
    problems.append(f"{where}: {what}")


def note(what):
    notes.append(what)


path = sys.argv[1]
reader = UFOReader(path, validate=True)

note(f"format version {reader.formatVersionTuple}")

# ---------------------------------------------------------------- fontinfo
info = SimpleNamespace()
try:
    reader.readInfo(info)
except Exception as e:  # noqa: BLE001
    problem("fontinfo.plist", f"{type(e).__name__}: {e}")

for key in ("familyName", "styleName", "unitsPerEm", "ascender", "descender", "xHeight", "capHeight"):
    value = getattr(info, key, None)
    if value is None:
        problem("fontinfo.plist", f"{key} is missing")
    else:
        note(f"info {key} = {value!r}")

if getattr(info, "styleMapStyleName", None) is not None:
    if not fontInfoStyleMapStyleNameValidator(info.styleMapStyleName):
        problem("fontinfo.plist", f"styleMapStyleName {info.styleMapStyleName!r} is not one of the four allowed")

# The identity a released font needs, and the keys the editor does not model but
# carries anyway. Both are here for the same reason: ufoLib validates every one
# of them by type and range, so a value this editor wrote wrongly is an error
# rather than something a designer discovers in a font menu months later.
for key in (
    "versionMajor",
    "versionMinor",
    "italicAngle",
    "copyright",
    "openTypeNameDesigner",
    "openTypeNameLicense",
    "openTypeOS2VendorID",
    "openTypeOS2WeightClass",
    "openTypeOS2WidthClass",
    "openTypeNamePreferredFamilyName",
    "openTypeNamePreferredSubfamilyName",
    "styleMapFamilyName",
    "styleMapStyleName",
):
    value = getattr(info, key, None)
    if value is None:
        problem("fontinfo.plist", f"{key} is missing")
    else:
        note(f"info {key} = {value!r}")

# Keys the editor has no field for. It read these out of the file it opened and
# wrote them back; if they are not here, saving a font took them out of it.
for key, expected in (
    ("note", "drawn to be read by a machine"),
    ("openTypeOS2Panose", [2, 11, 6, 3, 2, 0, 0, 2, 0, 4]),
    ("postscriptBlueValues", [-12, 0, 500, 512]),
):
    value = getattr(info, key, None)
    if value is None:
        problem("fontinfo.plist", f"{key} was not kept")
    else:
        found = list(value) if isinstance(expected, list) else value
        if found != expected:
            problem("fontinfo.plist", f"{key} came back as {found!r}, not {expected!r}")
        else:
            note(f"kept {key}")

# ---------------------------------------------------------------- groups
try:
    groups = reader.readGroups()
except Exception as e:  # noqa: BLE001
    groups = {}
    problem("groups.plist", f"{type(e).__name__}: {e}")

ok, message = groupsValidator(groups)
if not ok:
    problem("groups.plist", message)
note(f"{len(groups)} groups: {sorted(groups)}")

# ---------------------------------------------------------------- glyphs
layers = reader.getLayerNames()
note(f"layers: {layers}, default {reader.getDefaultLayerName()!r}")

# The other layers, read with validation as the drawing is: a layer this editor
# wrote that fontTools refuses is a background nobody else can open.
for layer_name in layers:
    if layer_name == reader.getDefaultLayerName():
        continue
    try:
        other = reader.getGlyphSet(layer_name, validateRead=True, validateWrite=True)
        for name in other.keys():
            other.readGlyph(name, SimpleNamespace(), RecordingPointPen())
        note(f"layer {layer_name!r}: {sorted(other.keys())}")
    except Exception as e:  # noqa: BLE001
        problem(f"layer {layer_name}", f"{type(e).__name__}: {e}")

glyphset = reader.getGlyphSet(validateRead=True, validateWrite=True)
names = sorted(glyphset.keys())
note(f"{len(names)} glyphs: {names}")

drawn = {}
for name in names:
    pen = RecordingPointPen()
    glyph = SimpleNamespace()
    try:
        glyphset.readGlyph(name, glyph, pen)
    except Exception as e:  # noqa: BLE001
        problem(f"glyph {name}", f"{type(e).__name__}: {e}")
        continue

    drawn[name] = {
        "note": getattr(glyph, "note", None),
        "guidelines": getattr(glyph, "guidelines", []),
        "lib": getattr(glyph, "lib", {}),
        "width": getattr(glyph, "width", None),
        "unicodes": getattr(glyph, "unicodes", []),
        "points": [c for c in pen.value if c[0] == "addPoint"],
        "components": [c for c in pen.value if c[0] == "addComponent"],
        "contours": sum(1 for c in pen.value if c[0] == "beginPath"),
        "anchors": getattr(glyph, "anchors", []),
    }

    if getattr(glyph, "width", None) is None:
        problem(f"glyph {name}", "no advance width")

# What a glyph carries that the editor does not model. It read these out of the
# `.glif` and wrote them back; a reference reader finding them where they were is
# the whole claim.
a = drawn.get("a", {})
if a.get("note") != "the join wants looking at":
    problem("glyph a", f"the note was not kept: {a.get('note')!r}")
if not any(g.get("name") == "stem" for g in a.get("guidelines", [])):
    problem("glyph a", f"the guideline was not kept: {a.get('guidelines')!r}")
if a.get("lib", {}).get("com.tunni.proof") != "kept":
    problem("glyph a", f"the lib was not kept: {a.get('lib')!r}")
# anchors: read back by name, and nowhere in the outline. An anchor written as
# a one-point contour is the format-1 spelling, and reading it as a contour is
# the mistake this asks about.
anchored = {name: g["anchors"] for name, g in drawn.items() if g["anchors"]}
note(f"anchors: { {name: [a['name'] for a in a_list] for name, a_list in anchored.items()} }")

for name, anchors in anchored.items():
    for a in anchors:
        if not a.get("name"):
            problem(f"glyph {name}", "an anchor with no name")
        if a.get("x") is None or a.get("y") is None:
            problem(f"glyph {name}", f"anchor {a.get('name')!r} has no position")

# every component points at a glyph that exists
for name, g in drawn.items():
    for call in g["components"]:
        base = call[1][0]
        if base not in drawn:
            problem(f"glyph {name}", f"component references {base!r}, which is not in the font")

# ---------------------------------------------------------------- kerning
try:
    kerning = reader.readKerning()
except Exception as e:  # noqa: BLE001
    kerning = {}
    problem("kerning.plist", f"{type(e).__name__}: {e}")

# readKerning(validate=True) has already run kerningValidator over the raw
# nested dict; what comes back here is flattened to pair keys, which that
# validator would reject on shape alone.
note(f"{len(kerning)} kerning pairs")

for (first, second), value in sorted(kerning.items()):
    for side in (first, second):
        if side.startswith("public.kern"):
            if side not in groups:
                problem("kerning.plist", f"{side} is not defined in groups.plist")
        elif side not in drawn:
            problem("kerning.plist", f"{side} is not a glyph in this font")
    note(f"kern {first} {second} = {value}")

for name, members in groups.items():
    for member in members:
        if member not in drawn:
            problem("groups.plist", f"{name} contains {member!r}, which is not a glyph in this font")

# ---------------------------------------------------------------- lib
try:
    lib = reader.readLib()
    order = lib.get("public.glyphOrder")
    if order is not None:
        missing = [n for n in order if n not in drawn]
        if missing:
            problem("lib.plist", f"public.glyphOrder names glyphs that are not here: {missing}")
        note(f"glyph order of {len(order)}: {order}")
    else:
        note("no public.glyphOrder in lib.plist")
except Exception as e:  # noqa: BLE001
    problem("lib.plist", f"{type(e).__name__}: {e}")

# ---------------------------------------------------------------- features
try:
    features = reader.readFeatures()
except Exception as e:  # noqa: BLE001
    features = ""
    problem("features.fea", f"{type(e).__name__}: {e}")

if features.strip():
    try:
        from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
        from fontTools.ttLib import TTFont

        font = TTFont()
        font.setGlyphOrder(names)
        # feaLib wants a glyph order and nothing else to compile substitutions.
        addOpenTypeFeaturesFromString(font, features)
        tables = [t for t in ("GSUB", "GPOS") if t in font]
        note(f"features.fea compiles; it builds {tables or 'nothing'}")
    except Exception as e:  # noqa: BLE001
        problem("features.fea", f"{type(e).__name__}: {e}")
else:
    note("no features")

# ---------------------------------------------------------------- report
print("\n".join(notes))
print()
if problems:
    print(f"{len(problems)} PROBLEMS")
    for p in problems:
        print(f"  - {p}")
    sys.exit(1)

print("No problems found.")
