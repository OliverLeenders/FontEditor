"""Read a designspace and its UFOs with fontTools, and say what is wrong.

The counterpart of `check_ufo.py` for a family. A UFO knows nothing of the
others, so everything that makes several of them one design lives in one small
XML file — and the failure that file makes possible is invisible until a build:
a source naming a UFO that is not beside it, an axis a location refers to by the
wrong name, a default that is outside its own range.

`designspaceLib` is the reader every build pipeline goes through, and it is the
one that decides whether what we wrote is a designspace or merely XML.
"""

import sys
from pathlib import Path
from types import SimpleNamespace

from fontTools.designspaceLib import DesignSpaceDocument
from fontTools.ufoLib import UFOReader

problems = []
notes = []


def problem(where, what):
    problems.append(f"{where}: {what}")


def note(what):
    notes.append(what)


path = Path(sys.argv[1])
here = path.parent

document = DesignSpaceDocument.fromfile(path)
note(f"format {document.formatVersion}, {len(document.axes)} axes, {len(document.sources)} sources")

# ------------------------------------------------------------------- the axes
if not document.axes:
    problem("axes", "the designspace declares none, so nothing can vary")

for axis in document.axes:
    note(f"axis {axis.tag} {axis.name!r} {axis.minimum}–{axis.default}–{axis.maximum}")

    if len(axis.tag) != 4:
        problem("axes", f"{axis.tag!r} is not a four-character tag")
    if not (axis.minimum <= axis.default <= axis.maximum):
        problem("axes", f"{axis.tag}: the default {axis.default} is outside {axis.minimum}–{axis.maximum}")

names = {axis.name for axis in document.axes}

# ---------------------------------------------------------------- the sources
if len(document.sources) < 2:
    problem("sources", "a family needs more than one master")

seen = set()
for source in document.sources:
    where = source.filename or "<no filename>"
    note(f"source {where} at {source.location}")

    # The failure this whole check exists for: a designspace naming a file that
    # is not there. Nothing notices until a build, and then nothing says why.
    ufo = here / source.filename
    if not ufo.is_dir():
        problem(where, "the UFO it names is not beside the designspace")
        continue

    # Every dimension has to name an axis this file declares, by name and not
    # by tag — which is the detail a writer gets wrong and no reader forgives.
    for axis_name in source.location:
        if axis_name not in names:
            problem(where, f"the location names {axis_name!r}, which is not an axis here")

    at = tuple(sorted(source.location.items()))
    if at in seen:
        problem(where, f"another source is already at {source.location}")
    seen.add(at)

    reader = UFOReader(ufo, validate=True)
    info = SimpleNamespace()
    try:
        reader.readInfo(info)
    except Exception as e:  # noqa: BLE001
        problem(where, f"fontinfo.plist: {type(e).__name__}: {e}")
        continue

    glyphs = sorted(reader.getGlyphSet().keys())
    note(f"  {getattr(info, 'familyName', None)!r} {getattr(info, 'styleName', None)!r}, {len(glyphs)} glyphs")

    # A UFO is opened without its designspace all the time, so it has to say
    # which style it is on its own.
    if source.styleName and source.styleName != getattr(info, "styleName", None):
        problem(
            where,
            f"the designspace calls it {source.styleName!r} and the UFO calls itself "
            f"{getattr(info, 'styleName', None)!r}",
        )

    if source.familyName and source.familyName != getattr(info, "familyName", None):
        problem(
            where,
            f"the designspace calls it {source.familyName!r} and the UFO calls it "
            f"{getattr(info, 'familyName', None)!r}",
        )

# --------------------------------------------------- the masters against each other
sets = {}
for source in document.sources:
    ufo = here / source.filename
    if not ufo.is_dir():
        continue
    sets[source.filename] = set(UFOReader(ufo, validate=True).getGlyphSet().keys())

if len(sets) > 1:
    everything = set.union(*sets.values())
    for filename, glyphs in sets.items():
        missing = sorted(everything - glyphs)
        if missing:
            problem(filename, f"has not got {missing[:8]}{'…' if len(missing) > 8 else ''}")

print("\n".join(notes))
if problems:
    print("\nProblems:")
    print("\n".join(problems))
    sys.exit(1)

print("\nNo problems found.")
