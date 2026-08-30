# FontEditor

A browser-based font editor that uses **Tunni lines** as an additional way to control
cubic Bézier splines.

Tunni lines were devised by Eduardo Tunni and FontLab Ltd. The maths in this repository
derives from the reverse-engineering write-up in
[Tunni-Lines](https://github.com/OliverLeenders/Tunni-Lines).

## Status

**Phase 2 — done.** The editing surface works, edits are undoable, and work autosaves
to the browser's private filesystem and comes back on reload. Next is the pen tool,
then phase 3.

| Phase | | Status |
| --- | --- | --- |
| 0 | Foundations and the geometry kernel | done |
| 1 | The editing surface | model, view, renderer and select tool done; pen tool pending |
| 2 | Undo, redo, persistence | done |
| 3 | From paths to a glyph | not started |
| 4 | From a glyph to a font | not started |
| 5 | Binary import and export | not started |
| 6 | Proofing and shaping | not started |
| 7 | Spacing and kerning | not started |
| 8 | OpenType features | not started |
| 9 | Variable fonts | not started |
| 10 | Production polish | not started |

## Getting started

Requires Node 20+ and pnpm.

```bash
pnpm install
```

Then run the playground and open http://localhost:5173:

```bash
pnpm dev
```

Drag nodes, handles, the blue Tunni line and the amber Tunni point. Double-click a
Tunni point to balance the segment. Shift extends the selection, Alt breaks a smooth
node's handle link, arrow keys nudge, Escape cancels a drag. Ctrl-Z undoes and
Ctrl-Shift-Z redoes. Space previews without controls, the wheel zooms, middle-drag
pans, and Ctrl-0 refits.

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
  playground/   A bare harness for driving the surface by hand. Not the editor UI.

packages/
  geometry/     Vec2, cubic Béziers, and the Tunni-line kernel. Pure; no DOM.
  font-model/   Nodes, contours, glyphs. Plain serializable data.
  view/         Design↔screen transforms, hit testing, segment activation. Pure.
  render/       Canvas drawing. Pure draw functions plus a thin surface helper.
  tools/        Pointer and keyboard tools, as pure reducers over editor state.
  edit-core/    Transactions, undo and redo over the document.
  storage/      Autosave to OPFS, in a worker. Local-first; nothing leaves the browser.
```

Packages are consumed directly from TypeScript source — there is no build step until
something needs to ship. Later phases add `edit-core`, `tools`, `font-io`, and an `apps/editor` shell.

### Two decisions worth knowing before reading the code

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
