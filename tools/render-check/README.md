# Rendering the exported fonts with FreeType

The siblings of this check, [`../ufo-check`](../ufo-check/README.md) and
[`../otf-check`](../otf-check/README.md), read the fonts as data: fontTools decompiles the
tables and draws the curves back. A font can pass all of that and still come out of a
rasteriser wrong. An overlap left in a CFF outline fills with a notch where two strokes
cross, a counter drawn the same way round as its bowl fills solid, and a hairline can drop
out of a small size — and none of those is a malformed table.

So [FreeType](https://freetype.org), the rasteriser behind Android, ChromeOS, most Linux
desktops and a good share of browsers, draws every glyph of both flavours of a proof font,
unhinted and antialiased, at 16, 48 and 256 pixels. The same glyphs are filled from the
drawing the fonts were compiled from, and the two are compared pixel by pixel. The check
fails where a glyph's differing ink is more than a set share of its ink at that size, or
where a drawn glyph renders nothing.

The drawing is filled by the rule the editor draws by, written again in the check rather
than taken from the compiler: a contour lying wholly inside an odd number of others is a
counter, and takes ink away; every other contour adds it. Overlapping strokes join, and a
counter is a hole whichever way round it was drawn — which is what the compiled font has
to look like.

```bash
pip install -r requirements.txt
RENDER_OUT=/tmp/render pnpm --filter @typewright/font-io exec vitest run proof-render
python check_render.py /tmp/render
```

The font comes from `packages/font-io/test/proof-render.test.ts`, and each of its glyphs is
there to break one thing: an `H` whose crossbar overlaps both stems, an `x` whose strokes
cross, an `o` whose counter runs the same way as its bowl, an `l` eight units wide, and an
`oacute` built from components.
