# FontEditor

A browser-based font editor that uses **Tunni lines** as an additional way to control
cubic Bézier splines.

Tunni lines were devised by Eduardo Tunni and FontLab Ltd. The maths in this repository
derives from the reverse-engineering write-up in
[Tunni-Lines](https://github.com/OliverLeenders/Tunni-Lines).

## Status

**A font drawn here can be exported and installed.** Five workspaces — Font, Glyph,
Spacing, Features, Proof — around a canvas with select, pen, knife, rectangle, ellipse
and measure tools, snapping, boolean union, anchors and components, kerning, a `.fea` subset, and
OTF and UFO in both directions. Everything autosaves.

| Phase |                                     | Status                                                            |
| ----- | ----------------------------------- | ----------------------------------------------------------------- |
| 0     | Foundations and the geometry kernel | done                                                              |
| 1     | The editing surface                 | done                                                              |
| 2     | Undo, redo, persistence             | done                                                              |
| 3     | From paths to a glyph               | done, and anchors with it                                         |
| 4     | From a glyph to a font              | done                                                              |
| 5     | Binary import and export            | done: OTF and UFO both ways; UFO output unverified by other tools |
| 6     | Proofing and shaping                | done for this editor's `.fea` subset — see below                  |
| 7     | Spacing and kerning                 | done                                                              |
| 8     | OpenType features                   | a `.fea` subset compiles to GSUB and GPOS, and anchors to marks   |
| 9     | Variable fonts                      | not started                                                       |
| 10    | Production polish                   | lint, format and 1674 tests, run on CI; preferences persist       |

### What the table missed

Ten phases were enough to get a font out of the door and not enough to describe the
work. These are the things that turned out to be missing from the plan rather than
from the code — some now done, the rest in roughly the order they would be reached
for.

| What is missing                            | State       | Why it is missing                                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anchors and mark attachment**            | done        | Not a phase at all, and it belongs to two: a glyph carries them, and they compile. Placing accents by hand is the thing this replaces.                                                                                                                                                                   |
| **Not dropping what we do not understand** | half done   | Twice now a reader has quietly discarded what it had no field for — anchors from a `.glif`, then anchors from our own autosave. Both are fixed; guidelines, notes, glyph `lib` and every `fontinfo` key beyond seven are still discarded, and a UFO from another tool comes back poorer than it went in. |
| **Font metadata**                          | not started | The info model holds seven fields. A released font also needs a version, a licence, a designer, an italic angle, weight and width classes, a vendor id, and typographic family names — without which an italic does not announce itself as one and a family of more than four styles groups wrongly.     |
| **Curve quality**                          | done        | The curvature comb reads a join, the inspector gives the radius either side of a node and how far apart they are, and harmonising moves the node to where they agree.                                                                                                                                    |
| **Guides, and something to trace**         | not started | A glyph holds no guides of its own, and there is no way to put a scan or a reference letter behind the drawing.                                                                                                                                                                                          |
| **Masters**                                | not started | Phase 9 is written as though variable fonts were an export format. The prerequisite is in the model: a glyph with more than one set of points, and a way to move between them.                                                                                                                           |
| **A file on disk**                         | done        | A UFO folder is opened, saved back to, and remembered for next time, through the File System Access API. Saving is manual: the working store autosaves, and a folder the user chose is somewhere the editor is a guest.                                                                                  |
| **`glyf` outlines**                        | not started | Everything written is CFF. A TrueType flavour is what hinting and most web pipelines want, and it is also the outline format that permits the overlaps this removes.                                                                                                                                     |
| **Preflight**                              | not started | Open contours, duplicate points, off-grid coordinates, a composite whose base is missing, an accent with no anchor to land on: all findable, none reported anywhere.                                                                                                                                     |
| **Testing the interface**                  | not started | Every package below `apps/editor` is tested; the React in it is not, for want of a DOM testing library.                                                                                                                                                                                                  |

### What the table is hiding

The gaps worth naming, in the order they would bite someone using this:

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

## Getting started

Requires Node 22.13+ and pnpm.

```bash
pnpm install
```

Then run the editor and open http://localhost:5174:

```bash
pnpm dev
```

Use PgUp and PgDn to move between glyphs. The toolbar is icons; every one names its
shortcut in its tooltip — `V` select, `P` pen, `K` knife, `R` rectangle, `E` ellipse,
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

**Two rulers.** Hold `M` and point at a stem: the reading is taken square to the outline,
which is what a stem width is — a straight line dragged across a round letter measures a
chord instead, and answers a different question. Click to pin the reading, let the key go
to carry on drawing. `L` is the other kind: drag a line across the whole letter and every
width along it is measured in a row — stem, counter, stem — with the stretches of ink
told apart from the gaps between them. Shift holds the line to an eighth-turn, Escape
takes it away, and it stays where it was put while you work under it.

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

packages/
  geometry/     Vec2, cubic Béziers, and the Tunni-line kernel. Pure; no DOM.
  font-model/   Nodes, contours, glyphs. Plain serializable data.
  view/         Design↔screen transforms, hit testing, segment activation. Pure.
  render/       Canvas drawing. Pure draw functions plus a thin surface helper.
  tools/        Every tool, as pure reducers over editor state.
  edit-core/    Transactions, undo and redo over the document.
  storage/      Autosave to OPFS, in a worker. Local-first; nothing leaves the browser.
  disk/         The user's own UFO folder, opened, read and written where they can see it.
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
