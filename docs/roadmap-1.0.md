# The road to 1.0

A draft, written at 0.1.109. The [roadmap](roadmap.md) says how Typewright got here; this
says what stands between here and a version that can be called 1.0, and in what order.

The scope was settled on 2026-10-13 and is recorded under [Decisions](#decisions). The
version after 0.1.109 is 0.2.0.

## What 1.0 should mean

A version number a stranger can rely on. Four promises:

1. **A font made in it is a correct font.** What is exported passes the checks the industry
   uses, on every format offered, and looks the same as it did on the canvas.
2. **It does not lose work.** Not on a crash, a full disk, a closed tab, a bad file, or an
   update.
3. **What 1.0 saves, every 1.x opens.** The working copy and the files on disk have a format
   that is written down, versioned, and migrated.
4. **What it offers is finished.** Every feature on the menu works in every master, every
   layer and every export, or says plainly that it does not. No feature is half of itself.

A feature list is the smaller part of this. Most of the distance is in the second half of
each sentence.

## Where it stands

Read from the code, the tests, CI and the roadmap at 0.1.109.

### What is strong

- About 174,000 lines, of which about 71,000 are tests: 312 test files, roughly 4,700 tests.
  The source has two `TODO`-like comments and one lint suppression.
- Exports are checked by other people's software on every push: fontTools reads, compiles and
  instantiates them, FreeType draws them, HarfBuzz sets them against the originals.
- Six real families and Noto Nastaliq Urdu are taken round and compared by ink and by shaping.
- The store is walked at random and stopped after every single file write.
- A real browser opens, edits, reloads, exports and re-imports on every push.

### Half done

| What                                  | State                                                                                                                                                                                                                                                                                                                         | Evidence                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Strokes in a variable font            | Four cases fall back to the default master's ink at every weight: a cut part that begins mid-segment, a cornered pen pivoting through a point (12 of 102 cases in the sweep), a turning pen whose masters' sides differ, and broad-in-one-master, oval-in-another. Also a Step blend and masters with different curve counts. | `docs/roadmap.md`, "Open"                         |
| Fit to fixed width                    | Fits the main drawing only, not the layers behind it.                                                                                                                                                                                                                                                                         | `docs/roadmap.md`, "Open"                         |
| Snapping to the grid                  | A node now lands on the grid (0.1.109); a component is still moved by a rounded offset and keeps its distance from the grid.                                                                                                                                                                                                  | `packages/tools/src/gestures.ts`, `dragComponent` |
| Overlap removal                       | One icon of 4,042 (`font_download_off`, edges lying along each other) is refused; the overlap goes into the font with a warning.                                                                                                                                                                                              | fidelity notes, to be re-measured                 |
| Table sizes                           | GPOS for Noto Sans and Source Sans last measured at 1.6–1.8 times the original. Not looked at.                                                                                                                                                                                                                                | fidelity notes, to be re-measured                 |
| Hinting                               | TrueType only, desktop only, by ttfautohint. An OTF carries no blue zones or stem widths: the model has no fields for them and the exporter writes none.                                                                                                                                                                      | no reference in `packages/font-io/src`            |
| Browsers                              | Saving to a folder needs a directory picker only Chromium has. What a Firefox or Safari user gets is not stated anywhere and not tested.                                                                                                                                                                                      | `packages/disk/src/access.ts`                     |
| A failure while drawing the interface | No error boundary was found: an exception thrown while a panel renders has nothing to catch it.                                                                                                                                                                                                                               | no `ErrorBoundary` in `apps/editor/src`           |
| A full disk                           | No handling of the browser's storage quota was found.                                                                                                                                                                                                                                                                         | no reference in `packages/storage/src`            |
| The user guide                        | Kept up closely (serifs, pens, designspace are there). The SVG export of one glyph is not.                                                                                                                                                                                                                                    | `docs/using.md`                                   |
| Releases                              | 17 published of about 110 tagged. No changelog in the repository. Installers unsigned; no macOS build.                                                                                                                                                                                                                        | GitHub releases, `docs/roadmap.md` "Parked"       |

### Not yet robust

- **The stroke engine is still moving.** Nearly every release from 0.1.85 to 0.1.108 changed
  how a stroke becomes ink, and several were fixes to the release before. `convolution.ts`
  (2,376 lines), `stroke.ts` (1,706) and `overlap.ts` (1,515) are the three largest files of
  logic in the project and the three most recently rewritten. A 1.0 needs them to have stood
  still for a while with real drawings going through them.
- **The saved format has never been migrated.** `SCHEMA_VERSION` is 1 and the migration
  scaffold has no migration in it. The model has grown a great deal under that one number
  (layers, pens, cuts, serifs, grid, designspace). Nothing proves that a working copy written
  by 0.1.30 opens in 0.1.109.
- **Files from outside are trusted to be well formed.** Seven parsers read what a user hands
  them: binary fonts, UFO (plist and glif), designspace, feature source, SVG, StuffIt archives
  and Macintosh resource forks. Property tests exist for the Tunni geometry and nowhere else.
  What a truncated or hostile file does — an error, a hang, a font quietly wrong — is unknown.
- **Timing.** A test timed out on CI at 0.1.106 and another locally at 0.1.109. Both were load,
  not faults. The limits are raised; the lesson is that the suite is near its limits and nothing
  measures how long anything takes.
- **Release cadence.** 109 versions in four weeks is the pace of building, not of a product
  people have installed. There has been no period in which the application was only used.

### Not tested, or tested less than it is used

| What                      | State                                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows                   | Installers are built for Windows and no test has ever run there. All of CI is Linux. Paths, line endings, the file system and the webview all differ.                                                               |
| The desktop shell         | 291 lines of Rust with no tests. CI checks that it compiles. Windows per font, the question on closing, the updater and ttfautohint are exercised by hand. The updater has been seen to work once (0.1.0 to 0.1.1). |
| The browser suite         | Three files, about ten scenarios, Chromium only. Opening and saving a folder is not covered, because the picker cannot be driven.                                                                                   |
| The deep stroke checks    | The full sweep of every stroke case is behind `STROKE_DIAGNOSE` and runs only when somebody asks.                                                                                                                   |
| The long random walk      | 600 seeds by 90 steps is a manual run. CI runs the default handful.                                                                                                                                                 |
| Coverage                  | Not measured. "Every panel is rendered by a test" is known; which branches of the model no test reaches is not.                                                                                                     |
| The corpus                | Latin, one Arabic in Nastaliq style. No Indic script, no CJK, no font near the glyph limit, nothing with vertical metrics.                                                                                          |
| Other editors             | The UFO is proved against fontTools. It has not been opened in Glyphs, RoboFont, FontForge or Fontra. The roadmap says so itself.                                                                                   |
| The industry's validators | Neither Font Bakery nor the OpenType Sanitizer (what Chrome and Firefox run before they will use a web font) is in CI.                                                                                              |
| Accessibility             | 280 ARIA attributes and no audit: no automated check, no pass with a screen reader, no check that every command is reachable by keyboard.                                                                           |
| Performance               | One browser test opens a large font. No budgets, no benchmarks, nothing that fails when a release is slower than the last.                                                                                          |
| Small packages            | `stuffit` (1,687 lines, 558 of tests), `preflight` (one test file for 21 checks), `shaping` (one test file).                                                                                                        |

## Milestones

Each is a minor version. Each ends when its exit conditions hold, not on a date. The order
puts what could change the saved format or the model first, and what only proves things last.

### 0.2 — Finish what is started

No new features. Everything on the menu works everywhere it is offered.

- Every stroke that can be drawn varies in a variable font. The cases that fall back today to
  the default master's ink are followed: a cut part that begins part way along a segment, a
  pen of corners pivoting through a point of the path or at an open path's end, a turning pen
  whose masters' sides are not the same stretches, a pen that is broad in one master and oval
  in another, a Step blend. Masters whose paths differ in their number of curves cannot
  interpolate at all, and are said to be incompatible by the masters check rather than
  quietly not varying.
- The full sweep of stroke cases holds for every one of them, in the single font and in the
  variable one, before this milestone closes: it is the last change to how a stroke becomes
  ink before the beta.
- Fit to fixed width in every layer.
- A component dragged lands on the grid.
- The refused union, and an inventory of every place the code warns and carries on.
- An error boundary round each workspace: a panel that throws says so and the rest stays up.
- Storage that is full is noticed, said on the status line, and loses nothing.
- Firefox is supported: everything but saving to a folder, which Firefox has no picker for,
  and the File menu says so there. What else differs in Firefox is found and fixed.
- The user guide caught up, and a `CHANGELOG.md` kept from here on.

**Exit:** the "Open" list in the roadmap is empty or each item is a documented limit.

Done so far, since 0.1.110:

- Fit to fixed width takes the layers behind the drawing along.
- A component dragged lands on the grid.
- Firefox opens a font at all. It did not: the font was read and then waited behind the pane
  that says it is being opened, for an answer to whether its storage may be kept, which
  Firefox asks the person for. And a font opens from the list of fonts after a reload was
  once called off, where Firefox left `location.reload()` doing nothing.
- A font's glyphs are packed into one file in the working copy, with the glyphs changed since
  as files beside it. Firefox takes thirty milliseconds to open a file to write whatever is
  written to it, and a font of four thousand glyphs took three minutes to save there; it
  takes two seconds, and five became two in Chromium. This is the first change to the saved
  format with a migration: a working copy from before is read as it is and packed when it is
  opened, and a build from before cannot see a packed one, where it would have cleared it away.
- The browser tests pass in Firefox as they do in Chromium, fourteen of fourteen, run with
  `BROWSER=firefox`. Not yet on CI, which is 0.3.

- Storage that is full is said as that on the status line, and what was not saved is tried
  again without anything being drawn: after five seconds, and twice as long each time up to a
  minute. A whole font there was no room to write — one being opened, a master gone to — is
  owed and written whole when there is room, where it was never tried again. Closing the tab
  on a save that failed asks first.

- The inventory of what is warned of and carried on past. What an export leaves out, and an
  SVG, were already said in full. Four things were said as a number or not at all, and are
  said on the status line now with a line to each: glyphs the browser's copy of a font could
  not give back (said only to the console), the warnings of a font file or a folder opened
  ("3 warnings", and which three nowhere), and the glyphs a master gone to or a copy put back
  came without.
- The refused union is no longer refused. Measured again, the four thousand icons are read
  and written with no warning at all, and in eight seconds where the notes said twenty-six;
  whichever change to the joining mended it, a test now asks it of every icon.

- The user guide caught up — one glyph as an SVG, what a save that did not happen says,
  which browsers — and a `CHANGELOG.md` begun, kept from 0.1.110.

- A workspace that throws while it is drawn takes its own pane and no more: the pane says the
  view stopped, that the font is as it was, and offers to draw it again, and the status line
  says what was thrown. It took the window.
- The File menu in a browser with no way to be handed a folder says why the folder is not on
  it, and what to do instead.

Found on the way, and not yet looked at: the desktop window on Linux has no way to be handed
a folder either, so a font cannot be saved to a folder there. Still to do for full storage: the desktop window's own question on closing does not yet ask about a
save that failed, and nothing offers to make room (the copies under History are the largest
thing kept).

### 0.3 — Tested where it runs

- The whole suite on Windows in CI, beside Linux: the two platforms an installer is built for.
- The desktop shell driven by a test: open a window per font, close with unsaved work, hint a
  TrueType, and take an update from one build to the next.
- The browser suite in Firefox as well as Chromium, every scenario in both.
- The browser suite in WebKit too, which is Safari's engine and runs free on Windows and
  Linux. Safari itself cannot be tried by hand here, and the site says so.
- A stand-in for the folder picker, so opening and saving a folder is tested in a browser.
- Coverage measured and published; a floor set from what it finds, raised each milestone.
- A nightly run for what is too slow for a push: the full stroke sweep, the long random walk.
- Test durations recorded, and a test that takes more than half its limit reported.

**Exit:** every platform an installer is built for runs every test; no test is skipped
without a nightly run that includes it.

Done so far:

- The whole suite runs on Windows in CI, and passes there.
- The browser tests run in Chromium, Firefox and WebKit in CI, as a job each. Firefox stops a
  push as Chromium does. WebKit on Linux keeps a font as the others do; it does not yet stop a
  push, until it has been seen to pass a few times.
- Saving to a folder and opening one are tested in a browser. What stands in for the picker
  hands the editor a folder of the browser's private file system, which is a real handle with
  the same things to ask of it, so everything after the picker is the editor's own code on
  the browser's own files: the UFO made inside the folder, the one glyph's file rewritten by
  the next save, the folder remembered across a reload, a font read back out of it. Run in
  the Chrome or Edge that is installed: the browser Playwright fetches goes down when such a
  folder is read back out of the database, which is its fault and not the editor's.
- WebKit on Windows cannot be tested at all, and this is Playwright's build of it and not
  Safari: its file system has no access handles to give, and what is written to a file by
  stream never arrives. The editor says _not saving_ there, which is true. So WebKit is tried
  on CI and not on this machine.

### 0.4 — Files from anywhere

- Property and fuzz tests for all seven parsers. The rule for each: any bytes at all give
  either a font or an error with a reason, within a time limit, and never an exception
  nobody caught.
- A corpus of broken files kept beside the corpus of good ones: truncated, zero-length,
  recursive components, offsets past the end, a plist that is not a plist.
- The good corpus widened: an Indic script, a CJK font, a colour font (to see it refused
  properly), a font with vertical metrics, a font at the glyph limit.
- Failure injected into storage as crashes already are: a write that fails, a read that
  returns half a file, a quota reached mid-save.

**Exit:** a week of fuzzing on CI finds nothing new.

### 0.5 — A correct font, by other people's measure

- Font Bakery and the OpenType Sanitizer in CI on every proof font and every corpus font.
  Each failure fixed or listed as accepted with a reason.
- Microsoft's Font Validator on the Windows job.
- The UFO opened and saved by at least two other editors and compared; differences fixed or
  written down.
- Table sizes: GPOS re-measured against the originals and brought within a stated factor.
- **Hinting values in the OTF.** A Hinting section in Font info: alignment zones and
  standard stem widths, suggested by measuring the font and editable, written into the OTF's
  private dictionary and kept in the UFO's own fields. Scaled with the em, checked by
  preflight (zones that overlap, an overshoot outside its zone), read back by fontTools in
  CI. Per-glyph stem hints are not part of it. The layout of the section is settled together
  before it is built.
- **A proof on paper.** The Proof workspace written out as a PDF, set with the font as it
  would be exported and embedded in the file, so it prints as it will print anywhere. What
  goes on a page, and where the command lives, are settled together before it is built.

**Exit:** every export of every corpus font passes the sanitizer and has no Font Bakery
failure that is not on the accepted list.

### 0.6 — A format that is kept

- The working copy's schema written down as a document, field by field.
- A working copy saved by each published version kept as a fixture, and a test that every one
  opens in the current build and saves without loss. The same for folders on disk.
- The first real migration written, so the path is proved before it is needed in anger.
- A newer file opened by an older build is refused with a message, not half read.
- The rule stated: from 1.0, a change to the saved format comes with a migration and a fixture.

**Exit:** the format is frozen for the 0.9 series; any change after this needs a migration.

### 0.7 — Fast enough, and still fast tomorrow

- Budgets written down: time to open a font of 500, 5,000 and 50,000 glyphs; time for a drag
  to answer; time to export; memory held.
- Benchmarks run on CI, compared with the last release, failing on a stated regression.
- Whatever the budgets show is too slow, fixed. The packed font file is the known next step
  for opening large fonts.

**Exit:** every budget met on the reference machine, and the benchmark job is required.

### 0.8 — Something a stranger can install

- The installers stay unsigned. The download page explains the SmartScreen warning and what
  to press, and gives a checksum for each file.
- The updater tested from every published version to the current one.
- An accessibility pass: automated checks in the interface tests, every command reachable by
  keyboard, one full session with a screen reader, contrast checked in both themes.
- The user guide complete and read through against the application, a getting-started page,
  and the site saying what the application does and does not do.
- A way to report a problem from inside the application, with the version and the last
  warnings attached, and nothing sent without being asked.

**Exit:** somebody who has never seen it installs it, draws three glyphs, exports a font and
installs that, from the documentation alone.

### 0.9 — Beta

- Feature freeze. Fixes only.
- The stroke engine untouched except for faults, for the whole series.
- Real use: at least one complete typeface and one icon set made in it from nothing to a
  shipped font, by somebody other than its author if that can be arranged.
- Every fault found gets a test before it gets a fix.
- Release candidates published, each one lived with for at least a week.

**Exit, and the 1.0 checklist:**

- [ ] No open fault that loses work or writes a wrong font.
- [ ] No silent fallback: everything the application cannot do, it says.
- [ ] Every test on every platform an installer is built for.
- [ ] Sanitizer clean; Font Bakery clean against the accepted list.
- [ ] Every published version's files open.
- [ ] Budgets met.
- [ ] Two weeks on the last release candidate with nothing found.

## Not in 1.0

Proposed, and already parked in the roadmap: colour fonts, vertical metrics and vertical
setting, a second font in a pane, the remaining Macintosh containers. Proposed in addition:
scripting or plug-ins, importing other editors' own formats (`.glyphs`, `.vfb`), TrueType
instructions written by hand.

Each of these is a 1.x feature that adds to the format rather than changing it, which is what
makes it safe to leave.

## Decisions

Made by Oliver on 2026-10-13.

- **Nothing that costs money.** No installer is offered for a system where offering one has
  to be paid for, and no certificate is bought. Windows and Linux installers cost nothing
  and stay, unsigned. SignPath's free signing for open-source projects is not applied for.
- **No macOS build**, signed or not. A Mac user has the browser build.
- **Firefox is supported**, without saving to a folder, and tested beside Chromium.
- **Safari is tested as WebKit** in the browser suite, and described as expected to work
  and not tried by hand.
- **Every stroke varies.** The hard cases in a variable font are followed, not refused.
- **Hinting values go into the OTF**: the font-wide ones, in 0.5, before the format is
  frozen. Automatic per-glyph hints come after 1.0.
- **A PDF proof is in**, in 0.5: the one new feature besides hinting.
- **Version numbers**: 0.1.109 is followed by 0.2.0, and each milestone is a minor version.

Still open: how long the beta is. The checklist says two weeks on the last candidate.

### What "hinting values" means

Hinting is advice a font carries for drawing itself at small sizes, where a stem is one or
two pixels thick and a letter is a dozen pixels tall. An OTF holds it in two parts.

**Font-wide values**, a handful of numbers for the whole font:

- _Alignment zones_ ("blue values"): the heights letters stand at, each with its overshoot.
  The baseline and how far an o dips below it, the x-height and how far an o rises above it,
  the same for capitals, ascenders and descenders.
- _Standard stem widths_: how thick a typical upright stem and a typical bar are.

**Per-glyph hints**: for each glyph, where its stems and bars are.

What they do: at text sizes on Windows, and in some PDF and print software, the rasteriser
uses the zones to put every x-height on the same row of pixels and to leave the overshoot
off until there are enough pixels to show it, and uses the stem widths to keep stems the
same thickness. Without them a line of small text has letters of slightly different heights
and stems of different weights. macOS ignores hinting, a high-resolution screen hides most
of the difference, and an icon font or a display face does not need it at all.

A TrueType export can already be hinted on the desktop by ttfautohint. The font-wide values
are what 1.0 adds for an OTF; finding each glyph's stems automatically is a large piece of
work, and comes after.
