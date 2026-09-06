"""Read an OTF with fontTools and say everything that is wrong with its marks.

The counterpart of `tools/ufo-check` for the binary. Mark attachment is a tree
of offsets into offsets — coverage, mark array, base array, one anchor each —
and the only convincing proof that it is right is a reader nobody here wrote
opening the font and finding the anchors where they were put.

fontTools is that reader: it is what fontmake, feaLib and every build pipeline
in the type world go through, and it decompiles the tables structurally rather
than trusting their lengths.
"""

import sys

from fontTools.ttLib import TTFont

problems = []
notes = []


def problem(where, what):
    problems.append(f"{where}: {what}")


def note(what):
    notes.append(what)


path = sys.argv[1]
font = TTFont(path)

# ------------------------------------------------------------------- present
for tag in ("GPOS", "GDEF"):
    if tag not in font:
        problem(tag, "missing: the font declares no mark attachment at all")

if problems:
    print("\n".join(problems))
    sys.exit(1)

# ---------------------------------------------------------------------- GDEF
gdef = font["GDEF"].table
classes = getattr(gdef.GlyphClassDef, "classDefs", None)
if classes is None:
    problem("GDEF", "no glyph class definitions")
else:
    note(f"GDEF classes: {len(classes)} glyphs")
    for name, expected in (("a", 1), ("acutecomb", 3), ("ogonekcomb", 3), ("macroncomb", 3)):
        got = classes.get(name)
        if got != expected:
            problem("GDEF", f"{name} is class {got}, expected {expected}")

# ---------------------------------------------------------------------- GPOS
gpos = font["GPOS"].table
features = {f.FeatureTag for f in gpos.FeatureList.FeatureRecord}
note(f"features: {sorted(features)}")

for tag in ("mark", "mkmk"):
    if tag not in features:
        problem("GPOS", f"no {tag} feature")

lookups = gpos.LookupList.Lookup
by_type = {}
for lookup in lookups:
    by_type.setdefault(lookup.LookupType, []).append(lookup)
note(f"lookup types: {sorted(by_type)}")


def anchors_of(lookup, kind):
    """Mark and base anchors of a mark-to-base or mark-to-mark lookup."""
    marks = {}
    bases = {}
    for sub in lookup.SubTable:
        mark_coverage = sub.MarkCoverage.glyphs if kind == 4 else sub.Mark1Coverage.glyphs
        mark_array = sub.MarkArray if kind == 4 else sub.Mark1Array
        for name, record in zip(mark_coverage, mark_array.MarkRecord):
            marks[name] = (record.Class, record.MarkAnchor.XCoordinate, record.MarkAnchor.YCoordinate)

        base_coverage = sub.BaseCoverage.glyphs if kind == 4 else sub.Mark2Coverage.glyphs
        base_array = sub.BaseArray.BaseRecord if kind == 4 else sub.Mark2Array.Mark2Record
        for name, record in zip(base_coverage, base_array):
            slots = record.BaseAnchor if kind == 4 else record.Mark2Anchor
            bases[name] = [
                None if a is None else (a.XCoordinate, a.YCoordinate) for a in slots
            ]
    return marks, bases


# ------------------------------------------------------------- mark-to-base
base_lookups = by_type.get(4, [])
if not base_lookups:
    problem("GPOS", "no mark-to-base lookup")
else:
    marks, bases = anchors_of(base_lookups[0], 4)
    note(f"mark-to-base: {len(marks)} marks on {len(bases)} bases")

    if "acutecomb" not in marks:
        problem("mark", "acutecomb is not a mark")
    elif marks["acutecomb"][1:] != (0, 640):
        problem("mark", f"acutecomb attaches at {marks['acutecomb'][1:]}, expected (0, 640)")

    if "a" not in bases:
        problem("mark", "a is not a base")
    else:
        row = bases["a"]
        placed = [p for p in row if p is not None]
        if (200, 620) not in placed:
            problem("mark", f"a offers {placed}, expected a top at (200, 620)")
        if (320, 0) not in placed:
            problem("mark", f"a offers {placed}, expected an ogonek at (320, 0)")

        # Two classes, and the accent's class has to point at the letter's own
        # anchor for that class rather than at whichever came first.
        if "acutecomb" in marks:
            top_class = marks["acutecomb"][0]
            if row[top_class] != (200, 620):
                problem(
                    "mark",
                    f"a's anchor for the acute's class is {row[top_class]}, expected (200, 620)",
                )

    # A mark is never also a base in the same lookup.
    for name in marks:
        if name in bases:
            problem("mark", f"{name} is both a mark and a base")

# ------------------------------------------------------------- mark-to-mark
mark_lookups = by_type.get(6, [])
if not mark_lookups:
    problem("GPOS", "no mark-to-mark lookup")
else:
    marks, stacked = anchors_of(mark_lookups[0], 6)
    note(f"mark-to-mark: {len(marks)} marks on {len(stacked)} marks")

    if "acutecomb" not in stacked:
        problem("mkmk", "acutecomb offers no place for a second accent")
    else:
        placed = [p for p in stacked["acutecomb"] if p is not None]
        if (0, 720) not in placed:
            problem("mkmk", f"acutecomb offers {placed}, expected a top at (0, 720)")
    if "a" in stacked:
        problem("mkmk", "a is a letter and has no business in mark-to-mark")

# ---------------------------------------------------------------------- said
print("\n".join(notes))
if problems:
    print()
    print("\n".join(problems))
    sys.exit(1)

print("\nno problems")
