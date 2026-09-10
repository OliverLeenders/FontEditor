"""Pack the rendered PNGs into one multi-size .ico.

Windows picks the entry nearest the size it wants, so the order of entries is
meant to be irrelevant. It is not irrelevant here.

Tauri builds the *window* icon — the one the taskbar button and the title bar
show while the application is running — by reading this file and taking
`entries()[0]`, decoding that single image and handing it to Windows to scale
for every purpose (`tauri-codegen/src/image.rs`, `CachedIcon::new_ico`). So
whichever entry is written first is the whole window icon, and with the sizes in
their natural order that was the 16, stretched up to fill a 24 pixel taskbar
button.

FIRST is what that entry should be: large enough that every size Windows derives
from it is a reduction rather than an enlargement, and divisible by the sizes it
will be reduced to — 96 goes into 16, 24, 32 and 48 a whole number of times, so
each of those lands on an integer ratio instead of a resample between grids.

The rest follow in their natural order, which is what every other consumer of
the file reads.
"""

import io
import os
import struct

root = os.path.dirname(os.path.abspath(__file__))

FIRST = 96
SIZES = [16, 20, 24, 28, 30, 32, 36, 40, 44, 48, 56, 60, 64, 72, 80, 96, 128, 256]

order = [FIRST] + [s for s in SIZES if s != FIRST]

blobs = []
for s in order:
    with open(os.path.join(root, "png", f"{s}.png"), "rb") as f:
        blobs.append((s, f.read()))

out = io.BytesIO()
out.write(struct.pack("<HHH", 0, 1, len(blobs)))
offset = 6 + 16 * len(blobs)
for s, data in blobs:
    # A dimension of 0 means 256; every other size is written as itself.
    dim = 0 if s == 256 else s
    out.write(struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset))
    offset += len(data)
for _, data in blobs:
    out.write(data)

with open(os.path.join(root, "icon.ico"), "wb") as f:
    f.write(out.getvalue())

print(f"icon.ico {len(out.getvalue()):,} bytes, {len(blobs)} sizes, first entry {order[0]}px")
