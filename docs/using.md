# Using Typewright

How the editor's tools and workspaces behave. Press `?` in the editor for every key it
answers to at once.

**Workspaces and panes.** Font, Glyph, Spacing, Features and Proof are the tabs along the
top. The button at the end of the tab bar splits the window, so the drawing can sit beside
the spacing line or the proof, and the second pane's bar stacks the panes or closes it.
The keyboard follows the pane you last pressed in; a glyph opened from the font's grid or
the spacing line is drawn in the other pane when that pane is drawing.

**Windows.** A second font goes in a window of its own. File → New window opens one on the
list of fonts — Ctrl-Shift-N in the desktop application — and the button beside each font
in that list opens the font straight away. Each window is on one font and names it in its
title. The same font in a second window is read-only there, with a button to edit it there
instead.

**Feature source.** The Features workspace colours the file as it is typed, numbers its
lines and marks the ones the compiler has a problem with; pressing a problem in the list
puts the cursor on its line. Tab indents with four spaces, or a level onto every selected
line, and Shift+Tab takes one off; to leave the source by keyboard, press Escape and then
Tab. Enter keeps the indentation, a level deeper after `{`, and a `}` typed on an indented
line goes back a level. Each space shows as a faint dot, so indentation can be counted, and
Ctrl with the wheel sets the text larger or smaller.

**Marks.** The Marks tab beside Features shows the anchors of the master you are editing as
mark attachment: a `markClass` line for each glyph that attaches by an anchor such as
`_top`, grouped by anchor name as `@MC_top`, then `pos base` for the glyphs that offer a
`top` and `pos mark` for the marks others stack on. Editing it edits the anchors — change a
position to move one, add or remove a line to add or remove one — as soon as the file reads
cleanly, and Ctrl-Z takes it back; while it has a problem, no anchor changes. It is written
again from the anchors when you switch files or an anchor moves elsewhere, so comments typed
there are not kept.

**Which way the text runs.** The Spacing bar and the Proof bar each end with three pickers:
direction, script and language. All three start at Auto, which reads them from the text —
type Arabic and it is set right to left, with any Latin or numbers inside it in their own
order. Choose a direction to say so outright, which is what a line of Latin proofed as part
of an Arabic setting needs; a right-to-left proof is set from the right margin. The script
list is the scripts your font has letters for, and the language list is what your feature
file names in its `languagesystem` lines — so a `locl` rule for Turkish can be seen by
choosing Turkish. Each line remembers its own three.

**Names, finding and opening.** In both files, a list of names offers itself under the caret
after two characters: glyph names and keywords, classes after `@`, named lookups after
`lookup`, and feature tags after `feature`. Ctrl+Space opens it at once; the arrows choose,
Enter takes one, and Escape closes it. Ctrl+F finds and Ctrl+H replaces, from a bar over the
source — Enter and Shift+Enter move between matches, and each replacement is one undo step.
Ctrl+click or F12 on a glyph name opens that glyph, in the other pane when the window is
split; holding Ctrl underlines the names that can be opened.

Use PgUp and PgDn to move between glyphs, and press `?` for every key at once. The
toolbar is icons; every one names its shortcut in its tooltip — `V` select, `P` pen, `K` knife, `R` rectangle, `E` ellipse,
`L` ruler. Measuring one stem is **held** rather than switched to: `M` borrows the tool
for as long as the key is down and gives the drawing tool back when it is let go, because
measuring is something you do while drawing rather than instead of it. With the pen, click for a corner point and drag for a smooth one, Alt while
dragging to leave only one handle, click the first point to close, Enter or Escape to
finish open, Backspace to take a point back.

With the select tool: drag nodes, handles, the blue Tunni line and the amber Tunni
point. Double-click a Tunni point to balance the segment. The inspector's Curve section
says the same thing in numbers, in the two dimensions the curve has: **tension** is how
far both handles reach towards where the handle lines cross, and **pan** is how that
reach is split between them. Typing a tension leaves the balance alone, and panning
leaves the tension alone. The pan has a slider and a field beside it, both in percent:
0 is balanced, a positive number leans the reach towards the start of the segment. Type
one to give a second curve the lean of the first, or double-click the slider to come back
to balanced. Double-click a contour — a point of it, a handle, or the curve itself — to select all of
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

**The inspector's sections follow the work.** A section opens when it has something to
say and folds when it has not, with a word beside its title for what it is short of —
_none_, _nothing selected_, _no segment_. Folding or opening one by hand is remembered,
except while it is empty: a Point section held open by yesterday's click would be a column
of dashes. Opening an empty section still works, which is how the buttons inside one are
reached, and it lasts until the section fills or empties again.

**Anchors and components.** Right-click empty canvas to put an anchor down; it is a
small cross, named on hover, dragged like a point and snapped to the same lines. Both an
anchor and a guide stay picked while the arrow keys nudge them and Backspace removes them;
clicking the canvas where nothing is, or dragging a marquee, lets go. The
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

**What comes in.** An OTF, TTF or WOFF opened here brings what the font does as well as
its outlines: kerning into the Spacing workspace, mark attachment as anchors on the glyphs,
and every substitution and positioning rule as feature source in the Features workspace.
What this editor cannot compile yet — cursive attachment, marks on ligatures — is kept in
the source and named in the import report.

**What comes out.** OTF and TTF to install, WOFF and WOFF2 for a web page, a UFO as
source, and — once a font has more than one master — a family as a designspace with a
UFO each, one variable font, and every named style as an ordinary static font. The web
formats are written from the TrueType flavour, which is what WOFF2's transform is for.

**Which glyph is which.** A cell in the font's grid has room for a glyph name and a code
point, which for a mark is `uni0308` above `U+0308` and says nothing about which mark it
is. Rest the pointer on a cell and a tip beside it gives the character, the name the
standard gives it — COMBINING DIAERESIS — the block it comes from, and whether it has been
drawn. A glyph the font has not drawn yet shows the character faintly in one of the
system's own fonts instead of an empty box, with a combining mark on the dotted circle it
is always shown on, so a screenful of empty cells after **Add missing** can be read at a
glance.

**Layers.** The Layers section of the inspector lists the glyph's other drawings — a
background, a sketch — and which one the tools draw in. B draws in the background and back
in the letter. Layers with their eye open show faint behind the drawing, and the letter
always shows behind a layer being drawn in. Copy the drawing into a layer before reworking
it, trade the two once the new one is better, or clear a layer — for the open glyph there,
or for every glyph picked in the grid from its menu. A UFO's layers open as layers and save
back into their own directories.

**A family's designspace.** The Designspace button beside the font info edits what a
`.designspace` says besides its masters: each axis's range as a menu offers it and its map
to where the drawings are, and the rules — a glyph put in place of another where a range
holds, like a dollar sign whose stroke closes up past a weight. Both go into the variable
font and the static styles. A master drawn as a layer of another's UFO opens as a master of
its own; its glyph grid shows the whole font with what it does not draw faint, and opening
one of those offers to draw it there. Whatever else the file said is kept and written back.

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
not to you — the files cannot be opened in a file manager. To keep a font where other
tools can read it, save it to a UFO folder from the File menu.
