"""Check a family's variable fonts between the masters, against fontTools' own model.

`check_vf.py` pins a variable font at each master and asks whether it is that
master, which says the deltas are right *at the masters*. It cannot see the
three things that only show between them:

- a delta at the corner of two axes that counts the corner's edges twice, which
  is right at every master and wrong everywhere else;
- a master that draws only some glyphs, whose glyphs vary over other regions
  than the rest of the font;
- a map between the weight a menu offers and the stem it is drawn at, which the
  font carries in `avar` and which moves everything between the masters.

So this reads the designspace the editor wrote with designspaceLib, works out
from the masters' own points — with fontTools' `VariationModel`, not the
editor's arithmetic — what every glyph should be at a list of places between
the masters, pins both flavours of the font there, and compares. The CFF2 font
keeps the cubics as drawn and is compared point for point; the TrueType font is
compared with the CFF2 one as a shape. The rules are checked the same way: what
designspaceLib says the swaps are at each place, against what the pinned font's
`rvrn` feature does.

    python check_designspace_vf.py <directory>

The directory holds `Proof.designspace` and its UFOs, `Proof-VF.otf`,
`Proof-VF.ttf`, and `masters.json`.
"""

import json
import os
import sys

from fontTools.designspaceLib import DesignSpaceDocument, processRules
from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.ufoLib import UFOReader
from fontTools.varLib.models import VariationModel, normalizeValue

from outline import apart, flatten

problems = []
notes = []


def problem(where, what):
    problems.append(f"{where}: {what}")


here = sys.argv[1]
document = DesignSpaceDocument.fromfile(os.path.join(here, "Proof.designspace"))
expected = json.load(open(os.path.join(here, "masters.json"), encoding="utf-8"))

axes = {axis.tag: axis for axis in document.axes}
by_name = {axis.name: axis for axis in document.axes}
note = notes.append

# ----------------------------------------------------------- the file itself
note(f"format {document.formatVersion}, {len(document.axes)} axes, {len(document.sources)} sources")
if not any(axis.map for axis in document.axes):
    problem("designspace", "no axis has a map, so avar is not being exercised")
layered = [s for s in document.sources if s.layerName]
if len(layered) != 1:
    problem("designspace", f"expected one source drawn as a layer, found {len(layered)}")
for source in layered:
    reader = UFOReader(os.path.join(here, source.filename), validate=True)
    if source.layerName not in reader.getLayerNames():
        problem(source.filename, f"has no layer {source.layerName!r}")
    else:
        note(f"layer {source.layerName!r} of {source.filename}: {sorted(reader.getGlyphSet(source.layerName).keys())}")
if len(document.rules) != 2:
    problem("designspace", f"expected two rules, found {len(document.rules)}")


def design_bounds(axis):
    return tuple(axis.map_forward(v) for v in (axis.minimum, axis.default, axis.maximum))


def normalized(design_by_tag):
    return {
        tag: normalizeValue(design_by_tag.get(tag, axis.map_forward(axis.default)), design_bounds(axis))
        for tag, axis in axes.items()
    }


masters = expected["masters"]
glyph_names = sorted({name for m in masters for name in m["glyphs"]})


def expected_glyph(name, design):
    """The glyph's points and advance at a design location, from the masters that draw it."""
    taking = [m for m in masters if name in m["glyphs"]]
    locations = [normalized(m["location"]) for m in taking]
    model = VariationModel(locations, axisOrder=list(axes))
    at = normalized(design)

    count = len(taking[0]["glyphs"][name]["points"])
    points = []
    for i in range(count):
        x = model.interpolateFromMasters(at, [m["glyphs"][name]["points"][i][0] for m in taking])
        y = model.interpolateFromMasters(at, [m["glyphs"][name]["points"][i][1] for m in taking])
        points.append((x, y))
    advance = model.interpolateFromMasters(at, [m["glyphs"][name]["advance"] for m in taking])
    return points, advance


def points_of(glyphset, name):
    pen = RecordingPen()
    glyphset[name].draw(pen)
    return [pt for _, args in pen.value for pt in args if isinstance(pt, tuple)]


def rvrn_mapping(font):
    """Every single substitution the font's rvrn and rclt features make, as it stands."""
    if "GSUB" not in font:
        return {}
    table = font["GSUB"].table
    mapping = {}
    for record in table.FeatureList.FeatureRecord:
        if record.FeatureTag not in ("rvrn", "rclt"):
            continue
        for index in record.Feature.LookupListIndex:
            for sub in table.LookupList.Lookup[index].SubTable:
                mapping.update(getattr(sub, "mapping", {}))
    return mapping


otf_path = os.path.join(here, "Proof-VF.otf")
ttf_path = os.path.join(here, "Proof-VF.ttf")
if "avar" not in TTFont(otf_path) or "avar" not in TTFont(ttf_path):
    problem("fonts", "the weight axis has a map and a font has no avar")

rule_glyphs = sorted({name for rule in document.rules for pair in rule.subs for name in pair})

for user in expected["locations"]:
    by_tag = {by_name[name].tag: value for name, value in user.items()}
    design = {tag: axes[tag].map_forward(value) for tag, value in by_tag.items()}
    where = ", ".join(f"{name} {value}" for name, value in user.items())

    pinned_otf = instancer.instantiateVariableFont(TTFont(otf_path), dict(by_tag))
    pinned_ttf = instancer.instantiateVariableFont(TTFont(ttf_path), dict(by_tag))
    otf_glyphs = pinned_otf.getGlyphSet()
    ttf_glyphs = pinned_ttf.getGlyphSet()

    for name in glyph_names:
        want, advance = expected_glyph(name, design)
        got = points_of(otf_glyphs, name)
        if len(got) != len(want):
            problem(where, f"{name} has {len(got)} points in the CFF2 font and {len(want)} worked out")
            continue
        worst = max(max(abs(a[0] - b[0]), abs(a[1] - b[1])) for a, b in zip(got, want))
        if worst > 1.5:
            problem(where, f"{name} is {worst:.1f} units from where fontTools puts it in the CFF2 font")

        width = pinned_otf["hmtx"].metrics[name][0]
        if abs(width - advance) > 1.5:
            problem(where, f"{name} is {width} wide in the CFF2 font and {advance:.1f} worked out")
        ttf_width = pinned_ttf["hmtx"].metrics[name][0]
        if abs(ttf_width - advance) > 1.5:
            problem(where, f"{name} is {ttf_width} wide in the TrueType font and {advance:.1f} worked out")

        # Sampled finely: the glyphs here have long nearly straight curves, and
        # the distance is measured to the nearest sample rather than the curve.
        distance = apart(flatten(ttf_glyphs, name, 256), flatten(otf_glyphs, name, 256))
        if distance > 2.5:
            problem(where, f"{name} in the TrueType font is {distance:.1f} units from the CFF2 one")

    # The rules: which glyphs designspaceLib says are swapped here, against what
    # the pinned fonts substitute.
    design_by_name = {axes[tag].name: value for tag, value in design.items()}
    swapped = processRules(document.rules, design_by_name, rule_glyphs)
    wanted = {a: b for a, b in zip(rule_glyphs, swapped) if a != b}
    for label, font in (("CFF2", pinned_otf), ("TrueType", pinned_ttf)):
        got = {a: b for a, b in rvrn_mapping(font).items() if a != b}
        if got != wanted:
            problem(where, f"the {label} font swaps {got}, and the designspace says {wanted}")

    note(f"at {where}: {len(glyph_names)} glyphs agree; swaps {wanted}")

print("\n".join(notes))
if problems:
    print("\nProblems:")
    print("\n".join(problems))
    sys.exit(1)

print("\nBoth fonts are what fontTools works out from the masters, everywhere asked.")
