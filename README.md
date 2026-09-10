# FontEditor

A browser-based font editor that uses **Tunni lines** as an additional way to control
cubic Bézier splines.

Tunni lines were devised by Eduardo Tunni and FontLab Ltd. The maths in this repository
derives from the reverse-engineering write-up in
[Tunni-Lines](https://github.com/OliverLeenders/Tunni-Lines).

## Status

**A font drawn here can be kept on disk, exported and installed.** Five workspaces —
Font, Glyph, Spacing, Features, Proof — around a canvas with select, pen, knife,
rectangle, ellipse, measure and section tools, snapping, boolean union, anchors and
components, kerning, curvature combs and harmonising, a `.fea` subset, and OTF, TTF, WOFF, WOFF2, a variable OTF and UFO in
both directions. A family is several masters, a `.designspace` and one `.ufo` each; a UFO folder on disk is opened and saved back to; everything autosaves
to the browser's own store besides, and copies of the whole font are kept as you work.
Guides and a picture to trace from sit behind the drawing; before it goes out, nineteen checks say what is wrong with it.

| Phase |                                     | Status                                                                              |
| ----- | ----------------------------------- | ----------------------------------------------------------------------------------- |
| 0     | Foundations and the geometry kernel | done                                                                                |
| 1     | The editing surface                 | done                                                                                |
| 2     | Undo, redo, persistence             | done                                                                                |
| 3     | From paths to a glyph               | done, and anchors with it                                                           |
| 4     | From a glyph to a font              | done                                                                                |
| 5     | Binary import and export            | done: OTF and UFO both ways, and a UFO folder on disk both ways                     |
| 6     | Proofing and shaping                | done for this editor's `.fea` subset — see below                                    |
| 7     | Spacing and kerning                 | done                                                                                |
| 8     | OpenType features                   | a `.fea` subset compiles to GSUB and GPOS, and anchors to marks                     |
| 9     | Variable fonts                      | done: CFF2 with blended charstrings, fvar, STAT and HVAR, checked against fontTools |
| 10    | Production polish                   | lint, format and 2193 tests, run on CI; preferences persist                         |
| 11    | The drawing hand                    | done                                                                                |
| 12    | Not losing what was opened          | done                                                                                |
| 13    | The family, named                   | done                                                                                |
| 14    | What ships to a browser             | WOFF and WOFF2 done; the variable TrueType flavour is not                           |

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

- **Positioning in `.fea` is the single adjustment only.** `pos @caps <10 0 20 0>;`
  compiles and merges into the same GPOS the kerning is written to. A pair adjustment is
  refused by name and pointed at the Spacing workspace, which is where this editor keeps
  kerning — two ways to write the same rule would be two answers with no way to say which
  won. Attachment and positioning in a context are refused too, and kept in the file.
- **Shaping is this editor's `.fea` subset, not a shaping engine.** Single substitutions,
  ligatures, and both of those conditioned on their context, are applied to the Spacing
  line and the Proof in the order the file lists them. There is no mark attachment and no
  bidi — and the glyph strip under the canvas is deliberately left unshaped, since it is
  there to show the letter you are drawing beside its neighbours. Positioning rules are
  applied to both as well — a glyph moves where the rule says and the pen moves by the
  advance the rule gave it.
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
  checking our arithmetic against our own arithmetic. What is still unproven is the OTF
  against a rasteriser, and the UFO against the editors people actually use, which agree
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

#### Phase 14 — What ships to a browser

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

What is left is **a variable font with `glyf` and `gvar`** rather than CFF2. It is the
flavour the web actually serves, and it is the biggest single job left: the quadratic
conversion that TTF export already does has to come out _point-compatible_ across every
master before a delta can be taken between them, which the current converter has no
reason to guarantee, and `gvar` wants the four phantom points along with the outline.
Nothing else waits on it.

## Getting started

Requires Node 22.13+ and pnpm.

```bash
pnpm install
```

Then run the editor and open http://localhost:5174:

```bash
pnpm dev
```

### As a desktop application

The same editor, in a window of its own rather than a browser tab:

```bash
pnpm --filter @fonteditor/editor app
```

and to make an installer:

```bash
pnpm --filter @fonteditor/editor app:build
```

This is [Tauri](https://tauri.app), which is a Rust program that opens a window and points
the operating system's own webview at the editor. Building it needs a Rust toolchain
(`rustup`), and on Windows the MSVC build tools and the WebView2 runtime — the last of
which ships with Windows 11.

Tauri rather than Electron for one reason that matters here and one that does not. The one
that does not is size: the installer is 2.4 MB against something like 150, because the
browser is the one already on the machine rather than a second copy of Chromium. The one
that does is the risk that buys: a system webview is _a_ browser rather than a pinned one,
and this editor is unusually dependent on browser APIs — the File System Access API for a
folder on disk, the private filesystem for autosave, Web Locks so two windows cannot write
the same project, and a worker. Electron would have guaranteed all four by carrying its own
Chromium.

On Windows the system webview is WebView2, which is Chromium, and the File System Access
API is there: the File menu offers _Open folder…_, which it only does when
`showDirectoryPicker` exists. That was the question the whole choice rested on, and it is
worth re-asking on any platform this is built for, because the answer is the platform's
rather than ours.

Nothing in `src-tauri` knows anything about fonts. It opens a window and gets out of the
way: no commands, no plugins beyond a logger, and no Tauri API called from the editor —
which is what keeps the browser and the desktop builds the same program rather than two
that have started to drift.

Use PgUp and PgDn to move between glyphs, and press `?` for every key at once. The
toolbar is icons; every one names its shortcut in its tooltip — `V` select, `P` pen, `K` knife, `R` rectangle, `E` ellipse,
`L` ruler. Measuring one stem is **held** rather than switched to: `M` borrows the tool
for as long as the key is down and gives the drawing tool back when it is let go, because
measuring is something you do while drawing rather than instead of it. With the pen, click for a corner point and drag for a smooth one, Alt while
dragging to leave only one handle, click the first point to close, Enter or Escape to
finish open, Backspace to take a point back.

With the select tool: drag nodes, handles, the blue Tunni line and the amber Tunni
point. Double-click a Tunni point to balance the segment. Double-click a contour — a point of it, a handle, or the curve itself — to select all of
its points, and hold shift to gather another contour with it; the same is in the
right-click menu. Shift extends the selection,
Alt breaks a smooth node's handle link, arrow keys nudge, Backspace deletes selected
points, `R` reverses the contour, and Escape cancels a drag. A point with a straight
segment on one side and a curve on the other can be made **tangent**, from the inspector
or the right-click menu: the curve then leaves along the line, and stays that way when
either end of the line moves.

The glyphs either side are drawn from the strip text, dimmed, for judging spacing —
**double-click one to open it**. Everything about the glyph being edited comes first:
anything pickable, and the whole box round its drawing, so a shape that overshoots well
outside its own sidebearings is still that shape where it hangs over the next letter.

**Spacing that follows another letter.** The inspector's glyph section has three fields
saying where this glyph's spacing comes from: its left sidebearing, its right, or its
whole advance, each the name of another glyph. Set one and the number beside it goes grey
and shows what the rule works out to, following the chain — `ü` from `u` from `n` — and
following it again the moment `n` moves. The rule is kept in the source and resolved
where the font is compiled, so what comes out is an ordinary font. A rule that cannot be
followed leaves the glyph as drawn and is reported, in the export warnings and in the
preflight check.

The inspector transforms whatever is selected by a number rather than by dragging: move,
scale, rotate, slant, flip. It turns about any of the nine points of the selection's box,
or about the glyph's own origin — which is what slanting an italic has to use, since
turning about the selection would shift every glyph sideways by a different amount — or
about the baseline under the selection.

Select two points or more and a dashed box appears round them. Drag from inside it to
move everything selected — anything under the pointer still wins the press, so a point
you can see is a point you can still grab, and shift keeps its own meaning and starts a
marquee. The box has eight handles and a round knob on a stem above the top edge: a corner scales both axes, an edge scales one,
and the knob turns — as does just outside a corner, which is the same gesture without
having to reach for the knob. Shift holds the shape on a scale and the angle on a turn,
and alt works about the middle instead of the opposite corner. The box stands a little
away from the selection, so its handles never sit on top of the points they are there to
move, and it is held at whatever angle the selection has been turned to, whether by the
knob or by a number typed into the inspector: it lies along the shape rather than
standing upright round it, and its handles then scale along its own axes. Ctrl-Z undoes
and Ctrl-Shift-Z redoes, and either stands the box upright again — how far the points
were turned is not part of the history.

**Anchors and components.** Right-click empty canvas to put an anchor down; it is a
small cross, named on hover, dragged like a point and snapped to the same lines. The
inspector lists them with an editable name and coordinates. A component is added by name
in the inspector and lands on its anchors where both glyphs have a matching pair — an
`acute` carrying `_top` on a letter carrying `top` — and at the origin otherwise. Drag one
by the shape it draws, type its offset, right-click it to open the glyph it refers to,
put it back where the anchors say, or decompose the glyph and keep the outlines.

**The curvature comb** is off by default and turned on in the preferences. It stands a
hair square to the outline every few pixels, as long as the curvature there, and joins the
tips: what is read is that envelope, where a step at a node is a curvature break — a join
smooth to the eye and not to the light falling on it — a pinch is a flat spot, and a
pinch to nothing and grow again is an inflection. It is the one instrument here that says
whether two segments _agree_; the Tunni line describes one segment and has nothing to say
about the join. The hairs always stand out of the ink — which is why the comb is built
from the _filled_ contours, since only the corrected winding says which side that is — and
they are spaced in screen pixels, so the comb is as readable zoomed in as out. Their
length is normalised across the whole glyph, so a tight counter and a wide bowl can be
compared rather than each being flattered separately. Where the outline is straight there
is nothing to draw and nothing is drawn, envelope included.

**What the comb shows, the inspector measures and one command fixes.** Select a point and
the Curvature line gives the radius of the circle fitting each side of it and how far
apart the two are: `× 1.00` is a join the light crosses without a crease. **Harmonise** —
the button there, or the right-click menu on a node — slides the point along the line
between its own two handles to where the two curvatures agree. The handles do not move, so
both segments keep the directions they were drawn with, and the node lands exactly smooth
as well as curvature-continuous. It is offered only where it would do something: a corner,
a straight side or an already harmonious join has nothing to reconcile.

**The knife counts crossings along the stroke, not around each contour.** Every pair of
crossings spans a stretch of the stroke that lies inside the ink, and each of those
stretches becomes an edge of the result — which is what makes the interesting case fall
out rather than needing a rule of its own. Drawn all the way across a shape, the pair
divides it in two. Drawn into an `o` from outside and stopped in the counter, the pair has
one end on the outer contour and one on the counter, so it _joins_ them: what comes back is
a single closed contour running round the outside, along the stroke inwards, round the
counter and back along the stroke — a ring with a slit in it, simply connected the way a
`c` is where the `o` was not. The slit has no width yet; pulling it open is drawing rather
than cutting.

An odd number of crossings is the case with no pairing at all: the stroke came in and did
not come out, so nothing is divided and a point goes in at each crossing instead. That is
the quick way to put a point exactly where a stroke meets an edge. An open path has no
inside and no parity to satisfy, so a stroke across one simply divides it into shorter
paths.

**Two rulers.** Hold `M` and point at a stem: the reading is taken square to the outline,
which is what a stem width is — a straight line dragged across a round letter measures a
chord instead, and answers a different question. Point at the space _between_ two letters
instead and it reads the gap there: ink to ink at the height under the pointer, which is
what the eye judges and which changes as you move up and down a round letter — the
sidebearings say one number for the whole letter, and say it about the advance box. Click
to pin the reading, let the key go to carry on drawing. `L` is the other kind: drag a line across the whole letter and every
width along it is measured in a row — stem, counter, stem — with the stretches of ink
told apart from the gaps between them. Shift holds the line to an eighth-turn, Escape
takes it away, and it stays where it was put while you work under it.

**What comes out.** OTF and TTF to install, WOFF and WOFF2 for a web page, a UFO as
source, and — once a font has more than one master — a family as a designspace with a
UFO each, one variable font, and every named style as an ordinary static font. The web
formats are written from the TrueType flavour, which is what WOFF2's transform is for.

**Right-click anything on the canvas.** A point offers corner/smooth, an axis lock,
reverse contour and delete. A handle offers the axis lock, its node's type, retract,
and reverse. A segment offers insert-point-here, line/curve conversion, balance and
reverse. Which items appear depends on what is under the pointer, using the same hit
index the tools use — the menu can never offer an action for something the canvas is
not showing. Space previews without controls, the wheel pans, Ctrl-wheel zooms at the
cursor, middle-drag pans, and Ctrl-0 refits. Ctrl-wheel also sets the type size in the
Spacing and Proof workspaces.

Preferences — theme, outline weight, what the canvas shows, the type sizes in Spacing
and Proof — are kept in this browser rather than in the font, and are edited from the
sliders button at the right of the toolbar. The theme follows the operating system
until you choose light or dark yourself.

Edits autosave to the browser's private filesystem after a second's pause, so closing
the tab and coming back keeps your work. Note that this store belongs to the browser,
not to you — the files cannot be opened in a file manager. Saving a project to disk is
a later step.

```bash
pnpm test
```

```bash
pnpm typecheck
```

## Layout

```
apps/
  editor/       The editor: shell, panels, and the canvas.
    src-tauri/  A window for it on the desktop. Rust, and nothing about fonts.

packages/
  geometry/     Vec2, cubic Béziers, and the Tunni-line kernel. Pure; no DOM.
  font-model/   Nodes, contours, glyphs. Plain serializable data.
  view/         Design↔screen transforms, hit testing, segment activation. Pure.
  render/       Canvas drawing. Pure draw functions plus a thin surface helper.
  tools/        Every tool, as pure reducers over editor state.
  edit-core/    Transactions, undo and redo over the document.
  storage/      Autosave to OPFS, in a worker. Local-first; nothing leaves the browser.
  disk/         The user's own UFO folder, opened, read and written where they can see it.
  preflight/    What is findable about a font before it is exported. Reports; never repairs.
  font-io/      OTF and UFO, read and written by hand. Zip, plist, XML, GPOS, GSUB, .fea.
  catalog/      Unicode blocks and the glyph browser's query layer.
```

Packages are consumed directly from TypeScript source — there is no build step until
something needs to ship.

### Two decisions worth knowing before reading the code

**The document is a font, not a glyph.** `FontDocument` holds many glyphs keyed by name
with a separate ordering — UFO's arrangement, which pays off twice: lookup by name is
what components and the glyph strip need, and ordering belongs to the font rather than
to the glyphs, so renaming one does not disturb where it sits.

**A contour is a list of nodes, not a list of segments.** Each on-curve point owns both of
its handles, and segments are derived on demand. This is what makes a shared point
impossible to desync — there is only ever one of it — and it stores smoothness once rather
than twice.

**History is snapshots, not patches.** The model is persistent — every operation returns
a new value sharing everything it did not touch — so a history entry holds two
references and unchanged contours exist once however deep the stack goes. Memory is
already proportional to what changed, which is what patches would have bought, and undo
is a reference swap. Serializable deltas, if collaboration ever needs them, can be
derived by diffing a before/after pair.

**The model holds only lines and cubics.** Quadratics from imported TrueType are converted
at the boundary, which is exact and loses no shape. A quadratic has one control point and
therefore no Tunni line, so a quadratic segment would be inert under the editor's central
feature.

## Rules the codebase holds itself to

These are what make undo work and keep the editor testable. They are cheap to keep and
expensive to reintroduce.

1. **The document is plain, serializable data.** No class instances, no DOM references, no
   live view objects anywhere in the model. It must survive `structuredClone`, a JSON
   round-trip, and a trip through a Worker unchanged.
2. **`geometry` and `font-model` are pure.** No `window`, no `document`, no timers, no
   globals. They run under Node and inside a Worker without modification.
3. **Failure is a value, not a guess.** An operation that cannot be performed returns
   `null`. It never returns a plausible-looking coordinate, and it never returns `NaN`.
4. **Design units, y-up, everywhere below the renderer.** Pixels exist in exactly one
   place: the view transform. Tolerances that mean "close on screen" are converted through
   it, never hardcoded in model code.
5. **Tolerances are relative.** An em is 1000 or 2048 units; a detail may be five. Every
   epsilon is normalised against the magnitude of its inputs.
6. **Only `edit-core` mutates.** Renderers read. Tools dispatch. Gesture state lives in the
   tool layer so it never enters the undo stack.

## Credits

The Tunni lines concept was devised by Eduardo Tunni and FontLab Ltd., and is used in the
FontLab font editor.
