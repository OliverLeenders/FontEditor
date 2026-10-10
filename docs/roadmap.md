# Roadmap

How Typewright got to where it is, phase by phase, and what comes next. The
[README](../README.md) says what it is and how to run it.

## Status

**A font drawn here can be kept on disk, exported, installed and shipped.** Five
workspaces — Font, Glyph, Spacing, Features, Proof — around a canvas with select, pen,
knife, rectangle, ellipse, measure and section tools, snapping, boolean union, anchors and
components, kerning, curvature combs and harmonising. The Spacing line and the Proof are set
by HarfBuzz. Most of the `.fea` language compiles, checked against fontTools, and is written
in a source editor with colour and indentation beside a Marks file that edits the anchors.
Out come OTF, TTF — hinted, in the desktop application — WOFF, WOFF2, variable fonts and
UFO, and UFO comes back in. A family is several masters, a `.designspace` and one
`.ufo` each; a UFO folder on disk is opened and saved back to; everything autosaves to the
browser's own store besides, and copies of the whole font are kept as you work. Guides and a
picture to trace from sit behind the drawing; before it goes out, twenty-two checks say what
is wrong with it. Several fonts are kept at once, each in a working copy of its own; the
window splits into two panes — the drawing may fill both, each canvas showing what it is
asked to — and a second font opens in a window of its own. The grid lists what the font has
not got as well as what it has, and a glyph is made from the hole where it belongs. A line
can be set with any of the font's own features switched on, so a stylistic set is judged
where it is drawn. A Macintosh bitmap font in a StuffIt archive opens as outlines. The
desktop application installs from a release, updates itself, and says which version it is,
and the browser build is served at [typewright.io](https://typewright.io) from every release.
Every command and every glyph is a Ctrl-K away, by name, character, code point or what the
standard calls it, and the undo history can be walked to any step in one press. A font
carries the grid it is drawn on and may be fixed-width; an icon set comes in as SVG files,
strokes still strokes, and goes out as a font that spells each icon's name, with the
stylesheet and the page a web site needs beside it.

| Phase |                                     | Status                                                                                      |
| ----- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| 0     | Foundations and the geometry kernel | done                                                                                        |
| 1     | The editing surface                 | done                                                                                        |
| 2     | Undo, redo, persistence             | done                                                                                        |
| 3     | From paths to a glyph               | done, and anchors with it                                                                   |
| 4     | From a glyph to a font              | done                                                                                        |
| 5     | Binary import and export            | done: OTF and UFO both ways, and a UFO folder on disk both ways                             |
| 6     | Proofing and shaping                | done, and set by HarfBuzz since phase 17                                                    |
| 7     | Spacing and kerning                 | done                                                                                        |
| 8     | OpenType features                   | most of `.fea` compiles to GSUB and GPOS, and anchors to marks                              |
| 9     | Variable fonts                      | done: CFF2 with blended charstrings, fvar, STAT and HVAR, checked against fontTools         |
| 10    | Production polish                   | lint, format and about 3,900 tests, run on CI; preferences persist                          |
| 11    | The drawing hand                    | done                                                                                        |
| 12    | Not losing what was opened          | done                                                                                        |
| 13    | The family, named                   | done                                                                                        |
| 14    | What ships to a browser             | done                                                                                        |
| 15    | Several fonts, and a name           | done                                                                                        |
| 16    | The details a font is judged on     | done                                                                                        |
| 17    | Proving it where it will be used    | done: HarfBuzz sets the proof, FreeType draws the fonts in CI, ttfautohint hints            |
| 18    | Keeping it maintainable             | done; TypeScript is at 6, and 7 waits for the linter to read it                             |
| 19    | Releases                            | done: versions, a release workflow and updates; the installers are unsigned                 |
| 20    | A split window                      | done                                                                                        |
| 21    | Two fonts side by side              | done: a window per font                                                                     |
| 22    | More of the feature file            | done: most of the language, a Marks file from the anchors, both matched by fontTools        |
| 23    | Right-to-left text                  | done: bidi runs, and direction, script and language chosen in each bar                      |
| 24    | The web build, hosted               | done: typewright.io, published to Cloudflare Pages from every release                       |
| 25    | The feature source, further         | done: completion, find and replace, and a name that opens its glyph                         |
| 26    | The last interface tests            | done: every panel and control is rendered by a test                                         |
| 27    | A designspace that survives         | done: maps and avar, sparse masters, rules compiled and edited, the rest carried            |
| 28    | Binary import keeps its layout      | done: GSUB and GPOS as source, marks as anchors, kerning into the model, fontTools-checked  |
| 29    | Layers to draw on                   | done: layers in the document, any drawn in, shown behind, copied and swapped per glyph      |
| 30    | Making masters compatible           | done: start points, contour order, point numbers, and the family between its masters        |
| 31    | A proof for judging features        | done: a feature switched on in the bar, and a waterfall of blocks with a feature set each   |
| 32    | More outline operations             | done: subtract, intersect, exclude, offset and simplify, beside the union and the extremes  |
| 33    | One answer to what a glyph is       | done: the union, the ruler, the gap measure and the knife see components                    |
| 34    | Drawing with a pen                  | done: a broad edge exactly, an oval to within a fiftieth of a unit, on any contour          |
| 35    | A node that holds its curvature     | done: harmonising that stays, and continuous corners drawn round without extra points       |
| 36    | Named alternates                    | done: set and variant names from the feature file, and aalt as written or gathered          |
| —     | Old Macintosh fonts                 | done, unplanned: StuffIt archives, resource forks, bitmap suitcases into outlines           |
| —     | Finding one's way                   | done, unplanned: a command palette, the undo history, search by name, groups by side        |
| —     | One look                            | done, unplanned: sunk canvases, one type scale, one button, one set of icon sizes           |
| —     | Strokes held against the pen        | done, unplanned: folds swept, a turning nib, crossing strokes filled, pictures to check by  |
| 37    | Icon fonts and fixed-width fonts    | done: a grid of the font's own, one width, SVG in, names as ligatures, an icon kit out      |
| 38    | An icon at the size it is used at   | done: the glyph in pixels, checks for the grid, keylines, lining up, a set brought in again |

### What the table missed

Ten phases were enough to get a font out of the door and not enough to describe the
work. These are the things that turned out to be missing from the plan rather than
from the code — some now done, the rest in roughly the order they would be reached
for.

| What is missing                            | State | Why it is missing                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anchors and mark attachment**            | done  | Not a phase at all, and it belongs to two: a glyph carries them, and they compile. Placing accents by hand is the thing this replaces.                                                                                                                                                                                                                                                                                                                                          |
| **Not dropping what we do not understand** | done  | The reader keeps what it cannot model — every `fontinfo` key the model has no field for, every `lib` entry but the glyph order, and per glyph its guidelines, note, image and `lib` — and the writer puts them back. Autosave and the snapshots carry them too, so a reload does not undo it. Proved through fontTools in CI: it rewrites the proof font, we read what it wrote, and the keys neither of us models are still there.                                             |
| **Font metadata**                          | done  | Two dozen fields: version, copyright, trademark, designer, manufacturer, licence, description, italic angle, weight and width classes, a vendor id, and both naming schemes — the four-slot one an operating system groups by, and the typographic one for families of more than four styles.                                                                                                                                                                                   |
| **Curve quality**                          | done  | The curvature comb reads a join, the inspector gives the radius either side of a node and how far apart they are, and harmonising moves the node to where they agree.                                                                                                                                                                                                                                                                                                           |
| **Guides, and something to trace**         | done  | Guides are a point and an angle in two scopes, dragged on the canvas and snapped to where they are level or upright. Tracing follows UFO: the picture belongs to the font and the placement to the glyph, so one scan of an alphabet is one file and each letter is picked off it with a box drawn in the sheet view.                                                                                                                                                           |
| **Masters**                                | done  | Axes, masters along them, moving between them, an instance at any location, the compatibility check, a `.designspace` with one `.ufo` per master, and one variable font out of the lot — CFF2 with the deltas beside the values, worked out by the model the format itself uses.                                                                                                                                                                                                |
| **A file on disk**                         | done  | A UFO folder is opened, saved back to, and remembered for next time, through the File System Access API. Saving is manual: the working store autosaves, and a folder the user chose is somewhere the editor is a guest. Only the files that differ from what the last save left are written, and the status bar counts them as they go. The folder is picked up again on the way in, so Ctrl-S after a restart writes where it wrote last time rather than asking for a folder. |
| **`glyf` outlines**                        | done  | The TrueType flavour: cubics converted to quadratics on the way into the file, `glyf` and `loca` in place of `CFF `, and the four bytes that say which flavour it is. Checked against fontTools by drawing both flavours of the same font and comparing the outlines as shapes.                                                                                                                                                                                                 |
| **Preflight**                              | done  | Nineteen checks over the whole font — a contour left open, two points in the same place, a name a font cannot carry, two glyphs claiming one character, a component with nothing to place or that places itself, kerning about a glyph that has gone, a mark with nowhere to land — reported and never repaired, because every fix is a decision.                                                                                                                               |
| **Testing the interface**                  | done  | The panels are rendered against a real store in jsdom, and asked what a person would ask: did pressing this change the font. It found two shipped bugs on the way in — an inspector that re-rendered for ever, and an Escape that committed the value it was meant to abandon.                                                                                                                                                                                                  |

### What the table is hiding

The gaps worth naming, in the order they would bite someone using this:

- **Saving to a folder writes what was opened, including the parts this editor cannot
  read.** The model holds two dozen `fontinfo` keys and, per glyph, outlines, components,
  anchors and unicodes. A real source carries more than that — the other sixty `fontinfo`
  keys, a font `lib` and a glyph `lib`, guidelines, notes, images — and all of it is kept
  as it was found and written back where it was, unread. The model does not interpret any
  of it, which is the point: it is somebody's data passing through. Deleting is careful
  for the same reason — only `.glif` files the previous save listed are removed, and files
  this editor never wrote are left alone. Layers other than the default one were carried
  the same way until phase 29, and are now read into the glyphs that draw in them and
  written back from there — see that phase. The one thing left to know is that a source
  whose default layer is not in `glyphs/` has its glyphs moved there, and the old
  directory is reported rather than deleted.

- **Kerning and mark attachment are not written in `.fea`.** The single adjustment and
  positioning in a context compile into the same GPOS the kerning is written to. A pair
  adjustment is refused by name and pointed at the Spacing workspace, which is where this
  editor keeps kerning, and attachment at the glyphs' anchors — two ways to write the same
  rule would be two answers with no way to say which won. Both are kept in the file.
- **Shaping is HarfBuzz.** Since phase 17 the Spacing line and the Proof are set by the
  shaper browsers use, from a font compiled for it after each edit — substitutions, kerning
  and mark attachment as the exported font will set them. The glyph strip under the canvas
  is still deliberately left unshaped, since it is there to show the letter you are drawing
  beside its neighbours. The Spacing line and the Proof are ordered by the Unicode
  bidirectional algorithm since phase 23, and each has its own direction, script and
  language.
- **Overlaps are removed where the font is compiled, and the drawing keeps them.** CFF —
  the outline format an OTF written here carries — does not allow overlapping contours:
  its CharStrings are filled by the even-odd rule, under which two shapes subtract where
  they cross. Most rasterisers are lenient and fill by winding anyway, which is why a font
  with overlaps looks perfect in a browser and comes out of a Windows preview with a notch
  where a stem crosses a shoulder. So the exporter takes the union, and the drawing is left
  as drawn. Where the boolean refuses — a boundary that will not close — the overlap goes
  into the font and the glyph is named in the export warnings. The UFO is written as drawn, overlaps and all: it is source, and the
  tools that read it remove overlaps themselves.

- **Anchors do both jobs: placing components, and mark attachment.** A letter carries
  `top`, an accent carries `_top`, and a component placed in a glyph lands where the pair
  says it belongs — which is what makes every accent follow the letter when its anchor
  moves. The same anchors compile into GPOS: mark-to-base for an accent on a letter,
  mark-to-mark where an accent offers a `top` of its own for a second one to stack on,
  and the `GDEF` glyph classes without which a shaper does not know which glyphs are
  marks. So `a` + U+0301 typed as two characters is positioned by the font, with no
  composite glyph involved. The UFO carries the anchors both ways, format 1 and 2. A
  mark glyph with two attaching anchors is in two classes, each written in a lookup of
  its own, since the format gives a mark one class to a lookup.

- **Contour directions are corrected where the font is compiled, not in the drawing.**
  A rasteriser fills one path by the non-zero winding rule, so two contours that overlap
  must run the same way round or the overlap is subtracted — a stem crossing a shoulder
  comes out with a notch in it — and a counter must run the opposite way to what holds it
  or it is not a hole. Which way a contour runs is an accident of the order its points
  were placed, so the exporter puts it right and the canvas fills the corrected contours,
  which is why what you see is what the file draws. The UFO is written as drawn: it is
  the source, and another tool may have its own view.

- **Overlap removal handles what a designer actually draws.** Shapes that cross, shapes
  that share an edge, a curve springing from a straight edge along it, and a contour that
  crosses itself, including a single curve that loops. The three hard cases are the ones
  that produce no clean crossing to split at: a shared edge is cut where the sharing
  begins and ends, a tangency's smear of near-identical hits is gathered into the points
  where the two really meet and part, and the boundary is then walked by _angle_ rather
  than by which piece starts nearest, which is the only thing that can answer a point
  where four pieces meet. Refusal is still the last resort when a boundary will not
  close; a real 822-glyph font now goes through without one.
- **Both files are checked against fontTools on every push.** A proof UFO covering
  curves, components, composites, case-colliding names, groups, class kerning and
  features is exported, read by `fontTools.ufoLib` with validation on, compiled by
  `feaLib`, written back out by fontTools and imported again — see `tools/ufo-check`. A
  proof OTF covering mark attachment is exported and its GPOS decompiled by fontTools,
  which is then asked for the anchors back by name — see `tools/otf-check`, and the
  reason it exists: that table is offsets into offsets, and a test written here would be
  checking our arithmetic against our own arithmetic. FreeType has drawn both flavours in
  CI since phase 17. What is still unproven is the UFO against the editors people actually use, which agree
  with fontTools about the format and not always about what a font should contain.

### What is still missing

The ten phases are done and the list above is ticked, so the roadmap stopped pointing
anywhere. These are the holes found by reading the code back afterwards, grouped into
the order they would be reached for. Small first, because they are the ones felt every
day; the largest last, because it is the one nothing else waits on.

#### Phase 11 — The drawing hand — done

Four small things the editor made harder than they needed to be.

- **Remove overlap from a selection.** The working set is a parameter now: nothing
  selected still unions the whole glyph, and a selection unions the contours it touches
  and leaves the rest exactly as drawn and exactly where they were. A stem drawn as two
  strokes can be merged while the counter beside it stays a separate shape.
- **A component can be turned over.** The row has a flip each way, mirroring the
  component about the middle of what it _draws_ rather than about the base glyph's
  origin, so a `b` built from a `d` stays where it was put. Scaling a component by a
  typed number is deliberately still absent — a designer drawing by eye does not have
  that number.
- **The ruler reads the gap between two letters.** Ink to ink at the height being
  pointed at, which is what the eye judges and what changes as you move up and down a
  round letter — not the sidebearings, which say one number for the whole letter and say
  it about the advance box. On an outline it still reads the stem; the two never both
  answer.
- **`?` shows every key.** One sheet, grouped by where the keys work, reachable from the
  status bar as well. Writing it down found that `PageUp` and `PageDown` were documented
  here and handled nowhere, so they exist now too.

#### Phase 12 — Not losing what was opened — done

The one bug-shaped item on this list. Saving to a folder wrote a `layercontents.plist`
naming a single layer, so a source with a sketch or a background layer kept its files on
disk and lost the listing that pointed at them — which is what every tool that opens the
font afterwards reads as their having been deleted, and what a `.ufoz` export made true.

They are carried through unread now, the way the unmodelled `fontinfo` keys and the whole
of a `lib` already were: read with everything in the directory, kept beside the document
rather than in it — a second set of glyphs is the size of the first — and written back
where they were found. Kept in the session _and_ in the working store, because the store
may be unavailable and because the save that would drop them is the one after a reload.

#### Phase 13 — The family, named — done

A designspace is masters _and_ the instances drawn between them, and only the first half
was here. An instance is a different thing from a master and the model says so: a master
is a drawing somebody made and no two can share a place; an instance is a name and a
place, what it looks like is worked out, and two of them in one place is ordinary — a
family that sells its Condensed separately names one drawing twice, once under each
family name. So instances refuse a repeated name where masters refuse a repeated
location.

They are written into the `.designspace`, read back out of one, kept beside the axes in
the working store, offered as the `fvar` names a style menu shows — which used to be the
masters, so a two-axis family offered its four corners — and written out as ordinary
static fonts, one per style, in a zip. Each carries its own names: six files that all
call themselves Regular install as one font that keeps replacing itself. Where a family
has named no styles the masters still stand in for the menu, because a menu of corners
beats no menu.

The list is a second section in the Masters panel, because it is the same designspace —
and because the control just above it, which shows a place between the drawings, is
exactly how somebody decides a place is worth naming.

**Metric keys** landed with it. A glyph can say its left sidebearing is `n`'s, its right
is `o`'s, or its whole advance is the zero's, and the number is worked out from whatever
that glyph is now — which is what spacing a family by hand costs otherwise: doing it
again after every change. Chains work, because families are built in chains: `ü` from `u`
from `n`. Neither UFO nor OpenType has a field for this, so the two halves differ. The
source keeps the rule, in the font's `lib` under this editor's own name, which is what a
`lib` is for; the compiled font keeps only the answer, because a font file records an
advance and an outline position and that is all a rasteriser ever sees. A rule that
cannot be followed — a rename, a deletion, a loop — leaves the glyph exactly as drawn and
is reported twice over: in the export warnings, and as a preflight check. Silence would
be the worst of the three, since the glyph still has spacing and nothing looks wrong.

#### Phase 14 — What ships to a browser — done

**WOFF and WOFF2 are done.** Neither is another drawing of the font: they are the same
tables behind a header saying how big each was before it was squeezed, and a browser
unwraps one back into exactly the file it was made from. Both are written from the
TrueType flavour, because the transform in WOFF2 is what makes it worth having and a CFF
font goes through it unchanged.

WOFF1 needed nothing installed — deflate is the browser's own `CompressionStream`, and
the wrapping is a page of code. WOFF2 is somebody else's compiled C++: Brotli is in no
browser's compression API, and the transform that takes `glyf` and `loca` apart into
parallel streams is a specification in its own right, so this calls a wasm build of
Google's `woff2` — the same code `woff2_compress` and fontTools use. Writing a second
implementation of a format would mean having to prove ourselves right about it. The wasm
is a megabyte and is fetched when somebody presses WOFF2, never at startup.

**A variable font with `glyf` and `gvar` is done too**, which is the flavour the web
actually serves — the one WOFF2 can take apart and compress. The table was not the hard
part. Every master has to convert to the _same_ points before a delta can be taken between
them, and three separate things decide how many points there are, each of which can answer
differently for a Light than for a Black: how many quadratics a cubic becomes, whether a
segment is drawn straight, and whether an on-curve point lands exactly on a midpoint and
can be left out. All three are settled across the masters at once, and the same conversion
feeds `glyf`, so the two tables cannot disagree about what points the font has.

The four phantom points are how this flavour varies its spacing, and writing them as
zeroes gives a font whose letters change shape and keep the spacing of the master they
were compiled at — the same bug `HVAR` exists to fix, arrived at from the other direction.
Both are written, and they agree.

fontTools pins the font at each master and compares what comes out with that master
compiled on its own — as shapes, since quadratic outlines have no points in common with
the cubic drawing. A three-master family is checked as well as a two-master one, because
only three masters on an axis produce an intermediate region: a tuple that has to write
its start and end out rather than let them be implied.

#### Phase 15 — Several fonts, and a name — done

**The editor is called Typewright now**, and has a mark to go with it: a piece of foundry
type seen in the round, its nicks down the front and the letter standing on the inked face.
It is drawn in `brand/`, and every icon size the desktop build needs is drawn from it by a
script rather than shrunk from one large picture — at the size a taskbar shows it, that is
the difference between a letter and a smudge. Three separate things kept a blurred icon on
screen before it was right, and only one of them was the drawing: a build that linked a
stale resource, and a window icon taken from whichever size the `.ico` happened to list
first.

**A font is a project, and there can be several.** There used to be one working copy, one
write lock and one remembered folder, and opening a second font wrote over the first. Each
font now has its own of all three, named by an id, so two windows on two different fonts
both write, and opening a folder moves to that font's working copy before anything is
written to it. The program opens on the list of fonts, with the last one first so that
Enter picks up where you left off; somebody who works on one font can say they would rather
go straight in. Forgetting a font takes it off the list and deletes Typewright's copy — never
the folder on disk — and asks first, in words that say whether that copy is the only one. A
copy another window has open is left for that window and swept up on a later start.

**A save is remembered across a restart.** The project keeps the checksum of every file the
last save wrote, so the first save of a session writes only what changed, and a fingerprint
of them all, so that on the way in the editor can say whether the font it recovered is the
one on disk. It finds out by writing the font out in memory and comparing: across a restart
there is no saved document left to compare with.

**Closing asks about the folder, not about the work.** The working copy already holds every
change, so nothing is about to be lost; what can be behind is the UFO folder other tools
read, and that is all either warning is about. The browser asks through `beforeunload`, in
its own words. The desktop window holds its close request and hands it to the page, which
asks with the three answers a browser cannot offer — save and close, close without saving,
cancel — and a second press of the close button still closes a window whose page cannot
answer.

**A lighter start.** The editor loaded 832 KB of JavaScript before a glyph was drawn, and
the largest part of it was not React but opentype.js — measured by attributing every byte
of a sourcemapped build back to its source, rather than guessed at. Nothing at startup
needs a font parser: reading an OTF and writing one are both things somebody clicks. They
load then now, from an entry point of their own, and the startup bundle is 559 KB (171 KB
compressed, from 249).

### What is next

Found the same way phases 11 to 15 were: by reading the code back once the list above was
done — this time with the bundle measured, every component checked for a test that renders
it, and the exporter asked what it writes rather than what the model holds. In the order
they would be reached for.

#### Phase 16 — The details a font is judged on — done

Small things, each noticed by whoever uses the font rather than whoever draws it.

- **Vertical metrics that can be set — done.** Font Info has a Line spacing section with
  the three sets of ascender, descender and line gap — `OS/2` typographic, `OS/2` Windows
  and `hhea` — and the flag saying which to believe. Each is empty until set, and empty
  means what the exporter always derived, shown greyed in the box, so a font that sets
  none of them exports as it did.
- **Accented glyphs built from their parts — done.** The glyph browser builds the accented
  glyphs of the selected set as composites. The recipe is Unicode's decomposition read
  through the font's own characters, so no table is kept; marks are placed and stacked by
  their anchors, go on a dotless i or j, and take their width from their letter. Clean up
  re-attaches every composite after a letter's anchor has moved. Composites are drawn
  wherever a glyph is shown, and can be aligned to anchors from inside themselves.
- **Duplicate a glyph — done**, as `a.001`, `a.002` and on, straight after the original,
  unencoded, and into renaming; and **a colour mark on a glyph — done**:
  `public.markColor`, set from the browser's menu and shown along the foot of the cell,
  read out of a glyph's `lib` and written back into it without disturbing the rest.
- **The embedding flag — done.** `OS/2 fsType` is set in Font Info as a level —
  installable, editable, preview and print, restricted — with the no-subsetting and
  bitmaps-only flags beside it. A font exports as installable until somebody decides
  otherwise, as it always did.

The gaps phase 16 left, cleared before phase 17:

- **Spacing keys that say more than a name.** A key is still a glyph name, now with the
  grammar Glyphs uses: `o+10` adds units, `|b` takes the other side of `b` — a `d`'s left
  from a `b`'s right — and a bare `|` keeps a glyph symmetrical. The Spacing view's fields
  take a key as well as a number: `=o` sets one, a number typed over it replaces it, and
  the key shows beside the number as a chip that drops it and keeps the number it gave.
  The kern there is typed the same way.
- **Composites spaced like letters.** Their sidebearings are measured through their
  components, so the Spacing view and the inspector give an `ñ` the sides of the letter it
  draws, and setting one moves the components together.
- **Any glyph in a line of text.** `/a.001` and `/uni0301` put a glyph in the strip, the
  Spacing line or the Proof by name; the name ends at a space or the next slash, and `//`
  is a slash.
- **The glyph browser picks several cells.** Ctrl adds one, shift takes a run, Ctrl-A takes
  everything shown; colour marks, rounding and Delete act on all of them in one step.
- **A binary's line metrics and embedding flag are read** into Font Info's overrides,
  where they differ from what the exporter would derive.
- **Tests for the glyph browser, Clean up and New glyph.**
- **And what that turned up.** The TrueType flavour of a font with no `.notdef` of its own
  could not be opened again, because its outlines sat one place behind its character map.
  Anchors now move with the outline when a left sidebearing is set. An arrow on a side
  taken from a key is refused and says why, and an emptied kern field is left alone.
  Renaming a glyph rewrites the spacing keys that name it. Accented composites are named
  from their parts — `eacute`, `udieresisacute` — where the marks are named `…comb`, and a
  capital takes a mark's `.case` form where one is drawn.

#### Phase 17 — Proving it where it will be used — done

Both files are checked against fontTools on every push, and neither against the things
that will actually draw them.

- **Shaping with the engine browsers use — done.** The Proof and the Spacing line are set by
  HarfBuzz, the shaper nearly every browser and operating system uses, built to
  WebAssembly: substitutions, kerning and mark attachment as a font will set them, and the
  `GSUB` and `GPOS` written here tested against something other than the code that wrote
  them. It shapes a font compiled without outlines — the same layout tables, every glyph
  also reachable from a private code point so `/a.001` can be set — which takes about 30 ms
  for 500 glyphs and 130 ms for 2000, after each edit. It lives in `@typewright/shaping`
  and loads only when text is set; until then, or if it cannot load, the in-house shaper
  sets the line.
- **Right-to-left text, and a script and language for the Proof — later.** The line is still
  laid out left to right, with HarfBuzz guessing the script from the text. Mixed-direction
  paragraphs need the Unicode bidirectional algorithm, a dependency or a sizeable module of
  its own, and the controls are a design question; both are phase 23 now.
- **Rendering checked in CI — done.** FreeType draws both flavours of a proof font built to
  break things — overlapping strokes, a counter drawn the wrong way round, a hairline, a
  composite — unhinted at 16, 48 and 256 pixels, and CI fails where a glyph's pixels differ
  from the drawing by more than a set share of its ink, or where a drawn glyph renders
  nothing. The drawing is filled by the editor's rule written again in the check, so
  nothing the compiler did is taken on trust. See `tools/render-check`.
- **Hinting.** The TrueType flavour carries no hinting instructions. That is a defensible
  default — most text is drawn unhinted now — but Windows at small sizes is not most text.
  **The `gasp` table — done:** it says to smooth every size, and a `prep` program turns
  dropout control on, which is what Google Fonts adds to an unhinted font. **Autohinting —
  done, in the desktop application:** its Export menu has a hinted TrueType, made by running
  ttfautohint on the TrueType flavour. ttfautohint is a C program a browser cannot run, so it
  is bundled with the desktop build — fetched from the fontTools project's `ttfautohint-py`
  wheels, pinned by hash — and the browser's export stays unhinted. CI hints the render proof
  font with the same program and has FreeType draw the result.
- **The loose ends — done.** The shaping font keeps the part opentype.js writes and rebuilds
  only the advances and layout tables after an edit, so a nudge no longer recompiles the
  whole font. The Features switch is offered for a font with kerning or anchors and no
  feature file. The TrueType flavour writes its glyph names into `post`, which it had lost
  with the CFF table. And CI runs the render check on a font broken on purpose, which it has
  to fail.

#### Phase 18 — Keeping it maintainable — done

- **The interface's missing tests — done for the ones with decisions in them.** The Export
  menu, the kerning groups, the transform panel, the point and curve sections of the
  inspector, the Proof, and the list of fonts: 61 tests, asking what somebody using each
  would ask. They found two bugs. The inspector named its buttons wrongly — a row wrapped in
  a `<label>` gives its name to the first control inside it, so Corner was announced as
  "Type Corner Smooth Tangent" — and Escape in a kerning group's name closed the whole
  panel, because the panel's window listener ran before the field could keep the key.
  Eighteen components were still untested then, and eight are now; what is in them is mostly
  layout, and they are phase 26.
- **The store's large file — done, as far as it should go.** The snapshots, which carry
  state of their own, and the inspector's placement left `store/index.ts`, which is 917
  lines now. The settings and the view stay, and this list was wrong to name them: the
  settings' setters are one line each on purpose, with what they share already in
  `settings.ts`, and moving them would give each a second one-liner to call it; the view is
  forty lines. Neither would read better anywhere else.
- **Four major versions behind — three of them done.** React 19, Vite 8 and Vitest 5 are
  in, with fast-check 4 beside them, each checked the way CI checks before the next began.
  Vite and Vitest went in together because they cannot be separated — Vitest 5 will not
  run on Vite 5 — and nothing in any config had to change. The build takes about a second
  where it took seven; React 19's larger DOM package costs the startup bundle 50 KB, which
  leaves it at 600 KB. Each version is one that has been out for a while rather than the
  newest: the workspace refuses packages younger than a day, and pnpm's response to that
  was to write itself an exemption without asking, which is not kept.
- **TypeScript 6 — done; 7 waits on the linter.** The lint rules that read types come from
  typescript-eslint, whose latest release accepts TypeScript below 6.1, and most of the
  rules this repository holds itself to are that kind — so 7 would leave them unable to run.
  6.0.3 is inside that range and is in. Nothing had to change for it but one cast: the
  browser's directory handle was cast to the handful of methods the storage code uses,
  because TypeScript 5's DOM types had no way to list a directory. TypeScript 6's do, the
  handle fits the type as it is, and the linter noticed the cast had nothing left to do. 7
  is for when the linter can read it.

#### Phase 19 — Releases — done

What separates a program people install from a build somebody made.

- **A licence — done.** GPL-3.0-or-later, with the third-party notices shipped beside the
  editor; see [Licence](../README.md#licence).
- **A content security policy for the desktop window — done.** Scripts and styles come only
  from the application, WebAssembly may compile — HarfBuzz and WOFF2 are both WebAssembly —
  `eval` is refused, nothing is framed, and requests go only to the application and Tauri's
  own bridge. Tauri adds the hashes of the scripts it injects. `vite preview` sends the same
  policy, so the built editor can be tried under it in a browser whose devtools say what it
  refused. The web build has none until it has a host that can send headers.
- **One version number — done.** `apps/editor/package.json` holds it and `tauri.conf.json`
  reads it from there. Cargo needs its own copy in `Cargo.toml` and `Cargo.lock`, which
  `pnpm version:set` writes, and CI fails when the three disagree. A version is three
  numbers: a Windows Installer version cannot carry a pre-release name.
- **Releases — done.** A `v` tag builds the Windows installers
  (NSIS and MSI) and the Linux ones (AppImage and `.deb`) in CI, into a draft GitHub
  release with the licence, the notices and the updater's manifest. Nothing is public until
  somebody publishes the draft.
- **Updates — done.** The desktop application asks the
  latest published release whether there is a newer version when it starts, and says so
  along the top of the window. Nothing is downloaded until somebody presses Install; a
  folder that is behind is asked about first, as closing the window does; and an update
  that is not signed with the project's key is refused. 0.1.0, installed, updated itself
  to 0.1.1 this way.
- **A signed installer — not for now.** An unsigned installer meets a SmartScreen warning
  the first time it runs. Signing costs a certificate, and can be added to the release
  workflow whenever there is one.

#### Phase 20 — A split window — done

The glyph beside the line it sits in. The button at the end of the tab bar opens a second
pane with a bar of its own, and each pane shows any workspace; asking for one the other
pane has swaps the two, because the drawing — its toolbar, inspector and strip — exists
once. Both panes are on the same document, so an edit in one shows in the other as it is
made.

- **Side by side or stacked.** The second pane's bar stacks the panes or puts them back
  side by side, and closes the pane. The divider between them is dragged, moved a step
  with the arrow keys, or double-clicked back to the middle. The shape of the split is
  remembered; which workspaces were showing is not, so the window still opens on the font.
- **The keyboard follows the pane.** Pressing in a pane or tabbing into it makes it the
  active one, marked along the top of its bar. Undo, save and `?` work from either; the
  drawing's keys only from the drawing, and the status bar describes the active pane.
- **A glyph opens where the drawing is.** Chosen from the font's grid or the spacing line,
  it is drawn in the other pane when that pane is drawing, and the pane it was chosen from
  stays as it was.
- **The inspector keeps to its pane.** It docks to the edges of the drawing's pane rather
  than the window's, and a floating one scrolls within the drawing's height instead of
  hanging over the pane below. A pane too narrow for the tab labels shows their icons,
  which still name themselves on hover.

#### Phase 21 — Two fonts side by side — done

A window per font. Each window is the whole editor on one font — its own working copy,
write lock, undo and panes — so two fonts sit side by side the way any two windows do,
arranged by the operating system. File → New window opens one on the list of fonts, with
Ctrl-Shift-N in the desktop application (a browser keeps that key for itself), and each
other font in the list has a button that opens it in a window of its own. The same font in
two windows is read-only in the second, as it always was in two tabs.

- **What a window is for travels in its address.** `?font=<id>` or `?fonts`, read once on
  the way in and taken out again, so a reload starts as any start does. A browser opens the
  address in a tab; the desktop application opens it in a window of its own.
- **Each window names its font** in its title, so two can be told apart in the taskbar and
  two tabs in the tab strip.
- **Closing asks per window**, each about its own folder.
- **An update is offered once**, by the window the application started with, and asks for
  the other windows to be closed before it installs, because installing restarts the whole
  program.

A second font in the other pane of a split window is the other way there, and is left for
when windows have shown whether it is wanted.

#### After phase 21 — Writing feature source — done

The Features workspace was a plain text box. It is a source editor now, with nothing
installed for it: the file is coloured by a small tokenizer for the language, drawn under a
text box whose own letters are transparent. Tab indents with four spaces, Shift+Tab takes a
level off, and Escape then Tab leaves; Enter keeps the indentation, and a closing brace goes
back a level. Lines are numbered, lines with problems are marked and underlined, a problem in
the list goes to its line, each space shows as a dot, and Ctrl with the wheel sets the size.
Released as 0.1.3.

### What comes after

Found by reading this file back after phase 21, and from what using the editor turned up. In
the order they would be reached for.

#### Phase 22 — More of the feature file — done

The Features workspace compiled classes, single and ligature substitutions, both of those in
a context, and the single adjustment. Everything else was kept in the file and written to
the UFO, but refused by name and left out of the exported font — so a font could do less
than its source said. Now:

- **Alternates and one glyph into several.** `sub a from [a.alt1 a.alt2];` and
  `sub ffi by f f i;`, in a context too.
- **Lookups as feaLib groups them.** Rules become a new lookup where the kind of rule
  changes, at a `lookupflag`, a script or language, or a lookup reference, so a file applies
  in the order it is written. Named lookups are defined once and shared by every feature
  that references them, or called from a rule in a context — `sub c a' lookup SMALL;`.
- **Lookup flags.** `IgnoreMarks`, `IgnoreBaseGlyphs`, `IgnoreLigatures` and `RightToLeft`,
  by name or number; marks are the glyphs whose anchors say so, as in GDEF.
- **Scripts and languages.** `languagesystem` declares them, `script` and `language` inside a
  feature narrow it, and a language takes the script's default lookups unless it says
  `exclude_dflt`.
- **Positioning in a context**, a value or a named lookup on each marked glyph.
- **Proven twice.** Unit tests shape text with HarfBuzz and compare the glyphs and advances
  with what the file says. In CI a proof file using every construct is compiled here and by
  fontTools' feaLib, and HarfBuzz has to set every test string identically with both fonts.

- **A Marks file** beside the feature source, written from the current master's anchors as
  `markClass` and `pos base` / `pos mark` rules, one class per anchor name (`@MC_top`).
  Anchors stay the source of truth: an edit that reads cleanly moves, adds or removes
  anchors as an undoable step, and the file is written again from the anchors when you
  leave it or they change elsewhere. The same proof file in CI ends with it, so fontTools
  compiles mark attachment from the text while this editor compiles it from the anchors, and
  the accents have to land in the same place.

Reverse substitution, mark filtering sets and `table` blocks were refused by name here, and
were done afterwards — see the loose ends below.

#### Phase 23 — Right-to-left text, and a script and language for the Proof — done

The Spacing line and the Proof were laid out left to right, with HarfBuzz guessing the
script from the text. Now:

- **Mixed-direction text is ordered by the algorithm.** `bidi-js` (MIT, no dependencies of
  its own) resolves the embedding levels; the line is cut into runs where the level changes,
  each run is shaped with its own direction, and the runs are put in drawing order by rule
  L2. So an Arabic line with an English phrase in it comes back with the phrase in the
  middle, each part reading its own way. The glyphs still arrive at the view left to right,
  which is what every caller already expected, so `packages/view` needed nothing.
- **Direction, script and language are chosen in the bar**, in the Spacing line and the
  Proof each, and remembered. All three start at Auto, which is what a shaper does with text
  it is told nothing about.
- **The pickers are about the font in hand.** The scripts are the ones its characters belong
  to, plus any its feature file declares; the languages are the ones that file names in its
  `languagesystem` lines, which are exactly the ones its rules can differ for.
- **A right-to-left proof is set from the right margin**, so its ragged edge is on the left,
  where a line ends in that reading.

Mirroring — the brackets that face the other way — is HarfBuzz's own doing for a run it is
told runs right to left, and doing it here as well turned every bracket back as it went in.
That is a test now.

#### Phase 24 — The web build, hosted — done

The browser build is served at [typewright.io](https://typewright.io), published to
Cloudflare Pages by the Web workflow from every tagged release — the same bundle the desktop
installers embed. The host sends the content security policy as a header, from a `_headers`
file the build writes out of the one policy the desktop window uses, and a `_redirects` file
answers a deep link with the application rather than a 404. See docs/development.md, "The
browser build, hosted".

#### Phase 25 — The feature source, further — done

What a source editor is expected to do beyond colour and indentation, in both the Features
and the Marks file, still with nothing installed for it:

- **Completion as you type.** After two characters a list under the caret offers the font's
  glyph names and the language's keywords; after `@` the classes the file defines, after
  `lookup` its named lookups, after `feature` the registered feature tags. Ctrl+Space opens
  it at once, the arrows choose, Enter takes, Escape closes, and Tab still indents.
- **Find and replace.** Ctrl+F and Ctrl+H open a bar over the source, with the count, the
  next and previous match, match case and whole word, where a whole word is a whole name as
  the language splits them. The matches are marked in a third copy of the text under the
  colours, and each replacement is an undo step of its own.
- **A name opens its glyph.** Ctrl+click or F12 on a glyph name the font has opens it in the
  Glyph workspace — in the other pane when the window is split, so the file stays in sight
  — and the name is underlined while Ctrl is held over it.

#### Phase 26 — The last interface tests — done

Eight components were rendered by no test: the glyph strip, the mark swatch, the menu items,
the preferences panel, remove overlap, the sheet, the stepper and the toolbar. Mostly layout,
which is why they came last — but each one had something worth asking of it, and the asking
is what the tests are about rather than the markup:

- **The strip** shows what was typed, a gap and not a silent omission for a character the
  font has nothing for, and a glyph reached by name after a slash.
- **The stepper** steps once and at once on a press, repeats only when held, stops at a
  bound rather than against it, and is dead where there is nothing to step.
- **The toolbar** says which tool is in hand, what the next undo would take back, and how far
  the view is zoomed.
- **Remove overlap** says what it did — "nothing was overlapping" and a refusal both look
  exactly like a button that does nothing.
- **The preferences** change what the reader sees and leave the document untouched, which is
  checked by reference: the same document object before and after.
- **The menu rows** run the item and then close the menu, and a disabled one does neither.
- **The sheet** exists only where the glyph is traced from a picture, and says it is reading
  rather than showing an empty frame.
- **The mark swatch** gives the same colour the same component, so a menu does not remount
  its icons as it draws.

#### The loose ends — done

Not a phase: the things noticed while doing the others, gathered up once the phases were
finished.

- **The rest of the feature file.** Reverse substitution (`rsub a' b by a.fina;`, GSUB type
  8, the one rule read from the end of the line); the two lookup flags that name marks rather
  than switch something on — `MarkAttachmentType` and `UseMarkFilteringSet` — with the classes
  and sets they name written into GDEF; and `table GDEF { … }` for the glyph classes a font
  wants to state outright and for ligature carets. GDEF is written in one place now, from the
  anchors and from the file together. What is still refused is refused for a reason and says
  it: the tables this editor writes itself, attachment points, and carets tied to a contour
  point.
- **The build's chunks.** React in a chunk of its own, so it stays cached across releases; the
  editor's own startup chunk is a third smaller for it. The size warning now goes off above
  what HarfBuzz's own build weighs, rather than on every build.
- **The suite under load.** font-io's tests compile fonts and deflate WOFF2s — a second each
  on an idle machine, and longer on one that is also building the editor. They had vitest's
  five-second limit, and failed there rather than saying anything about the code.
- **The glyph strip** is laid right to left when the Spacing line is, so "the letters either
  side" means the same thing in both places. It is still unshaped and one cell per glyph,
  which is what makes it a way to move about.

### What comes next

Found by reading the code back once phases 22 to 26 and the loose ends were done. The first
two lose something without saying so, which is why they come first; the rest are the daily
work of drawing a family.

#### Phase 27 — A designspace that survives being opened — done

The designspace reader kept axes, sources and instances and dropped everything else, so a
real family opened and written back out lost part of itself:

- **Axis maps** (`<map>`), the curve between the value a user picks and the one the design
  is drawn at. The variable font has no `avar` either, so its axes move in a straight line
  where the designer said otherwise.
- **Rules** (`<rules>`), the glyph swaps at a location — the dollar sign that loses its
  stroke when it gets heavy.
- **Sparse masters** (`<source layer="…">`). The layer is ignored, so a master that only
  draws a few glyphs is read from the UFO's main layer, which is a different drawing.
- **Version 5 and the details of an instance**: discrete axes, PostScript and style-map
  names, and `lib`.

The rule the UFO reader already keeps is the one to keep here: what is not understood is
carried. Then the maps and rules are understood — `avar` written from the maps, and rules
compiled into the variable font where the format allows.

Now:

- **Axes keep their maps**, and the model keeps an axis where the drawings are, so a map
  changes what the font tells the world and nothing about how a letter is worked out.
  `fvar` is written on the user scale, `avar` from the map, and a map can be made and
  edited in a Designspace panel beside the font info — with a warning, rather than a
  quiet move, when a master ends up outside the range or no master is left at the default.
  Axes with stops are read; a variable font is the designspace at the default stop.
- **Sparse masters are masters.** A source that is a layer of another's UFO is read from
  that layer, draws only its glyphs, and is written back into the same file. Interpolation
  — the preview, static instances and both variable flavours — works a glyph out from the
  masters that draw it, which means a variable font varies each glyph over its own regions:
  CFF2 selects them with `vsindex`, `gvar` gives each tuple its own. The glyph grid of a
  sparse master is the whole font with what it does not draw shown faint, and opening one
  offers to draw it there, starting from the shape the rest of the family has at that place.
- **Rules are compiled and edited.** Each rule is a lookup of single substitutions, switched
  on by GSUB 1.1 feature variations in `rvrn` (or `rclt` when processed last), with a
  record for every overlap of two rules' regions ahead of the records it came from. Static
  instances trade the glyphs' drawings where a rule applies. Rules are added, given ranges
  and swaps (with the font's glyph names offered as they are typed) in the Designspace panel.
- **Everything else is carried**: the file's version, a `lib`, labels, variable-font
  definitions, an instance's PostScript and style-map names, a source's `<features copy>`
  — as the XML they were written as, back where they were. Each master's other UFO layers
  now go back into that master's file too, where a family used to drop them.

Found on the way, and fixed with it: a variable font's deltas were each master's plain
difference from the default, which counts a corner master's two edges twice — right at every
master, wrong between them. They are now worked out the way the preview is. A `gvar` region
that ends past its peak was written as if it ended there, and the CFF2 flavour had no glyph
names, CFF2 having nowhere to keep them; `post` carries them now.

Proved the way the rest is: HarfBuzz sets both flavours at places on the user scale and
finds the rules and the map honoured, and on CI fontTools reads the proof family and pins
both fonts at eight places between the masters, where its own `VariationModel`, given the
masters' points, has to agree with them — see `tools/otf-check/check_designspace_vf.py`.

#### Phase 28 — Importing an OTF or TTF keeps its layout — done

A binary font came in with its outlines and its kerning. Its GSUB, its mark positioning and
its GDEF were dropped, and the import warnings did not mention it. Now:

- **GSUB, GPOS and GDEF are read here**, by a reader of this package's own beside its
  writers: every lookup type of both tables, extensions unwrapped, contexts in all three
  formats with class 0 spelled out, value records and anchors in every format. A lookup that
  points past the end of its table costs that lookup and is named.
- **Kerning goes into the model.** Pair adjustments in `kern` or `dist` that move only the
  advance become the Spacing workspace's kerning — class pairs as groups, glyph pairs as
  exceptions.
- **Mark attachment goes onto the glyphs as anchors**, named by where the letters carry
  them — `top`, `bottom`, `center`, numbered where two classes would share one — and
  mark-to-mark classes keep the names their marks already have.
- **Everything else becomes feature source**, written to be read: glyph sets that recur are
  named classes (`@sc` where the names agree), every lookup a named block in the order the
  font applies them — lookups only a context calls go first, since a rule can only call one
  written above it — and features per script and language where they differ.
- **What this editor cannot compile is kept as source and named**: cursive attachment,
  marks on ligatures, pair adjustments that are not kerning. A saved UFO carries them; the
  import warnings say the exported font does not. Feature names and parameters, required
  features, device tables and feature variations are named as not imported.
- **A WOFF is unpacked first**, so its layout comes in too.

Found on the way, and fixed: kerning was exported as a lookup per subtable, so a pair with
an exception was kerned by the exception and by its class together. The two are now one
lookup, where the first subtable that has the pair wins.

Proved on CI with fonts this editor did not write: the proof feature file and a second file
of what the editor only keeps — class kerning with an exception, a non-kerning pair
adjustment, cursive attachment, marks on a ligature, an extension lookup, per-script
features and a named stylistic set — are compiled by fontTools, opened here as binaries,
exported again, and set by HarfBuzz against the fonts they were opened from.

#### Phase 29 — Layers to draw on — done

A UFO's other layers were read, carried and written back, but could not be seen or edited.
Now:

- **Layers are in the document.** Each glyph carries its drawing in every layer it draws in
  — outline, components, anchors, guides, picture, advance — so a layer is renamed, deleted,
  saved and undone with its glyph. The font keeps the list of layers, their directories,
  their `layerinfo.plist`, and the glyphs only a layer draws, carried as they were. A
  project saved the old way has its layers moved into the document the first time it opens.
- **Any layer can be drawn in.** The editor's state says which drawing the tools are pointed
  at, and every tool reads and writes the glyph through that one place — so drawing in the
  background is the same tools drawing somewhere else. B draws in the background, adding the
  layer the first time, and again draws in the letter.
- **Layers are shown behind.** Faint, under everything but the tracing: the letter whenever
  a layer is being drawn in, and every layer whose eye is open — the background's is, to
  start with.
- **Between a letter and its layers**: copy the drawing in, trade the two, clear the layer —
  for the open glyph from a Layers section in the inspector, and for every glyph picked in
  the grid from its menu. Layers are added and removed from the same section.
- Renaming a glyph now repoints components in layer drawings as well.

Found on the way, and fixed: the document was rebuilt in several places — a load across the
storage worker, a font replaced wholesale, a snapshot — and two of them left out the font's
own guides and what its file carried unread. A font opened and reloaded before anything was
edited came back without them, and the next save wrote the loss out.

Proved the way UFOs are: the proof UFO has a background and a sketch layer, fontTools reads
every layer with validation on, writes them all back, and they are read again here and
compared drawing by drawing.

#### After phase 29 — What the releases carried — done

Not a phase: what was found by using the editor between 0.1.13 and 0.1.18, written
down here because the commits were the only record of it.

- **Which glyph is which.** A cell had room for a name and a code point, which for a
  combining mark is `uni0308` above `U+0308` and answers nothing. The standard's own names
  are now in the editor — packed from the UCD, unpacked the first time a tip asks for one —
  and a tip beside a cell gives the character, its name, its block and whether it has been
  drawn. A glyph the font has not drawn shows the character faintly in one of the system's
  fonts rather than an empty box, so a screenful of cells after **Add missing** can be read.
- **The glyphs the font has not got.** A block listed what the font had in it, which is the
  wrong half of the question: the reason to open Latin Extended-A is to see what is missing.
  Those code points now have cells of their own — dashed, fainter, the code point and no name
  — and double-clicking one makes the glyph and opens it. The search offers a character the
  font has not got rather than answering with an empty grid.
- **The inspector says less.** A section with nothing in it folds itself and says what it is
  short of, rather than showing a column of dashes; the curve's two dimensions are one field
  each — tension is how much handle there is, pan is how it is split — where two λ fields made
  every change of tension a change of balance as well; and the pan has a number beside its
  slider, so a lean worth keeping can be written down and given to the next segment.
- **Where a preference lives.** The theme was in the drawing toolbar's popover, which is a
  pane's bar: reachable only with a glyph open, and offered twice in a split window. It is now
  in a strip along the top of the window, with the font's name, opened by Ctrl-comma. What is
  left in the pane's menu is what that canvas shows — and it is kept per pane, which is what
  makes two canvases of one glyph worth having. So the drawing is the one workspace a split
  window may show twice; the inspector and the strip stay single and follow the keyboard.
- **Three things about a curve.** Locking a tangent node's handle to an axis did nothing
  visible, because the pass every edit ends with swung it back onto the straight side; it now
  gives up the type, as freeing one side of a smooth node does. Deleting a point left the
  neighbours' handles as they were and dented the outline; what is left is now fitted to the
  pair of curves that were there. And the two places worth a point — where the outline turns
  back in x or y, and where it changes which way it bends — can be put in from the curve's
  menu or the Curve section, one segment or a whole selection at a time.
- **Spacing keys are followed as you work.** A key said a relationship and was resolved in
  two places only: the fields that show it, and the font as compiled. Editing `n` left `m`
  drawn and saved at its old spacing. Every committed step now settles the keys inside that
  same step, so one undo takes back the edit and everything that came of it, and a measurement
  a key speaks for is refused rather than sprung back.
- **Two things that were simply hard to read.** The feature source's colours were picked for
  one lightness, which forces unequal colour — the green tag ran six units of chroma from a
  grey of the same lightness and was not recognisable as green; each is now driven to the same
  share of its own hue's ceiling. And the sheet of keys was a poster nobody could read, since
  no column layout could balance around a canvas group three times the length of the rest; it
  is a rail of places now, one at a time, with a filter that narrows all of them at once.
- **The desktop icon** was drawn with the heavier cuts up to 48 pixels, which made the T and
  the stripe look thick beside `mark.svg` at the same size. Only 24 and below are cut deeper
  now; from 28 up the icon is the mark itself.

#### Phase 30 — Making masters compatible — done

The compatibility check said what disagreed between two masters and offered no way to put it
right — and two of the things it reports could not be changed at all. Now:

- **A contour begins where you say.** Interpolation pairs the first node of a contour with
  the first node of the same contour in the other master, so an `o` begun at the top in one
  and at the left in the other is compatible by every count and interpolates into a twist.
  **Start the contour here**, on the menu on a point, rotates the nodes until that one is
  first; it is offered only where it would move something, and an open contour, which begins
  where the drawing began, has no start to choose.
- **Contours can be reordered.** The order is nothing at all in one master and is what the
  contours are paired by in two, so a bowl drawn before its stem in one and after it in the
  other makes a mess of every weight between. **Bring forward** and **Send back** move one
  place at a time and say where the contour sits as they offer it.
- **Point numbers**, in the View menu and so kept per canvas: `2.3` is the third point of the
  second contour, and the first point of each contour is picked out in the accent, since that
  is where the pairing starts. Off by default — it is an instrument like the comb, and numbers
  over a drawing are the last thing wanted while drawing it.
- **The family between its masters**, in the Spacing line and the Proof: a **Between** switch
  and a slider per axis set the text with the font worked out at that place. It is the same
  location the canvas has drawn its ghost weight at since the designspace went in, so the
  three agree rather than offering three answers to one question. An instance is not a thing
  to edit, so the spacing line's nudges and fields go quiet and say why.
- **The compatibility report takes you to the trouble**: a line names a glyph and a contour,
  and opens the glyph with that contour selected, rather than describing where to look.

#### Old Macintosh fonts — done

Not planned: it came of being handed a `.sit` file. A bitmap font from that era lives
entirely in a resource fork, which no copy off a Macintosh keeps, so what survives is a
StuffIt archive with the whole file wrapped inside it — and opening the font means opening
the archive first.

`@typewright/stuffit` reads both, and knows nothing about fonts: a StuffIt 5 archive with
its two compressors — LZ77 with Huffman codes, and the block-sorting arithmetic coder
Aladdin called Arsenic — and the resource fork's own little database of numbered blobs.
`font-io` reads the `FOND` family and `NFNT` strike out of it and turns the strike into
outlines: a square per lit pixel, the widths from the font's own tables, the em from the
strike's ascent and descent, so a ten pixel font arrives on a 1000-unit em with every point
on a round number. The staircase is the design and is left exactly as it was drawn. A
suitcase holding a TrueType font instead is handed to the binary reader.

Fixtures are written rather than checked in — every archive in the wild was made by
software that no longer runs, and a real one would be somebody's font — so the builders in
`testing.ts` write the headers at the offsets the format specifies, and a test that passes
says the reader and the written-down layout agree.

#### After phase 30 — What the releases carried — done

Not a phase: what was found by using the editor between 0.1.19 and 0.1.29, in the order it
was found, because the commits were again the only record of it.

- **The bar of the Font workspace could not be read.** The search field and the new-glyph
  field looked alike, the sort was a word where everything else was a control, and three
  kinds of thing pointed down at you with two drawings of "there is more here". A search
  icon, a sort icon, one chevron everywhere, and the grid ordered by code point to begin
  with, which is the order somebody looking for a character expects.
- **Snapping that catches what you are aiming at.** Every point in the glyph is now
  something a drag can catch on, on both axes, ranked neighbour before extreme before
  point; the radius came down from six pixels to four, since the old one caught things
  nobody was aiming at. Lines at an angle came with it — the italic angle, and the
  direction a straight segment runs — so a right angle on a slanted design is a place a
  drag lands rather than arithmetic done by hand. Shift holds a drag to a direction: the
  axes, the italic angle, and for a point on a straight segment the line itself and the
  normal to it, which is how a whole side is moved without bending it.
- **Square to the curve, not to the chord across it.** The right angle a drag squares to is
  the one the outline actually leaves by, which on a curve is its handle rather than the
  straight line between its ends. A dragged _handle_ got lines of its own with it — square
  to the node's other side, along it, and the italic angle with its perpendicular.
- **A point halfway along a straight segment**, from the segment's own menu: the one place
  on a line worth a point that was arithmetic to find.
- **A bar laid across two strokes is not a counter.** Direction correction decided a
  contour was a hole by sampling its points, and a stem crossing an `S` has every corner in
  ink while its middle passes through the gap — so a dollar sign came out with notches
  taken from it, in the grid, in the proof and in an exported font. A contour counts as held
  now only when its samples are inside _and_ the two outlines never cross.
- **The knife cuts each shape rather than across them.** Crossings were paired along the
  stroke and across the whole glyph, which is right for a counter — a cut across an `o`
  closes from the outer contour to it — and wrong for a neighbour: two overlapping squares
  came back as two pinwheels. Pairing happens inside one shape now, `shapesOf` naming what
  a shape is, and the containment pass it shares with direction correction is done once.
- **A scale handle holds the far side of the selection still.** The box round a selection
  stands ten screen pixels outside what it holds, and the scale was measured against the box
  — so pulling one edge crept the other, by more the further out you zoomed. The margin is
  for the hand; the arithmetic belongs to the shape.
- **The curvature comb keeps to the letter it measures.** Hairs measured in screen pixels
  alone kept their size while the letter shrank, so zooming out grew the comb relative to the
  drawing until it was all anyone could see. Two limits now, the shorter winning, and the
  weight came down with it: an instrument laid over a drawing should be looked past as
  easily as looked at.
- **Every number in a panel can be cleared, and can take a minus.** The fields were the
  model's number in and `Number(text)` out on every keystroke, so clearing one read as zero
  and wrote it back, and a lone `-` was eaten by the re-render. They keep the text being
  typed now and commit only a text that is a number — and are text boxes, since a number
  input throws a half-typed minus away before any code can see it.
- **The canvas menu acts on what is selected.** Corner, smooth, tangent, harmonise, the
  axis lock, extracting handles and deleting: each acted on the one node under the pointer,
  which is the opposite of why somebody gathers a run of points. Each says how many it will
  touch, and one press is one undo.
- **Walking the contour from the keyboard.** Alt with the left and right arrows steps the
  selection one place along the contour it is on — a point to the next point, a focused
  segment to the next segment — for what the pointer is worst at: points a few units apart,
  a handle lying on its own point, a segment behind its Tunni controls.
- **The Curve section speaks for every curve selected**, not only the one clicked: a field
  shows the number where they all have it and stands empty where they differ, and typing
  gives them all that number in one step, each keeping its own lean.
- **How big the controls are drawn**, in the View menu beside the outline weight: small,
  normal and big, per canvas. What is drawn and what can be grabbed scale together, so a
  control never looks like a target it is not.
- **Which version this is**, in the preferences: the number the release was tagged with,
  written into the build from the same manifest, because a bug report begins with it.

#### Phase 31 — A proof for judging features — done

The Proof turned every feature on or off together and set text at one size. The first half
shipped in 0.1.24: each bar has a **Features** panel with a switch per feature the font
defines, each starting where a text renderer would leave it, so a stylistic set can be seen
substituted without exporting the font — see below.

The second half is the waterfall. The Proof is set as blocks rather than at one size: each
block has its own size and its own feature set, and carries a rule above it giving the size
and naming whatever it has switched by hand. Choosing **Waterfall** fills in the ladder a
specimen sheet has been set at for a century — every size through the reading range, then
jumps — and the rows are edited, added to and taken from after that, because the point of a
ladder is to be argued with.

A ladder and a comparison are the same arrangement seen twice, which is why there is one
mechanism and not two: down a ladder is where the text stops reading, and two blocks at one
size with one feature between them is a stylistic set judged against what it stands in for,
on one page, without exporting anything. The blocks are remembered per browser with the other
settings, so a page somebody set up is still there after a reload.

#### Phase 32 — More outline operations — done

Union was the only boolean. Subtract, intersect and exclude are now beside it in the toolbar,
and they are the union's own machinery with one thing changed: which region the boundary
belongs to. Every contour is cut at its crossings either way, and a piece is kept when the
region is on one side of it and not the other — covered by either, covered by the target and
not the tool, covered by both, covered by exactly one. The pieces are then pointed so the
region is on their left, which is what makes a hole a hole without anybody reversing it.

The selection is the tool and the rest is what it is applied to: draw the shape that says
where the notch goes, select it, take it away. Nothing selected means there is no tool, so the
three are offered only when there is one — where the union means the whole glyph, as it always
has. Three endings are worth telling apart and are: shapes that do not overlap have nothing to
do to each other, an operation that would leave nothing is declined rather than performed, and
a boundary that will not close is refused as it is for the union.

Points at the extremes were the fifth of these and shipped in 0.1.17, from the curve's own
menu.

Offsetting is the first thing in this project that cannot be exact. The offset of a cubic is a
curve of degree ten, so no Bézier lies on it, and the answer is an approximation with a stated
error: a piece is offset by moving its ends along their normals and scaling its handles by how
much the radius changed there — `1 − d·κ`, which is exact for an arc and nearly right for
anything drawn like one — and then halved and tried again wherever it strays further than a
fiftieth of a unit. A quarter circle costs one halving. Straight sides are exact, because a
line offset is a line.

The corners are the rest of the work. Where the offset opens a corner out there is a gap to
fill, and what fills it is a choice: an arc, a mitre, or a flat. Where it folds the corner over
there is no gap but a crossing, and two straight sides are cut back to where they cross — which
is what makes an inward offset of a rectangle another rectangle — while two curves are left
crossing for the union to resolve. The distance is given per axis, because a letter thickened
for weight wants more on the stems than on the thins, and a shape summed with an ellipse is a
squashed shape summed with a circle, squashed back. That last line is the one the elliptical nib
of phase 34 will use.

Simplifying is the same fitting pass pointed the other way: a point can go when one curve
through what is left is the curve that was there, which is what `refittedJoin` already answered
for deleting a point by hand. What is new is the policy. A point at an extreme stays, because a
font wants one there for hinting, for interpolation and for the renderers that read a glyph's
extent off it, and drawing the same shape without one loses all of that. A corner stays, because
the fit keeps the directions either side and would round it off. Everything else goes if the
outline moves less than a thousandth of the em, least damaging first.

#### Phase 33 — One answer to what a glyph is made of — done

A component is already geometry the document does not store: the outlines belong to the glyph
referred to, and `drawableGlyph` draws them in where they are wanted. Everything that only
looks at a glyph asks through it — the browser's cells, the proof, the spacing line, the
neighbours beside the canvas, a glyph's bounds. Everything that edits or writes a font reads
the contours as they are stored: the canvas, hit-testing, the knife, overlap removal, and the
compilers. Components survive that because both outline formats have components, so a compiler
passes the reference through instead of resolving it.

Nothing else would survive it. A shape whose outline is worked out rather than stored — a
stroke, a join that expands into its neighbours — is invisible to every one of those readers,
and each would have to be taught about it separately. So the seam moves: one function answers
what a glyph is made of, and the resolving stays in the one place.

Two things came out of starting it, and both are done.

The compilers were already right, which the paragraph above got wrong: `flattenedGlyphs`
resolves every component, corrects the directions and takes the union, in that order, for both
outline flavours. A dollar sign drawn as an `S` with two bars across it has always _exported_
correctly. What could not see components was the button — asking the editor to remove overlap
on that glyph said "nothing was overlapping" while the export quietly joined it. It sees them
now: the components whose outlines meet what is being joined become outlines, in one undo step
and said out loud, and the ones that meet nothing stay references, because that is what a
composite is for.

The union also used to decline two shapes that share a whole edge and no area — two squares set
side by side. There is nothing to split there: the ends of the shared edge are corners both
squares already have. What says the drawing is not already its own union is that the shared
edge has ink on both sides of it, and that is now the question asked. It matters beyond
tidiness: a rasteriser antialiasing each square against a shared edge separately leaves a pale
line down the middle of what should be solid.

The second half turned out smaller than this said, and the paragraph above was wrong about it
too. The edit view already drew a glyph's components and the pointer already found them —
`resolvedComponents` in the scene and a `components` option on the hit index had been doing it
for some time. What had not been told were three readers that went by the contours as stored:
the ruler, which laid across a dollar sign read the `S` and passed straight through the bars;
the gap measure, which measured to the edge of the parts drawn in place; and the knife, which cut
the `S` and left the bars whole.

The ruler and the measure now read the glyph as drawn — one function, `drawnGlyph`, the glyph's
own contours first with their ids and its components drawn in after them — so a segment found by
id is found exactly where it was. The knife changes the glyph, so it follows the union's rule
instead: the components its stroke crosses become outlines and are cut, the ones it does not
reach stay references, and the undo menu says which happened.

What a stroke or a squircle will need from this is `drawnGlyph` and the canvas's own resolving,
which both exist. The rest is theirs to add.

#### Phase 34 — Drawing with a pen instead of an outline — done

A broad-edged pen is how most letterforms were arrived at before anyone drew them as outlines,
and an editor that edits only outlines asks for the result without the reason. What is stored
is a skeleton and a nib; the outline is worked out from them, and phase 33 is what lets
anything see it.

A nib of fixed angle and width is the exact case, which is why it comes first: the sum of a
curve and a straight nib is the curve translated to either side of it, and a translated cubic
is a cubic, so there is nothing to approximate. The two sides are cut where the tangent runs
along the nib's own angle — where a broad pen dragged along its edge draws nothing and the
stroke pinches to a point, which is the behaviour and not a defect. Self-crossings on a tight
turn are what overlap removal is already for.

An elliptical nib is the same problem seen through an affine transform: an ellipse is a
stretched circle, so the skeleton is unstretched, offset by a circle, and stretched back.
Offsetting by a circle is a true offset curve, which is not a cubic and has to be fitted to
one within a stated error — the same kernel as offsetting a path in phase 32, and the reason
that one is worth having first.

Neither outline format has strokes, so the compilers flatten: resolve, remove the overlaps,
write outlines.

The broad nib is in. A stroke is a contour with a pen on it rather than a shape of its own,
because every tool that edits points already edits contours: a skeleton's points, handles,
Tunni controls and held joins work the day it is given a pen. The ink is worked out in one
place, `inkOf`, stretch by stretch — each segment cut where it runs along the nib, each stretch
bounded exactly by the path moved half the nib each way and the nib at its ends — and the
stretches are joined by the union. A corner is covered without any join being worked out,
because both stretches include the pen standing at the corner. It works for closed skeletons
as well as open ones: a square drawn with a pen is a band with the middle empty.

The question "what does this glyph draw" was already one question after phase 33, so it learned
one more thing: the fill on the canvas, the glyph browser and the strip, the exporter, a glyph
placed as a component, the ruler and the measure all see the ink. The operations that edit ink
— the union, subtract, intersect, exclude, offset — leave a skeleton alone. The pen interpolates
between masters, width and angle both, so a light master with a narrow pen and a bold one with
a wide pen is a stroke that thickens along the axis.

A `.ufo` is written both, as this section planned, though it took a release to get there. The
ink goes into the outline, after every contour drawn as an outline, so another application gets
the letter. The stroke goes into the glyph's own `lib` — its path, its pen, where it sat among the
contours, and its points' held joins and axis locks — with a note of how many contours at the end
of the outline are its ink and a fingerprint of exactly the points written for them. Opened
again, if the fingerprint still matches, the ink is taken out and the stroke put back where it
was, to the fraction of a unit it was drawn at rather than the whole units the outline is written
in. If another application has redrawn the letter since, the file's outlines are what the letter
now is, so they are kept and the stroke is let go, with a warning; putting a stale pen back over
somebody's edit would undo it. This matters because saving is saving to a UFO folder — Ctrl-S —
and 0.1.35, which wrote only the ink, turned strokes into outlines for anybody who kept their
font that way.

One thing was done more simply than planned. The knife divides an open stroke into two strokes
with the same pen but leaves a closed one alone, because the way it cuts a closed shape — closing
across a chord — would give a closed skeleton a new stretch of path.

The oval pen is in too, as a third number on the same pen: a thickness across it. Nothing is
the broad edge, and anything under half a unit is drawn as one, because the broad edge is exact
and the oval is not. The path is squashed until the oval is a unit circle, traced with the
offset of phase 32, and stretched back; a round pen is the case where nothing is squashed.

How the traced pieces are put together took two attempts. The first gave every segment round
ends of its own, and two round ends at one point are one arc drawn twice — the union has no
crossing on it to split at, so a stroke round a corner came out as two overlapping shapes. The
pieces now share only straight lines: each segment is a band closed straight across, the outside
of a corner is filled by a wedge of two radii and an arc, and only an open path's two ends get
round caps. Where the path bends more tightly than the pen, the side on the inside of the bend
folds back over itself and would fill with a hole in it; such a stretch is halved until it does
not fold, and a stretch too short to matter has that side drawn straight across. For a round pen
every point of the joined outline is the pen's radius from the path, which is tested.

After the oval pen came three things found by drawing with it. Ink went missing on segments
whose end handles were pulled back into their points: the direction of a curve at such an end
is not where its derivative says, because the derivative is nothing there, and the moved path,
the corner wedges and the offset's corners all asked for it. They now take the limit the curve
approaches, which is the direction towards the next handle along.

Drawing was slow, a fifth of a second a frame for an oval stroke, and nearly all of it was the
union joining a stroke's pieces — pieces that share straight edges exactly, which the curve
intersection bisected down to its budget before giving up. Two cheap questions now come first:
whether the two curves are straight and along one line, and whether their boxes meet at all.
The fill does not need the union either. Every piece is turned to wind the same way and filled
together, which paints the same pixels as the joined outline; the union is worked out only where
one outline is wanted — the exporter, a `.ufo`, the ruler and the measure — and remembered per
contour, so dragging one stroke works out that stroke's ink alone. A frame is now a fraction of a
millisecond for a broad pen and a few for an oval.

And the pen is set at points rather than once for the stroke. A stroke's own pen is what every
point has until a point is given one of its own; along each segment the pen blends from one
point's to the next, the angle the short way round over half a turn. Where a segment's two pens
are the same its ink is worked out exactly, as before. Where they differ there is no exact
answer — the edge is where a changing pen's furthest point is carried along a curve, which is no
cubic — so the edge is sampled and fitted with cubics to within a fiftieth of a unit, the fitting
being the classic least-squares one with the edge's own directions at its ends. A broad edge that
turns through the direction of the path pinches there, as a real one does. A point put into a
stroke, by the menu, at its extremes or with the knife, is given the blended pen at its place, so the ink
is unchanged until its pen is. The points' pens go into the project file, the clipboard, a
`.ufo`'s stroke entry, and interpolation. A **Stroke** tool, `N`, draws as the pen tool does
and starts a stroke with the last pen set.

How the pen changes between two points is chosen per segment, for the angle and the shape
separately: linear, smooth, eased or held. Every blend is measured by distance along the path
rather than by the curve's parameter, so an even change is even however the handles are pulled.
Smooth is a monotone cubic through the pens at all the points (PCHIP): the rate of change
carries through a point, and between two points the pen never passes either end, so a width
cannot overshoot, and a segment whose two pens agree stays that pen — which keeps the exact
ink for it. A stroke can also be converted to the outlines it draws from the canvas menu.

#### Phase 35 — A node that holds its own curvature — done

Harmonising moves a node to where the curvature either side of it agrees, once, and the next
drag of a handle undoes it. The arithmetic is closed and already written — the node slides
along the line between its own two handles — so what is missing is only that it does not stay.
A node marked as holding its curvature would be solved again after every edit, and that needs
no iteration to settle: the answer depends on the four handles and never on the points, so no
one node's answer can disturb another's.

The first half is in. A node can be asked to hold its curvature — **Hold** in the Curve
section, beside **Harmonise**, or from the menu — and it is then solved again after every edit,
in the same pass that settles tangent nodes. After that pass rather than before, because settling
a tangent moves a handle and a held node reads the handles around it; and never iterated, because
where a held node belongs depends on handles and on no node's position. It is drawn as a smooth
node with a ring round it. The flag lives in the project file, like the axis lock beside it: a
`.glif` has no word for it, and a node saved to one comes back an ordinary smooth node sitting
exactly where it was left.

Between a curve and a straight line there is no answer of that kind. A line has no curvature,
so a curve meeting it continuously has to arrive with none, and the only way there without
flattening the curve is to spend part of the line on the transition. That makes the drawn path
carry more pieces than the contour stores — it is phase 33's seam reaching inside a single
contour rather than around a whole shape — and it is the squircle, the corner every
application icon has been drawn with for a decade.

The second half is in, and it is a corner as much as a join. A corner or tangent point can be
made continuous, with a size and a smoothness; the contour keeps the point, and the drawn outline
— the one filled, exported, measured and joined — replaces that much of each side with a round.
At a corner the round is the one the rounded rectangles of the last decade use: a ramp out of
each side, a circular arc between, the ramps taking a share of the turn the smoothness sets. A
ramp is a cubic whose first three control points lie on the side, which leaves the side with no
curvature, and whose handle into the arc is sized so it arrives with the arc's; the circle is the
plain round's, so a smoothness of nothing is exactly the plain round. At a tangent point, a curve
running into a line, there is no corner, and one cubic replaces the last of the curve and the
first of the line, with its handle lengths solved so it leaves the curve with the curve's
curvature and arrives on the line with none. On a curved side a corner's round leaves the curve
along its direction, which is tangent-continuous there rather than curvature-continuous; on a
straight side, which is where it matters, it is exact.

The round is worked out where a stroke's ink is, so everything that asks what a glyph draws sees
it. The union, the set operations and the offset work on the round and leave ordinary points;
where nothing crosses, the union hands the glyph back with its corners still continuous. A
`.ufo` gets the round in the outline, and the contour as it is edited in the lib entry the
strokes already use. On the canvas the round is the outline, the sharp corner a dashed line under
it, and the ends of a selected corner's round are diamonds that drag its size along the sides.

#### Phase 36 — Alternates somebody else's application can find — done

A stylistic set drawn and proofed here was, in every other application, "Stylistic Set 1":
the feature file's `featureNames` and `cvParameters` were refused, and there was no `aalt` for
a glyph palette to list alternates from.

The names are written where every font tool reads them, in the feature file, and compiled the way
the format means: a stylistic set's feature table points at its parameters — a version and a
name-table number — and a character variant's at its label, tooltip, sample, the names of its
alternates numbered one after another, and the characters it changes as 24-bit values. The
numbers are taken from 256 upwards and the names written into the name table for the platforms
and languages the file gives, US English on Windows where it gives none; a variable font's axis
and instance names are added after them and take the next numbers. The tokenizer learned strings,
which a name is the first thing in the language to need: a space or a `#` inside one is part of
it. A font opened from a file has its names read back into the same blocks.

`aalt` is compiled as written — the features it names gathered, and its own rules — into a
single substitution for glyphs with one alternate and an alternate substitution for the rest. A
file with none gets one on export, gathered from the features whose alternates somebody picks one
at a time: stylistic sets, character variants, `salt`, the swashes, small capitals, the figure
styles. Only on export: a compile asked what one feature does is not handed an `aalt` too.

In the editor the Features switches show the name beside the tag, the source colours a name as one
string, and `featureNames` and `cvParameters` complete to their blocks with the caret in the name.

Turning a stroke into outlines is fixed in the same release. The union gave up on two things a
broad pen leaves, and the pieces of the ink went into the letter as they were, lines across the
stroke and all: a stretch where the path runs along the nib's own edge, whose ink is a hair thin
— such slivers are now left out — and a pinch, where a varying pen's bands met along the nib's
line with a sliver of ink either side that the union's probe stepped over. A varying segment is
now one outline through its pinches: the left of one run carries on as the right of the next,
and the union has no line there to decide about. Where a boundary piece has no ink either side
at the probe's usual distance, the ink is thinner than the probe, and the probe is tried closer.

An oval pen along a path with a sharp V and bends tighter than itself needed three more. A
stretch that folds was halved until it did not, and a bend genuinely tighter than the pen folds
at every scale, so it came out as two hundred slivers; it is now traced the way a changing pen
is, folded samples left out and the edge fitted, in one band. Beside a handle pulled onto its
point the offset's handle scale read all but infinite and threw a handle a hundred billion units
away; offset handles are now held to the length of the piece. And the V's two legs sweep the
same positions of the pen, leaving edges a few thousandths of a unit apart that the union of
curves cannot sort into buried and not. For that there is a second union: the contours flattened
to a fiftieth of a unit, snapped to a fine grid so edges meant to be one are one, joined by
polygon-clipping (Martinez–Rueda, MIT), and cubics fitted back through the result with its
corners kept. It is used where the union of curves gives up, and for a stroke's ink where that
union's answer would still join further.

#### After phase 36 — What the releases carried — done

Not a phase: what 0.1.44 to 0.1.54 carried, found by using the editor day to day, and most of
it about finding one's way round rather than about the font.

- **A font kept as a UFO of its own.** Saving asks for the folder to keep the font _in_ — a
  fonts folder, or a project's — and makes `Family-Style.ufo` there, never writing over
  another font's UFO; a same-named one is kept beside it as `-2`. The picker used to open
  inside the last font's UFO, and Save as accepted it, so a second font could be saved over
  the first.
- **Every command by name.** Ctrl-K lists the workspaces, the tools, what the canvas menu can
  do to the selection, and the File menu, narrowed by typing, each with its key. It goes to a
  glyph as well — by name, character, code point, or what the standard calls it — and offers
  to make one the font has not got.
- **Glyphs found by what they are.** A search of three letters or more in the glyph grid also
  looks among the Unicode names: `dotless` finds ı and ȷ whatever the font called them, and
  the characters so named that the font has not got are offered as cells to make.
- **The undo history, walked in one press.** Beside the preferences, or Ctrl-Shift-H: every
  step undo and redo can reach, named, with the glyph it changed and how long ago; pressing
  one goes straight there, and a step that changed another glyph opens it.
- **The menu on a selection.** Right-clicking empty canvas or a segment while points are
  selected offers the node types and the handle lock for all of them, where before only a
  right-click on one of the points did.
- **Bars that say more.** The window bar says where the font is kept, and marks unsaved
  changes; the status bar gives the selection's size and where the pointer is; the inspector
  leads with the sections about what is selected; menus name their keys in a column of
  their own.
- **Keys that meant something else.** `?` can be typed in the proof's text and the feature
  file; a search or the proof's text keeps its own Ctrl-Z rather than taking back an edit to
  the font out of sight; the Space preview and a held tool are given back when focus leaves;
  Escape that closes a popover goes no further.
- **A waterfall that zooms without losing its ladder.** Ctrl and the wheel scale the page as
  a view, where they had rewritten every size, rounded and pinned at the ends; the sizes are a
  row of chips, the chosen one's features after them, and ladders to fill the page from.
- **Kerning groups by the side of the letter.** The panel opens on the pair in front of you —
  `n`'s right side, `o`'s left — with the group each is in, and a group started from a
  letter in one press. The lists behind it are headed Right sides and Left sides, where they
  were "before the gap" and "after the gap".
- **One look.** The canvases are sunk into the window with an inset shadow, the bars around
  them lie flat, and only what floats casts a shadow; the lines framing the regions are one
  colour. One type scale of six sizes where there were twenty-two, one set of icon sizes at
  which Lucide's stroke stays crisp, one secondary button composed by twenty that had each
  been written out, one faded state, one scrim, one focus ring. Two colours the grid's list
  of sets used had never been defined, so it had shown no hover and no chosen set, and a
  select's chevron was a `data:` image the content security policy refused.

#### After 0.1.54 — Strokes held against the pen — done

Not a phase: what 0.1.55 to 0.1.57 carried, and one thing 0.1.59 found. Phase 34 worked a
stroke's ink out side by side; these are the places that went wrong, each found on a real
drawing.

- **A slow, sure pen to check against.** The pen stood at two hundred and forty places along
  a path and its ink read off a grid, which no real stroke could afford and every real stroke
  can be held against. Sixteen strokes are, in the tests, and the two that were drawn in the
  editor and came out wrong are among them.
- **Folds swept rather than skipped.** On the inside of a bend tighter than the pen, the side
  of the ink runs backwards. Its samples there were left out and the gap crossed straight,
  which ran through ink where the side came back past itself: a notch in a hook, a gap past
  a sharp corner. A fold is now the pen swept from one position to the next.
- **A broad nib that turns.** A nib that only moves swaps its sides at its centre; one that
  also turns pivots somewhere else along itself, and the ink it laid pivoting was left out.
- **Strokes that convert into one outline.** Where the union of curves refuses, the union of
  polygons is tried; a ring with one corner, and a round ring, come back as contours; sliver
  holes where two parts all but met are left out.
- **Strokes that cross.** A stroke's ink is turned the way ink is when it is made, and was
  then turned again by its nesting wherever a glyph was filled, as a drawn outline has to be.
  One stroke's ink lying in another's — a round end resting on the stroke it meets, a door in
  a house — was taken for a counter: cut out of what it crossed in the exported font, and
  bitten out of it in the glyph grid, the spacing line and the proof. Ink is marked where it
  is made and left as it is by everything that fills.
- **Pictures to check by.** `pnpm screenshots` serves the editor on a port of its own, opens
  it in a headless Chromium with an empty profile, and writes each workspace in both themes
  to a folder git ignores. A stylesheet change passes every test whether or not it looks
  right; this is how one is looked at without anybody's open font.

#### Phase 37 — Icon fonts and fixed-width fonts — done

An icon font is a font, and the editor could draw one, but nothing in it knew what an icon
was: a point snapped to whole units whatever the icon was drawn on, every glyph was its own
width, an icon set had to be redrawn by hand, and what came out was a file no web page could
use as it stood. 0.1.58 and 0.1.59.

- **A grid of the font's own.** A step in units and, every few steps, a stronger line, kept
  in the font's lib and so the same wherever it is opened. Drags snap to it where they
  snapped to whole units; `G` draws it, the fine lines fading as zooming out packs them
  together. Presets for an icon drawn at 16 to 48 pixels work the step out from the em, and
  where it does not come out whole the panel offers the em that divides it.
- **An em that can scale.** Typing a new em asks what is meant: the numbers kept, or the
  whole font scaled with it — outlines, pens, components, anchors, guides, advances, kerning,
  metrics, the grid — in one undo step. The feature file is not scaled, and it says so.
- **One width.** A font says it is fixed-width and at what width. The glyphs of another
  width are counted and fitted when asked, centred, marks and double-width glyphs left
  alone; new glyphs take the width; a sidebearing slides the drawing in its cell; a width
  key may be a number. Preflight lists a glyph of another width, and the compiled font says
  it is fixed where terminals and operating systems look.
- **SVG in.** Any number of files from the File menu or dropped on the grid, a glyph each,
  named for the file, at the next private-use code points, scaled to the line box. A filled
  shape is an outline; a stroked one is a stroke with a round pen of its width, so a set
  drawn in strokes can still have its weight changed. Pasted or dropped on the canvas, an
  SVG's shapes go into the glyph being drawn. What is left out is said, by file and by
  glyph.
- **Names as ligatures.** A switch, and the exported font spells each icon's name, the
  longest first. The rules and the blank letters they need are made on the way out and are
  never in the source, so they cannot go stale. Set by HarfBuzz in the tests.
- **An icon kit out.** The font as WOFF2, a stylesheet with a class for each icon, a page
  showing them all, and the names and code points as JSON, in one archive; and every glyph
  as an SVG of its own, as compiled.
- **Bigger cells.** The glyph grid draws its cells up to three times their size.

#### Phase 38 — An icon at the size it is used at — done

What phase 37 left: an icon could be brought in and sent out, and nothing said how it would
look at twenty-four pixels, or helped draw one to the sizes icons are drawn to. 0.1.60.

- **The glyph in pixels.** A Pixels section in the inspector: the glyph at 16, 24 and 32
  pixels to the em, exactly as big as it will be, and the one pressed again close up, each
  pixel a square. Where an edge falls between two lines of the grid it is grey, and this is
  where that is seen.
- **Checks for the grid.** In a font drawn on a grid coarser than whole units, preflight
  notes the outline points off it and the strokes that are not a whole number of steps wide.
- **Keylines.** `Shift-G` draws the live area and the four shapes icons of different
  outlines are drawn to, in the proportions the common sets agree on.
- **Lining up and spacing.** Six ways to line the selection up and two to space it evenly,
  in the Transform section and in Ctrl-K. Whole contours move as shapes and anything less as
  points; one contour alone lines up with the glyph's own box, which centres an icon.
- **A set brought in again.** A file named for an icon the font has redraws it and keeps its
  code point, name, anchors and mark; a file named for any other glyph is still left out,
  so `a.svg` never draws over the letter.

#### After phase 38 — Strokes in a variable font — done

A stroke went into a variable font as its skeleton: the path the pen was drawn along, closed
up and filled. The ink a single font gets could not simply take its place, because it is
fitted, cut at its folds and joined by a union, and comes to different points for a pen a
little wider — and a variable font says a glyph once and then how each point moves.

So the ink is drawn a second way for a variable font, to one plan for all the masters. It is
one line round the ink: the pen's furthest reach to the right of the path, out along it and
back, with the pen's own edge followed round each end and round each corner by as much as the
path turned. That line is not the edge of the ink — it runs back over itself inside a tight
bend and crosses itself inside a corner — but it goes round every point the pen covered and
round nothing the wrong way, so the non-zero rule fills it as the ink exactly, and nothing has
to find a fold or cut one out. The plan is how many curves each stretch is drawn with, which
is as many as the master that needs most. A broad edge is exact: its side is the path moved
over by half the nib, crossing along the nib where the path runs along it.

fontTools is asked, as it is of every other delta: it draws both flavours at each weight and
the fill is held against the same stroke exported on its own at that weight
(`tools/otf-check/check_vf_strokes.py`). What has no one plan — a broad edge that changes
along the stroke, a broad edge in one master and an oval in another, a blend that steps — is
written as the default master draws it and named in a warning.

#### After phase 38 — How a stroke ends — done

A pen held at an angle ends a stroke at that angle, and the way to a flat foot was to turn the
pen level at the last point — which widens the stroke there, so that the width has to be taken
back off, point by point and master by master. An end can now be cut instead: square to the
path, level, upright or at any angle, set on the first or last point of an open stroke in the
Pen section's **End** row, and switched off there again.

The pen is not touched. The stroke is carried on straight past its last point, with the pen it
had there, until the whole pen is past the cut, and then cut by a line through that point: the
point is where the ink ends. Only the last segment is carried on and cut, as a stretch of its
own, because the line goes on across the whole glyph and a stroke comes back across it — the
bowl of a u below the tops of its stems. The stretch is joined into one outline first and cut
after, so that no two of its parts are left with edges lying along the same line.

A cut end is closed with the cut itself or with half the pen's outline. The half outline is
laid along the cut, as wide as the stroke is where the line crosses its ink and as deep in
proportion as the pen is thick to its width; the stroke is cut that depth short of the point
and the half outline stands on the edge that leaves, its tip on the line through the point.
So a flat end keeps the pen's roundness without the pen being turned or its width taken back.

A selected cut end shows its line on the canvas with a knob at one end, as a continuous corner
shows where its round ends: dragged round the point it turns the cut, settling on level,
upright and square.

#### After phase 38 — A pen with corners — done

A pen was an oval, or the broad edge an oval of no thickness is. It has one more number now,
its squareness, from the oval at nought to a rectangle of its width and thickness at one, with
a box whose corners are rounded between them: the outline `|x/a|ⁿ + |y/b|ⁿ = 1`, the exponent
two for the oval and more the squarer it is. Squareness is measured as Metafont measures
superness, by where the outline crosses the diagonal of the box it sits in, and runs only from
the oval upward. With cut ends it is what a slab serif drawn as a stroke wants.

Everything that draws a stroke asks the pen one thing — how far it reaches in a direction —
and a pen with corners answers that as plainly as an oval does, so the sides, the folds and
the swept steps needed nothing new. What the oval had to itself were its exact sides, its
caps and the wedges on the outside of its corners, all made where the pen is a circle; a pen
with corners has no such place, and its sides are fitted and its caps and wedges walked round
its own outline by the direction it faces. A rectangle proper has no exponent and is drawn
with the largest one used, short of square at its corners by a hundredth of the pen's
half-width.

A cut end varies in a variable font. The line round the ink stops at the cut on each side of
the stroke — where the side last crosses it, or carried on straight to it where the side stops
short — and goes along the cut, or round half the pen's outline in two curves, in place of the
pen's edge at that end. A side that is cut short keeps its pieces, the ones past the cut with
no length, so every master has the same. fontTools draws the proof font's cut stem at each
weight beside its S.

A pen with corners varies too, also against an oval in another master. Its sides cannot be
given by how fast they are going, as an oval's are: where the pen's reach passes one of its
corners the side turns, sharply for a square pen, and where a flat of the pen is laid along
the path the reach crosses the whole flat in next to no path at all. So each side is read
closely — a gap too long halved until it is not — and cut where the reach passes a corner of
the pen and where the side turns back on itself; between the cuts it is fitted in pieces of
about a length, each run with as many as the master that needs most. The pen's edge at a join
and round an end is read and cut at its corners the same way, and an end closed with the
pen's shape is four pieces, a corner's worth to each. Where any master has corners every
master is drawn so, an oval among them: the same ink in other pieces. fontTools draws a hook
that is an oval in the light and a rectangle in the black.

#### Open

What is next in the same direction:

- **A rectangle that is one**, exact as the broad edge is: its sides the path moved over by a
  corner, with a straight line across where the path runs along one of its edges.
- **A broad edge that turns or widens along a stroke, in a variable font**, which is still
  written as the default master draws it.
- **Fitting to the fixed width in every layer**, where it now fits the main drawing.

#### Parked

- **A second font in a pane of the split window**, until windows per font have shown whether
  it is wanted.
- **TypeScript 7**, until typescript-eslint reads it; its latest release accepts TypeScript
  below 6.1.
- **A signed installer**, until there is a certificate.
- **A macOS build**, which needs Apple's signing and notarisation to open at all.
- **Colour fonts** (`COLR` and `CPAL`), a drawing model of their own, and nothing else waits
  on them.
- **Vertical metrics** (`vhea` and `vmtx`), which vertical CJK setting needs, and which
  wait for a font that is set vertically.
- **The other containers a Macintosh font arrives in** — `.dfont`, MacBinary, BinHex, and
  the pre-5 `SIT!` archives with their own five compressors. The resource fork reader
  handles all of them once something unwraps them; nothing has asked yet.
