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
picture to trace from sit behind the drawing; before it goes out, nineteen checks say what
is wrong with it. Several fonts are kept at once, each in a working copy of its own; the
window splits into two panes — the drawing may fill both, each canvas showing what it is
asked to — and a second font opens in a window of its own. The grid lists what the font has
not got as well as what it has, and a glyph is made from the hole where it belongs. A line
can be set with any of the font's own features switched on, so a stylistic set is judged
where it is drawn. A Macintosh bitmap font in a StuffIt archive opens as outlines. The
desktop application installs from a release, updates itself, and says which version it is.

| Phase |                                     | Status                                                                                     |
| ----- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| 0     | Foundations and the geometry kernel | done                                                                                       |
| 1     | The editing surface                 | done                                                                                       |
| 2     | Undo, redo, persistence             | done                                                                                       |
| 3     | From paths to a glyph               | done, and anchors with it                                                                  |
| 4     | From a glyph to a font              | done                                                                                       |
| 5     | Binary import and export            | done: OTF and UFO both ways, and a UFO folder on disk both ways                            |
| 6     | Proofing and shaping                | done, and set by HarfBuzz since phase 17                                                   |
| 7     | Spacing and kerning                 | done                                                                                       |
| 8     | OpenType features                   | most of `.fea` compiles to GSUB and GPOS, and anchors to marks                             |
| 9     | Variable fonts                      | done: CFF2 with blended charstrings, fvar, STAT and HVAR, checked against fontTools        |
| 10    | Production polish                   | lint, format and about 2,700 tests, run on CI; preferences persist                         |
| 11    | The drawing hand                    | done                                                                                       |
| 12    | Not losing what was opened          | done                                                                                       |
| 13    | The family, named                   | done                                                                                       |
| 14    | What ships to a browser             | done                                                                                       |
| 15    | Several fonts, and a name           | done                                                                                       |
| 16    | The details a font is judged on     | done                                                                                       |
| 17    | Proving it where it will be used    | done: HarfBuzz sets the proof, FreeType draws the fonts in CI, ttfautohint hints           |
| 18    | Keeping it maintainable             | done; TypeScript is at 6, and 7 waits for the linter to read it                            |
| 19    | Releases                            | done: versions, a release workflow and updates; the installers are unsigned                |
| 20    | A split window                      | done                                                                                       |
| 21    | Two fonts side by side              | done: a window per font                                                                    |
| 22    | More of the feature file            | done: most of the language, a Marks file from the anchors, both matched by fontTools       |
| 23    | Right-to-left text                  | done: bidi runs, and direction, script and language chosen in each bar                     |
| 24    | The web build, hosted               | later                                                                                      |
| 25    | The feature source, further         | done: completion, find and replace, and a name that opens its glyph                        |
| 26    | The last interface tests            | done: every panel and control is rendered by a test                                        |
| 27    | A designspace that survives         | done: maps and avar, sparse masters, rules compiled and edited, the rest carried           |
| 28    | Binary import keeps its layout      | done: GSUB and GPOS as source, marks as anchors, kerning into the model, fontTools-checked |
| 29    | Layers to draw on                   | done: layers in the document, any drawn in, shown behind, copied and swapped per glyph     |
| 30    | Making masters compatible           | done: start points, contour order, point numbers, and the family between its masters       |
| 31    | A proof for judging features        | half done: a feature is switched on in the bar; the waterfall is what is left              |
| 32    | More outline operations             | next                                                                                       |
| —     | Old Macintosh fonts                 | done, unplanned: StuffIt archives, resource forks, bitmap suitcases into outlines          |

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
  composite glyph involved. The UFO carries the anchors both ways, format 1 and 2. What
  is not there is a mark glyph in two classes at once — the format gives it one, and a
  glyph with two attaching anchors is named in the export warnings.

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

#### Phase 24 — The web build, hosted

The browser build runs anywhere a folder of files can be served, and is served nowhere.
Choosing a host decides how the content security policy reaches it — a header, or a meta tag
where the host cannot send one — and gives the README somewhere to link to.

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

#### Phase 31 — A proof for judging features — half done

The Proof turned every feature on or off together and set text at one size. The first half
shipped in 0.1.24: each bar has a **Features** panel with a switch per feature the font
defines, each starting where a text renderer would leave it, so a stylistic set can be seen
substituted without exporting the font — see below.

What is left is the waterfall: the same text down a ladder of sizes, to see where it stops
reading, and a size and a feature set per block so two settings can be judged against each
other on one page.

#### Phase 32 — More outline operations

Union is the only boolean. Subtract, intersect and exclude, simplifying a contour, and
offsetting a path are the operations reached for when drawing, and each is a menu item in
every other editor. Points at the extremes were the fifth of these and shipped in 0.1.17,
from the curve's own menu.

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
- **Names for a stylistic set** (`featureNames`, `cvXX` parameters) and gathering `aalt`,
  which is what would make the alternates this editor can now draw and preview findable by
  name in somebody else's application.
- **Overlap removal that sees components**, for a glyph drawn as a letter plus a shape —
  the dollar sign — which can only be unioned today by decomposing it first.
