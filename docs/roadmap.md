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
window splits into two panes, and a second font opens in a window of its own. The desktop
application installs from a release and updates itself.

| Phase |                                     | Status                                                                               |
| ----- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| 0     | Foundations and the geometry kernel | done                                                                                 |
| 1     | The editing surface                 | done                                                                                 |
| 2     | Undo, redo, persistence             | done                                                                                 |
| 3     | From paths to a glyph               | done, and anchors with it                                                            |
| 4     | From a glyph to a font              | done                                                                                 |
| 5     | Binary import and export            | done: OTF and UFO both ways, and a UFO folder on disk both ways                      |
| 6     | Proofing and shaping                | done, and set by HarfBuzz since phase 17                                             |
| 7     | Spacing and kerning                 | done                                                                                 |
| 8     | OpenType features                   | most of `.fea` compiles to GSUB and GPOS, and anchors to marks                       |
| 9     | Variable fonts                      | done: CFF2 with blended charstrings, fvar, STAT and HVAR, checked against fontTools  |
| 10    | Production polish                   | lint, format and about 2,700 tests, run on CI; preferences persist                   |
| 11    | The drawing hand                    | done                                                                                 |
| 12    | Not losing what was opened          | done                                                                                 |
| 13    | The family, named                   | done                                                                                 |
| 14    | What ships to a browser             | done                                                                                 |
| 15    | Several fonts, and a name           | done                                                                                 |
| 16    | The details a font is judged on     | done                                                                                 |
| 17    | Proving it where it will be used    | done: HarfBuzz sets the proof, FreeType draws the fonts in CI, ttfautohint hints     |
| 18    | Keeping it maintainable             | done; TypeScript is at 6, and 7 waits for the linter to read it                      |
| 19    | Releases                            | done: versions, a release workflow and updates; the installers are unsigned          |
| 20    | A split window                      | done                                                                                 |
| 21    | Two fonts side by side              | done: a window per font                                                              |
| 22    | More of the feature file            | done: most of the language, a Marks file from the anchors, both matched by fontTools |
| 23    | Right-to-left text                  | done: bidi runs, and direction, script and language chosen in each bar               |
| 24    | The web build, hosted               | later                                                                                |
| 25    | The feature source, further         | done: completion, find and replace, and a name that opens its glyph                  |
| 26    | The last interface tests            | done: every panel and control is rendered by a test                                  |

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
  this editor never wrote are left alone. Layers other than the default one are carried
  the same way — read whole, never looked at, written back where they were, and listed
  again in `layercontents.plist` — so a source with a sketch layer beside the drawing
  survives being opened, edited and saved. The one thing left to know is that a source
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

Reverse substitution, mark filtering sets and `table` blocks stay refused by name.

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

#### Parked

- **A second font in a pane of the split window**, until windows per font have shown whether
  it is wanted.
- **TypeScript 7**, until typescript-eslint reads it; its latest release accepts TypeScript
  below 6.1.
- **A signed installer**, until there is a certificate.
- **A macOS build**, which needs Apple's signing and notarisation to open at all.
