# Development

Building, testing and releasing Typewright, and how the code is laid out. The
[README](../README.md) says what it is; the [roadmap](roadmap.md) says where it is going.

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
pnpm --filter @typewright/editor app
```

and to make an installer:

```bash
pnpm --filter @typewright/editor app:build
```

This is [Tauri](https://tauri.app), which is a Rust program that opens a window and points
the operating system's own webview at the editor. Building it needs a Rust toolchain
(`rustup`), and on Windows the MSVC build tools and the WebView2 runtime — the last of
which ships with Windows 11.

Tauri rather than Electron for one reason that matters here and one that does not. The one
that does not is size: the Windows installer is 16.5 MB against something like 150, because
the browser is the one already on the machine rather than a second copy of Chromium. Most of
those megabytes are ttfautohint, 73 MB unpacked; before it was bundled the installer was
2.4 MB. The Linux AppImage is 95 MB, because it brings the webview's libraries with it
rather than relying on the system's. The one
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

Nothing in `src-tauri` knows anything about fonts. It opens windows and gets out of the
way: a logger in debug builds and the updater, and eight commands — two about closing a
window, one that opens another, one that names a window after its font, one that counts
the other windows, one that runs ttfautohint, and two that check for and install an
update. The first window is labelled `main` and later ones `font-1`, `font-2` and on; the
capability in `capabilities/default.json` covers both, and only `main` offers updates. Whether a
close needs a question belongs to the page, the only side that knows whether the folder is
behind, so the window hands the request over and waits to be told. The page reaches those
commands through the bridge Tauri injects into every page it hosts rather than through
`@tauri-apps/api`, and in a browser that bridge is simply not there — which is what keeps
the browser and the desktop builds the same program rather than two that have started to
drift.

The desktop build keeps its working copies in a WebView2 profile of its own, under
`%LOCALAPPDATA%\dev.typewright.app` on Windows. That is separate from any browser's, so a
font started in one is not in the other until it has been saved to a folder and opened
there.

A release is a version and a tag. `pnpm version:set 0.2.0` writes the version everywhere
it is kept; commit that, tag the commit `v0.2.0` and push the tag, and
`.github/workflows/release.yml` builds the installers into a draft release to try and then
publish. The updates it produces are signed with a key held only in the repository's
secrets, whose public half is in `tauri.conf.json`. A build made anywhere else can install
the published updates but cannot sign any of its own, and a debug build never looks.

## Tests

```bash
pnpm test
```

```bash
pnpm typecheck
```

The same checks run on every push, with fontTools and FreeType reading and drawing what the
exporter writes; see `.github/workflows/ci.yml`.

## The browser build, hosted

The editor is a folder of static files with no server behind it, so hosting it is serving
that folder over HTTPS. It is published to [Cloudflare Pages](https://pages.cloudflare.com)
when a version is tagged, by `.github/workflows/web.yml`, from the same bundle the desktop
installers embed.

Two things travel with the build rather than living in a dashboard, both written by the
`hostFiles` plugin in the editor's Vite config:

- **`_headers`** — the content security policy, taken from the desktop window's own policy
  in `tauri.conf.json` with the parts only Tauri can use removed, plus `nosniff`, a
  referrer policy, and caching: the page itself is checked every time, and everything under
  `/assets` is kept for a year because its name holds a hash of its contents.
- **`_redirects`** — everything to `index.html`, for a stray deep link.

Netlify reads the same two files, and any other host wants the same headers said its own
way. What matters is that `.wasm` is served as `application/wasm`: HarfBuzz will not
instantiate otherwise.

Publishing needs two repository secrets, both from Cloudflare — `CLOUDFLARE_API_TOKEN`,
scoped to Pages, and `CLOUDFLARE_ACCOUNT_ID`. Without them the workflow says so and does
nothing, so a fork is not red for a site it does not publish.

## Layout

```
apps/
  editor/       The editor: shell, panels, and the canvas.
    src-tauri/  A window for it on the desktop. Rust, and nothing about fonts.

brand/          The mark, and the script that draws every icon size from it.

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
  stuffit/      StuffIt archives and Macintosh resource forks. Knows nothing about fonts.
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
