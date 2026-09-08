# Checking the UFO against fontTools

A UFO that only this repository has ever read proves consistency, not correctness: a
misreading of the format shared by our writer and our reader passes every test in the
suite. This check hands the same font to somebody else.

That somebody is [fontTools](https://github.com/fonttools/fonttools) — `ufoLib` for the
format and `feaLib` for the feature file. It is the reference implementation: Glyphs,
RoboFont, fontmake and every build pipeline in the type world go through it or through
something built on it. Python is the only language it exists in, which is the whole
reason there is a directory of Python in a TypeScript repository.

## What it does

1. `proof-ufo.test.ts` in `packages/font-io` writes the proof font — one font holding
   everything the writer has a branch for: curves and straight lines, an open contour, a
   half-handled segment, a composite with an offset component, `A` and `a` (whose files
   collide on a filesystem that does not care about case), a name that has to be escaped,
   a glyph with no outline, fractional coordinates, groups on both sides, a class pair, a
   glyph against a class, an exception, a feature file, the identity keys that make a file
   a released font, and — the point of the round trip below — real `fontinfo`, `lib` and
   glyph-level keys this editor does not model and carries anyway.
2. `check_ufo.py` reads it with validation turned on everywhere it can be, cross-checks
   that kerning and groups refer to glyphs that exist, and compiles `features.fea` with
   `feaLib`.
3. `check_family.py` does the same for a family: `designspaceLib` reads the
   designspace this editor writes, every source has to resolve to a UFO beside
   it, every location has to name an axis by the name the file declares, and
   each UFO has to say on its own which style it is — a UFO is opened without
   its designspace all the time.
4. `rewrite_ufo.py` has fontTools write the whole font back out in its own hand and zip
   it — deflated, which our own exports never are.
5. `proof-ufo.test.ts` reads that archive back and asserts the font is unchanged: the
   metrics, the glyph order, every advance and contour, the components, the groups, what
   each kern pair actually does, and the features.

Step 4 is the one that matters most. It is the only test in the repository whose input
was written by something other than us.

## Running it

Needs Node with pnpm, and Python 3.11+.

```bash
python -m venv .venv
.venv/bin/pip install -r tools/ufo-check/requirements.txt
```

On Windows the virtualenv puts its binaries in `.venv/Scripts` rather than `.venv/bin`;
under MSYS2's Python they land in `.venv/bin` anyway.

```bash
OUT=$(mktemp -d)
UFO_OUT="$OUT" pnpm --filter @fonteditor/font-io exec vitest run proof-ufo
.venv/bin/python tools/ufo-check/check_ufo.py "$OUT/TunniProof-SemiboldItalic.ufo"
.venv/bin/python tools/ufo-check/rewrite_ufo.py "$OUT/TunniProof-SemiboldItalic.ufo" "$OUT/FromFontTools.ufo" "$OUT/FromFontTools.ufo.zip"
FOREIGN_UFO="$OUT/FromFontTools.ufo.zip" pnpm --filter @fonteditor/font-io exec vitest run proof-ufo
```

Without those two environment variables the same test file still runs in the ordinary
suite; it just checks the proof font exports the files this check expects to find, and
skips the two halves that need somewhere to put a font.

`check_ufo.py` exits non-zero and lists what it found. CI runs all four steps on every
push, in the `UFO against fontTools` job.
