# FontEditor

A browser-based font editor that uses **Tunni lines** as an additional way to control
cubic Bézier splines.

Tunni lines were devised by Eduardo Tunni and FontLab Ltd. The maths in this repository
derives from the reverse-engineering write-up in
[Tunni-Lines](https://github.com/OliverLeenders/Tunni-Lines).

## Status

**A font drawn here can be exported and installed.** Five workspaces — Font, Glyph,
Spacing, Features, Proof — around a canvas with select, pen, knife, rectangle, ellipse
and measure tools, snapping, boolean union, components, kerning, a `.fea` subset, and
OTF and UFO in both directions. Everything autosaves.

| Phase |                                     | Status                                                            |
| ----- | ----------------------------------- | ----------------------------------------------------------------- |
| 0     | Foundations and the geometry kernel | done                                                              |
| 1     | The editing surface                 | done                                                              |
| 2     | Undo, redo, persistence             | done                                                              |
| 3     | From paths to a glyph               | done                                                              |
| 4     | From a glyph to a font              | done                                                              |
| 5     | Binary import and export            | done: OTF and UFO both ways; UFO output unverified by other tools |
| 6     | Proofing and shaping                | done for this editor's `.fea` subset — see below                  |
| 7     | Spacing and kerning                 | done                                                              |
| 8     | OpenType features                   | a `.fea` subset compiles to GSUB and GPOS — see below             |
| 9     | Variable fonts                      | not started                                                       |
| 10    | Production polish                   | lint, format and 1556 tests, run on CI; preferences persist       |

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
- **Overlap removal declines edges that lie along each other.** Two shapes sharing a
  whole edge have no crossing points to split at, so it refuses rather than guesses,
  which is the right failure for a shape a designer will really draw. A contour that
  crosses itself is handled, including a single curve that loops.
- **The UFO is checked against fontTools on every push.** A proof font covering curves,
  components, composites, case-colliding names, groups, class kerning and features is
  exported, read by `fontTools.ufoLib` with validation on, compiled by `feaLib`, written
  back out by fontTools and imported again — see `tools/ufo-check`. What is still
  unproven is the OTF against a rasteriser, and the UFO against the editors people
  actually use, which agree with fontTools about the format and not always about what a
  font should contain.

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
`M` measure. With the pen, click for a corner point and drag for a smooth one, Alt while
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
