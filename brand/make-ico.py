import io
import os
import struct

root = os.path.dirname(os.path.abspath(__file__))
sizes = [16, 20, 24, 32, 48, 64, 128, 256]

blobs = []
for s in sizes:
    with open(os.path.join(root, "png", f"{s}.png"), "rb") as f:
        blobs.append((s, f.read()))

out = io.BytesIO()
out.write(struct.pack("<HHH", 0, 1, len(blobs)))
offset = 6 + 16 * len(blobs)
for s, data in blobs:
    dim = 0 if s == 256 else s
    out.write(struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset))
    offset += len(data)
for _, data in blobs:
    out.write(data)

with open(os.path.join(root, "icon.ico"), "wb") as f:
    f.write(out.getvalue())

print("icon.ico", len(out.getvalue()), "bytes,", len(blobs), "sizes")
