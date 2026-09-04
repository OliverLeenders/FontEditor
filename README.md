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

| Phase |                                     | Status                                                                      |
| ----- | ----------------------------------- | --------------------------------------------------------------------------- |
| 0     | Foundations and the geometry kernel | done                                                                        |
| 1     | The editing surface                 | done                                                                        |
| 2     | Undo, redo, persistence             | done                                                                        |
| 3     | From paths to a glyph               | done                                                                        |
| 4     | From a glyph to a font              | browser done; **no way to edit font info** — see below                      |
| 5     | Binary import and export            | done: OTF and UFO both ways; UFO output unverified by other tools           |
| 6     | Proofing and shaping                | proofing done; **nothing is shaped** — no feature is applied                |
| 7     | Spacing and kerning                 | done; groups can be read and broken out of, but not edited                  |
| 8     | OpenType features                   | a `.fea` subset compiles to GSUB; no positioning rules, no contextual       |
| 9     | Variable fonts                      | not started                                                                 |
| 10    | Production polish                   | lint, format and 1163 tests; no CI, and view preferences are lost on reload |

### What the table is hiding

The gaps worth naming, in the order they would bite someone using this:

- **Font info cannot be edited.** Family, style, units per em and the vertical metrics
  exist in the model and are read from an imported file, but nothing in the interface
  writes them — a font drawn from scratch exports as "Untitled Regular" at 1000 upem.
- **The proof does not apply features.** Kerning is laid out, substitution is not, so a
  ligature that compiles into the exported font cannot be seen before exporting it.
  The proof shows the glyphs the characters map to, one for one.
- **Overlap removal declines edges that lie along each other**, and does not look at a
  contour that crosses itself. Both refuse rather than guess, which is the right
  failure, and both are real shapes a designer will draw.
- **Kerning groups** are modelled, imported, exported and shown, but there is no way to
  create or change one from the interface.
- **View preferences do not survive a reload** — outline weight, handle visibility,
  snapping, and the type sizes in Spacing and Proof all return to their defaults.
- **The UFO writer has never been read by anything but itself.** The importer round-trips
  it, which proves consistency, not correctness.

## Getting started

Requires Node 20+ and pnpm.

```bash
pnpm install
```

Then run the editor and open http://localhost:5174:

```bash
pnpm dev
```

The playground is a bare canvas harness kept for isolating rendering and tool problems
without the interface around them:

```bash
pnpm dev:playground
```

Use PgUp and PgDn to move between glyphs. The toolbar is icons; every one names its
shortcut in its tooltip — `V` select, `P` pen, `K` knife, `R` rectangle, `E` ellipse,
`M` measure. With the pen, click for a corner point and drag for a smooth one, Alt while
dragging to leave only one handle, click the first point to close, Enter or Escape to
finish open, Backspace to take a point back.

With the select tool: drag nodes, handles, the blue Tunni line and the amber Tunni
point. Double-click a Tunni point to balance the segment. Shift extends the selection,
Alt breaks a smooth node's handle link, arrow keys nudge, Backspace deletes selected
points, `R` reverses the contour, and Escape cancels a drag. Ctrl-Z undoes and
Ctrl-Shift-Z redoes.

**Right-click anything on the canvas.** A point offers corner/smooth, an axis lock,
reverse contour and delete. A handle offers the axis lock, its node's type, retract,
and reverse. A segment offers insert-point-here, line/curve conversion, balance and
reverse. Which items appear depends on what is under the pointer, using the same hit
index the tools use — the menu can never offer an action for something the canvas is
not showing. Space previews without controls, the wheel pans, Ctrl-wheel zooms at the
cursor, middle-drag pans, and Ctrl-0 refits. Ctrl-wheel also sets the type size in the
Spacing and Proof workspaces.

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
  playground/   A bare canvas harness, for isolating rendering and tool problems.

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
