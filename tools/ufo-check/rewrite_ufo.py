"""Rewrite a UFO with fontTools and zip it the way a real tool would.

The point is the other direction: our reader has only ever been handed archives
our own writer made. This produces a UFO written entirely by the reference
implementation — its own plist formatting, its own file names, its own
lib.plist — packed with Python's zipfile at default compression, which deflates.
"""

import sys
import zipfile
from pathlib import Path
from types import SimpleNamespace

from fontTools.pens.recordingPen import RecordingPointPen
from fontTools.ufoLib import UFOReader, UFOWriter

source = Path(sys.argv[1])
out = Path(sys.argv[2])
archive = Path(sys.argv[3])

reader = UFOReader(source, validate=True)

info = SimpleNamespace()
reader.readInfo(info)
groups = reader.readGroups()
kerning = reader.readKerning()
lib = reader.readLib()
features = reader.readFeatures()

def read_layer(glyphset):
    out = {}
    for name in glyphset.keys():
        pen = RecordingPointPen()
        glyph = SimpleNamespace()
        glyphset.readGlyph(name, glyph, pen)
        glyph.drawPoints = lambda p, _pen=pen: _pen.replay(p)
        out[name] = glyph
    return out


glyphs = read_layer(reader.getGlyphSet())
# Every other layer too, so what comes back has been through fontTools' writer
# whole — the background and the sketch as well as the drawing.
default = reader.getDefaultLayerName()
others = {
    name: read_layer(reader.getGlyphSet(name))
    for name in reader.getLayerNames()
    if name != default
}

if out.exists():
    import shutil

    shutil.rmtree(out)

writer = UFOWriter(out, formatVersion=3, validate=True)
writer.writeInfo(info)
if groups:
    writer.writeGroups(groups)
if kerning:
    writer.writeKerning(kerning)
if lib:
    writer.writeLib(lib)
if features:
    writer.writeFeatures(features)

layer = writer.getGlyphSet()
for name, glyph in glyphs.items():
    layer.writeGlyph(name, glyph, glyph.drawPoints)
layer.writeContents()
for layer_name, layer_glyphs in others.items():
    other = writer.getGlyphSet(layerName=layer_name, defaultLayer=False)
    for name, glyph in layer_glyphs.items():
        other.writeGlyph(name, glyph, glyph.drawPoints)
    other.writeContents()
writer.writeLayerContents()
writer.close()

with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
    for path in sorted(out.rglob("*")):
        if path.is_file():
            zf.write(path, f"{out.name}/{path.relative_to(out).as_posix()}")

with zipfile.ZipFile(archive) as zf:
    methods = {i.compress_type for i in zf.infolist()}
    print(f"wrote {archive} with {len(zf.infolist())} entries, methods {methods}")
    print("names:", sorted(i.filename for i in zf.infolist())[:6], "...")
