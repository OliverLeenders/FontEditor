# Using Typewright

How the editor's tools and workspaces behave. Press `?` in the editor for every key it
answers to at once.

**Workspaces and panes.** Font, Glyph, Spacing, Features and Proof are the tabs along the
top. The button at the end of the tab bar splits the window, so the drawing can sit beside
the spacing line or the proof, and the second pane's bar stacks the panes or closes it.
The keyboard follows the pane you last pressed in; a glyph opened from the font's grid or
the spacing line is drawn in the other pane when that pane is drawing.

**Finding a command.** Ctrl-K opens a list of every command there is right now — the
workspaces, the tools, what can be done to the glyph and to the selection, undo and redo,
and the File menu's items — over whatever is on screen. Type part of a name to narrow it:
the ones starting with what you typed come first. The arrows choose, Enter runs and Escape
closes. Each row names the key that does the same thing, where there is one, as the menus
do. It goes to a glyph as well: type its name, its character, its code point or what it is
called — `dotless` — and the glyphs found are listed with the commands, the one typed in
full above them all. A character the font has not got is offered to be made, and opened.
Next glyph and Previous glyph are there too, as PageDown and PageUp are.

**The bars at the edges.** The strip at the top of the window names the font, where it is
kept on disk — or that it is not saved to disk yet — and marks it with a dot while there
are changes not written there. The status bar at the bottom counts the selected points,
gives the size of what is selected when there is more than one, and says where the pointer
is on the canvas, in font units.

**The undo history.** The arrow beside the gear at the top right, or Ctrl-Shift-H from
anywhere, lists every step Ctrl-Z can take back, newest at the top, each named with the
glyph it changed and how long ago — a width set on the spacing line and a rule typed in
the feature file are steps of the same list as a point moved in the drawing. Press a step
to go straight to the font as it was after it; the steps above it stay in the list,
fainter, to go forward to again, until the next edit lets them go. **As opened**, at the
bottom, is the font before the first step. Going to a step that changed another glyph opens
that glyph, in the drawing or the glyph grid; on the spacing line and in the proof it
becomes the current glyph without turning the pane into a drawing. The list holds the last
two hundred steps, for as long as the font is open; the copies of the whole font kept as
you work are under **History** in the Font workspace.

**Two drawings at once.** The drawing is the one workspace a split window may show
twice, since what each canvas shows is its own. Both draw the same glyph with the same
camera; the inspector and the glyph strip stay single and follow the pane the keyboard is
in.

**Windows.** A second font goes in a window of its own. File → Open another window opens one on the
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

**An accent on an accent.** A mark that carries a place of its own — an acute with a `top`
above it — is one others stack on. An accent stacks on the accent before it among the marks
of its own kind: with a dot below typed between two accents above, the second still sits on
the first. The Marks tab shows this as the `mkmk` feature, each kind under a
`lookupflag UseMarkFilteringSet` line that lists the marks it looks at; the list is worked
out from the anchors and is not a thing to edit there.

**An accent that attaches two ways.** A dot may sit at one height on round letters and at
another on tall ones. Give the mark an attaching anchor for each — `_top` and, say,
`_high` — and give each letter the place it offers, `top` or `high`. The exported font sets
the mark by whichever the letter has. Where a letter has both, the anchor that comes later on
the mark is the one that stands; the order is the order the anchors were added to the mark.
The Marks tab shows the mark in a class for each anchor, and the letters' rules in a lookup
for each.

**Letters joined to the next.** In a script written joined up and on a slope, such as
Nastaliq, a letter sits where the one before it left off. Give a glyph an anchor named
`entry` where it is joined to and one named `exit` where the next joins it; a letter that
only begins a word has no entry, and one that only ends it no exit. The exported font sets
each glyph's entry on the exit of the one before, keeps the last letter of the word on the
line, and passes over accents in between. The Marks tab shows them as `pos cursive` in a
`curs` feature, entry first and then exit, `<anchor NULL>` for the one a glyph has not got.

**Accents on a ligature.** A ligature is several letters in one glyph, and an accent typed
after the second of them belongs over the second. Give the ligature an anchor for each part,
numbered from one: `top_1` over the first letter, `top_2` over the second, the same for
`bottom` or whatever name the accents attach by. The exported font then puts an accent on the
part it was typed after, and the Marks tab shows the glyph as `pos ligature`, its parts
separated by `ligComponent`. Number as far as the last part that needs a place; a part in
between with none is written `<anchor NULL>`. An anchor on the ligature with no number, a
plain `top`, is still where a component lands in the drawing and is left out of the font's
rules.

**A glyph with no key.** In the Spacing line, the Proof and the strip under the drawing, a
slash starts a glyph name: `/a.001`, `/f_i`. The name ends at a space, which is not set, or
at the next slash; `//` is a slash. Where no glyph has the name, a code point is read from
it — `/uni03B1`, `/u1F600`, `/U+03B1`, with or without the leading zeros — and the glyph
that carries it is set. The Spacing line leaves out what the font has no glyph for, and
says what it left out at the right of the bar below the line.

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

**How big the controls are drawn.** The View menu has three sizes for the points, handles
and Tunni knobs — small, normal and big — beside the outline weight, and like everything in
that menu it is per canvas, so a split window can show one letter with the controls out of
the way and the other with them easy to hit. What is drawn and what can be grabbed move
together: small points take a smaller catch, big ones a larger, so a control never looks
like a target it is not. Normal is what the editor has always drawn.

**Which version this is.** The preferences, under Ctrl-comma, name it: _Typewright_ and the
number, which is the first thing a bug report needs.

**The Curve section speaks for every curve that is selected.** Click one and it is about
that one, as before; select the points either side of several — a whole bowl, or the whole
glyph — and the fields are about all of them. A field shows the number when they all have
it and stands empty with a dash behind it when they differ, since showing one of them would
be picking a winner and an average would be a number none of them has. Typing gives every
one of them that number in a single step, and each keeps the other dimension it had: a
tension typed across four curves leaves each one's lean alone. A set holding a straight
segment has no tension to type, and says so.

**Walking the contour.** Alt with the left and right arrows steps the selection one place
along the contour it is on: a point moves to the next point, a focused segment to the next
segment with its two ends picked out. Right is the way the contour runs and left is against
it; a closed contour comes round, an open one stops at its end. It is for what the pointer
is worst at — points a few units apart, a handle lying on top of its own point, a segment
behind its Tunni controls — and with nothing selected it starts at the first point of the
first contour.

**The right-click menu acts on what is selected.** Gather a run of points and the menu's
point items — corner, smooth, tangent, harmonise, lock handles to axis, extract handles,
delete — do the lot in one step, and say how many they will touch. Right-clicking something
that is not in the selection selects it first, so the same menu on a single point reads as
it always did: the items act on the thing you clicked. Right-clicking empty canvas or a
segment while points are selected offers the same point items at the top of the menu, so
the node types and the handle lock are there without aiming at one of the points. What is
about a contour rather than
about a point — reverse, start the contour here, the ordering — stays with the contour under
the pointer.

**Deleting a point keeps the shape.** The two segments it joined become one, and the
neighbours' handles are fitted to what the pair drew — the same directions, since those
are the joins either side, and the lengths the one curve needs. A point taken off a curve
is usually one that was surplus, so taking it off should not leave a dent to redraw by
hand.

**Points where a curve turns.** The Curve section has two buttons, and the right-click
menu on a curve offers the same: **extremes**, where the outline stops going one way in x
or y and starts going the other — the top of an `o`, the side of a bowl — and
**inflections**, where it stops bending one way and starts bending the other. Every font
format wants a point at an extreme, because a TrueType curve is rounded to the grid at its
points and a shape with nothing at its own top rounds into a flat. Each button says how
many it would add and is dead when there are none; right-clicking one curve does that
curve, and the buttons do the whole of whatever is selected.

**Snapping.** A drag catches on the nearest coordinate within a few pixels of it — every
point in the glyph is a candidate, on both of its axes, along with the font's lines, the
sidebearings and your guides. It is the _nearest_ that catches, so aiming is a matter of
being closer to one point than to another; a line that catches holds until you pull clearly
away from it, which is what stops it flickering between two candidates a unit apart. Hold
Ctrl to switch it off for a drag, and turn **Snap to points** off in the View menu to leave
only the font's own lines.

**The font's grid.** What a drag lands on when it catches on nothing is the font's grid:
whole units unless you say otherwise, in the **Grid** section of Font info. Pick a preset —
a 16, 20, 24, 32 or 48 pixel icon, or a 24 pixel one in half pixels — or type a **step** in
units and how many steps apart the **major** lines are. Press `G` (or **Show grid** in the
View menu) to draw it: fine lines at every step, stronger ones at the major steps, the fine
ones fading as you zoom out until only the major ones are left. The grid is kept in the
font's source, so it is the same wherever the font is opened; whether it is drawn is a
setting of each pane. Where a preset's step is not a whole number of units — 24 pixels on a
1000 unit em is 41.67 — the panel says so and offers the em that divides it, 960 here.

**Changing the em.** Typing a new **Units per em** asks what you mean by it before anything
changes. **Scale the font** grows or shrinks everything counted in units with it —
outlines, pens, components, anchors, guides, advances, kerning, the font's measurements, a
tracing picture, the grid and the numbers in spacing rules — on whole units, as one undo
step, so every glyph stays the size it was. **Keep the numbers** changes only the em, so
every glyph sets at a new size, which is what you want after typing it wrong. Numbers in
the feature file are left as they are either way, and the question says so when there are
any.

**Lines at an angle.** A slanted design has nothing upright or level to align to, so a drag
also catches on the line **square to** the segment beyond the point next to it, on the line
**parallel** to it, on the **italic angle** through that point, and on any
**guide you have drawn at an angle** — which until now was drawn and measured against by
eye. The direction of that segment is the direction it _leaves that point by_ — its handle
where it curves, the line to the next point where it is straight — since a right angle at a
corner is a right angle with the curve there and not with the chord across it. The line it
caught is drawn dashed while it holds, through the point it was taken from, so what
happened is visible rather than mysterious.

**A handle has its own angles.** Dragging one offers lines through the node it belongs to:
square to whatever the node’s other side does, along it, and the italic angle with its
perpendicular. A handle is a direction rather than a place, so landing on one of these sets
the angle exactly however far out the handle is pulled — which is how a bowl is made to
leave a stem at a right angle. Upright and level it could always manage, by catching the
node’s own x and y; these are the angles in between.

**Holding a drag to a direction.** Shift projects a drag onto whichever direction keeps
most of it: upright, level, the font's italic angle and its perpendicular, and — when what
you are dragging is a straight segment or a point on one — that segment's own direction and
its normal. So a corner slides along the line it sits on, a whole straight segment moves
sideways by its own thickness without changing angle, and a right angle on a slant is
exact rather than aimed at. The direction wins while it is held: a line that happens to be
near is not a better answer than the one you asked for.

**What two masters have to agree on.** Interpolation is arithmetic on
corresponding points: the third point of the second contour here is averaged with the third
point of the second contour there. So which point a contour begins at, and which contour
comes first, are not drawing decisions once a font has two masters — an `o` begun at the top
in one and at the left in the other is compatible by every count and interpolates into a
twist. Both are set from the right-click menu: **Start the contour here** on a point, and
**Bring forward** and **Send back** on a contour, which say where it sits as they offer it.
Turn **Point numbers** on in the View menu to read the pairing off the canvas — `2.3` is the
third point of the second contour, and the first point of each contour is picked out, since
that is where the pairing starts. Without them, every contour's first point has a faint ring
round it and a small chevron on the outline just past it, pointing the way the contour runs;
both are stronger on a contour with a point selected. The Masters panel's compatibility check
opens the glyph and selects the contour a line is about.

**Going between masters.** **Draw** in the Masters panel puts another master in front of you.
It is done once that master's drawing is on screen; making it the working copy is every glyph
written again, which for a large font is some seconds and goes on afterwards, shown as
_saving_ in the status bar. Each master is a font of its own in two places worth knowing.
The copies under **History** are the open master's: a copy kept in the Regular is offered in
the Regular and not in the Bold, each master has its own twenty, and a copy from before the
font had a second master is offered to either. And the undo history is the open master's,
starting again each time you arrive.

**What the masters share.** A master's drawing is its own: its outlines, its widths, where its
anchors sit, how much it kerns a pair by, its style name and weight. Everything else is the
family's, and is changed through whichever master is open: a glyph added, removed or renamed,
its code points, the order of the glyphs, the features, the kerning groups, and the family's
information — its name, its em, its vertical metrics, the grid. A change to any of these is
made in the other masters when you leave the one you made it in: on going to another master,
saving to the folder, exporting, or closing the window. It is the change as it stands then, so
one that was undone is not made at all. A glyph added arrives in the others as a copy of the
drawing it was made with, compatible from the start; a glyph renamed keeps each master's own
drawing under the new name. Masters that differ already — a family drawn elsewhere, or from
before this — are not made to agree, since nothing says which is right: **Check** in the
Masters panel lists what two masters differ in, a part at a time, with a button to copy that
part across.

**Between the masters.** The Spacing line and the Proof have a **Between** switch and a
slider for each axis: the text is then set with the family worked out at that place rather
than with the master being edited. It is the same location the canvas draws its ghost weight
at, so moving it moves both. A stem that thickens faster than its neighbours, or a
sidebearing that drifts across the designspace, shows in a line of letters and in no single
one of them. An instance is not a thing to edit, so while one is shown the spacing line says
so and its nudges and fields are quiet; the judgement is carried out in a master.

**Locking a handle to an axis** snaps it to north, south, east or west — whichever it is
nearer — and holds it there while it is dragged. A smooth node's two handles are one
straight line, so they go to the same axis and not to one each. On a tangent node the
curved handle runs along the straight side, which is a direction the node does not get to
choose: locking it makes the node a corner, unless the straight side is already on an axis,
in which case nothing is given up and the node stays tangent.

The glyphs either side are drawn from the strip text, dimmed, for judging spacing —
**double-click one to open it**. Everything about the glyph being edited comes first:
anything pickable, and the whole box round its drawing, so a shape that overshoots well
outside its own sidebearings is still that shape where it hangs over the next letter.

**Spacing that follows another letter.** The inspector's glyph section has three fields
saying where this glyph's spacing comes from: its left sidebearing, its right, or its
whole advance, each the name of another glyph. Set one and the number beside it goes grey
and shows what the rule works out to, following the chain — `ü` from `u` from `n` — and
following it again the moment `n` moves: every edit that finishes leaves the glyphs that
follow it re-spaced, inside the same step, so one undo takes back the change and
everything that came of it. A side or a width a rule speaks for is not yours to set — the
field is grey, and the line on the canvas does not take hold — and typing a plain number
into the spacing line's field is how you take the rule off and keep the number. The rule
is kept in the source and resolved where the font is compiled, so what comes out is an
ordinary font. A rule that cannot be followed leaves the glyph as drawn and is reported,
in the export warnings and in the preflight check. A rule can also be a number of units,
written with an equals sign: `=600` as the width keeps the glyph 600 wide whatever is drawn
in it.

**A fixed-width font.** Tick **Fixed width** under Metrics in Font info for a code font, a
terminal font or an icon font, and say the **Width**; it starts at the width most of the
glyphs already have. Nothing moves when you tick it: the panel counts the glyphs of another
width, and **Fit to** gives each the width with its drawing centred in it, in one step. A
mark with no width and a wide character at twice the width are allowed, and left alone. New
glyphs are made at the width, and in a fixed-width font a sidebearing you set slides the
drawing across its cell rather than changing the advance. The preflight check lists any
glyph of another width, and the exported font says it is fixed-width where terminals and
operating systems look: `post`, the PANOSE proportion and the average width.

**Icons from SVG files.** **Import SVGs as glyphs…** in the File menu takes any number of SVG files
and makes a glyph of each, in one undo step; dropping the files on the glyph grid does the
same. A glyph is named for its file — `arrow-left.svg` is `arrow_left`, the form a font can
carry — and given the next free code point of the Private Use Area, from `U+E000`, since an
icon is a character Unicode has no code point for. The drawing's view box is scaled to run
from the descender to the ascender, the box a line of text gives a glyph, so a 24 by 24 icon
in a font with a 24 pixel grid lands on the grid; its advance is the view box's width, or
the fixed width with the icon centred in it. The status bar says how many came in and, in
its tooltip, what was left out and why.

A set is brought in more than once, as it is redrawn. A file named for an **icon** the font
already has — a glyph with a private-use code point — redraws it: the drawing and the width
are the file's, and the code point, the name, the anchors and the mark stay as they were, so
nothing that uses the font has to change. A file named for any other glyph is left out:
`a.svg` never draws over the letter `a`. The whole import is one undo step. In the Glyph workspace, pasting SVG text or dropping
one SVG file on the canvas adds its shapes to the glyph you are in, selected.

A **filled** shape comes in as an outline. A **stroked** one comes in as a stroke: the
path it was drawn along, with a round pen of the stroke's width, so an icon set drawn in
strokes stays editable as strokes and its weight can be changed afterwards. Round ends and
round joins are exact; square ends and mitred corners come in rounded, and the tooltip
names the glyphs. Paths, rectangles, circles, ellipses, lines, polylines and polygons are
read, through groups, transforms, classes and inline styles. Text, pictures, clips and
masks, and shapes used by reference are not, and are named too.

**Icons by name.** Tick **Names as ligatures** under Icons in Font info and the exported
font spells each icon's name: typing `home` draws the glyph called `home`, and the word
is still there to read where the font fails to load. An icon is a glyph with a private-use
code point. The rules, and the blank letters they need, are made when the font is exported
and are not written into the feature file, so they never go stale when an icon is renamed;
the panel says how many there are. The longest name wins, so `arrow` and `arrow_left`
can both be icons.

**An icon kit.** **Icon kit** in the Export menu writes one archive with what a web page
needs: the font as WOFF2, a stylesheet with a class for every icon, a page showing every
icon with its name and code point (click one to copy its classes), and the names and code
points as JSON. The classes are named from the family, `my-icons my-icons-home`. **SVGs**
writes every glyph that draws something as a picture of its own, as the font compiles it —
strokes as their ink, components resolved, overlaps joined.

**Bigger cells.** The slider at the end of the glyph grid's bar draws the cells up to three
times their size, which is what an icon wants and a text font's two thousand glyphs do not.
It is kept in this browser, not in the font.

**The glyph at the size it is used at.** The inspector's **Pixels** section shows the glyph
at 16, 24 and 32 pixels to the em, exactly as big as it will be, and the one you press again
close up, each of its pixels a square. That is where an edge between two lines of the grid
shows: grey where it was meant to be black. It is drawn smoothed and unhinted, as a browser
draws an icon font. The section is folded until you open it.

In a font with a grid coarser than whole units, the preflight check also notes the outline
**points off the grid** and the **strokes that are not a whole number of steps wide**, and
selects the first of each. Curves are expected to leave the grid; a straight edge off it is
usually a slip.

**Keylines.** `Shift-G`, or **Show keylines** in the View menu, draws the shapes an icon
set is drawn inside, in the box a line gives the glyph: the live area an icon keeps within,
dashed, and a square, a circle, and an upright and a level rectangle — the sizes at which
icons of different outlines look the same size, in the proportions the common sets use
(a live area of 20 in a box of 24, a square of 18, a circle of 20, rectangles of 16 by 20).

**Lining up and spacing.** The Transform section of the inspector ends in a row of eight
buttons: six to line the selection up on its left, centre or right, its top, middle or
bottom, and two to space it evenly across or down. Whole contours selected move as shapes,
kept as they are; anything less is points, each put on the one line. They line up to the box
round what is selected — and one contour alone lines up with the glyph's own box, its
advance wide and from descender to ascender, which is how an icon is centred. Spacing wants
three or more, keeps the first and the last, and makes the gaps between the same. Each is
in Ctrl-K too, by name, while there is something for it to do.

**Kerning groups.** Letters whose sides have the same shape share a group, and one kerning
value then covers all of them: `D`, `O` and `Q` end in the same round, so they share a group
for their **right side**, used when the letter stands before a gap; `C`, `G`, `O` and `Q`
begin round, and share one for their **left side**, used after a gap. A letter is in at most
one group per side, so `O` is usually in two. **Groups** in the Spacing bar opens on the
pair in front of you — for `no`, the right side of `n` and the left side of `o` — with the
group each is in: choose another from its list, or **No group** to kern it as itself, and
**New group from o** starts a group named after the letter with the letter in it, in one
step. **All groups** below lists every group by right sides and left sides, where groups are
renamed, emptied, filled by name and deleted.

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
reached, and it lasts until the section fills or empties again. The sections about what is
selected come first: with points selected the Point, Curve, Pen and Transform sections lead,
with an anchor or a component its own section does, and with nothing selected the glyph's
own sections are at the top.

**Anchors and components.** Right-click empty canvas to put an anchor down; it is a
small cross, named on hover, dragged like a point and snapped to the same lines. Both an
anchor and a guide stay picked while the arrow keys nudge them and Backspace removes them;
clicking the canvas where nothing is, or dragging a marquee, lets go. The
inspector lists them with an editable name and coordinates. A component is added by name
in the inspector and lands on its anchors where both glyphs have a matching pair — an
`acute` carrying `_top` on a letter carrying `top` — and at the origin otherwise. Drag one
by the shape it draws, type its offset, right-click it to open the glyph it refers to,
put it back where the anchors say, or decompose the glyph and keep the outlines.

**The curvature comb** is off by default and turned on in the View menu. It stands a
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
crossings spans a stretch of the stroke that lies inside one shape's ink, and each of those
stretches becomes an edge of the result — which is what makes the interesting case fall
out rather than needing a rule of its own. Drawn all the way across a shape, the pair
divides it in two. Drawn into an `o` from outside and stopped in the counter, the pair has
one end on the outer contour and one on the counter, so it _joins_ them: what comes back is
a single closed contour running round the outside, along the stroke inwards, round the
counter and back along the stroke — a ring with a slit in it, simply connected the way a
`c` is where the `o` was not. The slit has no width yet; pulling it open is drawing rather
than cutting.

**A shape is a contour and the holes in it**, and the pairing happens inside one. A counter
belongs to the shape around it, so a cut across an `o` closes from the outer contour to the
counter and gives two clean halves of the ring. Two shapes that merely overlap are two
things: a stroke through both cuts each of them and leaves them two, rather than weaving one
outline out of the pair. Merging them is what Remove overlap is for, and it stays a thing you
ask for.

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
Marks on ligatures come in as numbered anchors on the ligature, a mark that attaches by
different points in different lookups as an attaching anchor for each, and the joins of a
script written joined up as an `entry` and an `exit` on each glyph. What does not fit the
anchors — a second set of joins, an anchor tied to a point of the outline — is kept in the
source and named in the import report.

**Drawing with a pen.** Any contour can be drawn with a pen instead of being the edge of the
ink. Select it and open the **Pen** section in the inspector, then choose **Stroke**: the contour
becomes the path the pen is drawn along, and the ink is worked out from it and filled around it.
The pen has three numbers. The **angle** it is held at, anticlockwise from level in degrees, the
way a calligrapher states it — thirty for a foundational hand, forty-five or so for an italic. Its
**width**, along that angle. And its **thickness** across it: nothing is a broad edge, which is
thick where the path runs across the pen and pinches to nothing where it runs along the pen's own
edge, as a cut quill does; more than nothing is an oval, whose thin strokes keep some weight and
whose ends and corners are round; the same as the width is a round pen, the same weight every way. Every point tool works on the path as it does on any contour — drag its points and
handles, hold its joins, cut an open one in two with the knife and both halves keep the pen.
Choose **Outline** to make it an ordinary contour again; the path stays where it is. To keep the ink
instead, right-click the stroke and choose **Convert stroke to outlines**: it is replaced by the
outlines it draws, the ones an exported font gets, and every stroke selected with it goes too.

The pen is set at points, and changes smoothly along each segment from one point's pen to the
next: the angle turns, the width and thickness grow or shrink. The numbers in the Pen section are
the pen at the points selected, so select one end of a stroke and widen the pen there, and the
stroke swells towards it; select every point, and the whole stroke's pen changes. Typing one number
into a selection whose pens differ changes only that number at each point. A point put into a
stroke — **Insert point here**, points added at extremes, or the knife — is given the pen the
stroke already had at that place, so the ink does not change until you change it.

How the pen gets from one point's pen to the next is set per segment, on the point that starts
it, and separately for the angle and for the shape — width and thickness together. The Pen
section's **Angle blend** and **Shape blend** rows offer four: **Linear**, evenly by distance
along the path; **Smooth**, along a curve through the pens at all the points, so the change
carries on through a point instead of turning a corner there, and never goes past either pen on
the way; **Ease**, slowly away from the point and slowly into the next; and **Step**, the point's
pen held until the next point. A point put into a segment takes its blend with it.

The **Stroke** tool (`N`) draws exactly as the pen tool does and makes strokes instead of
outlines, with the last pen set in the Pen section — so a run of strokes in one hand is the pen
set once. Until a pen has been set it draws with thirty degrees and eighty units. The pen interpolates between
masters, point by point, so a narrow pen in the light master and a wide one in the bold give a
stroke that thickens between them. What goes into the font is the ink. A `.ufo` gets the ink as the glyph's
outline, so other applications see the letter, and the stroke itself in the glyph's `lib`, so a
UFO folder saved and opened again comes back with its strokes. If another application has changed
a stroke's outline in the meantime, the changed outline is kept as an outline and the file's
import report says so, rather than the old pen being put back over the edit.

**Holding a join smooth.** **Harmonise**, in the Curve section and on the menu, moves a point
to where the curvature either side of it agrees — once. The next drag of a handle beside it
undoes that. **Hold** beside it makes it stay: a held point is put back where the curvatures
agree after every edit, so the curves through it can be drawn freely and the join stays smooth.
It slides along the line between its own two handles and never touches them, so the directions
the curves were drawn with are kept. A held point is drawn with a ring round it. Only a point
between two curves can hold anything; a straight side has no curvature to agree with. Press
**Hold** again to let go, and the point stays where it is.

**Continuous corners.** A corner point — or a tangent point, where a curve runs into a straight
line — can be drawn rounded without adding a point: select it and choose **Continuous** in the
Point section's **Corner** row, or **Make corner continuous** on the menu. The point stays where
it is and stays what you drag; the outline around it is drawn round, and that round is what is
filled, exported, measured and joined. **Size** is how much of each side the round spends, and
the two small diamonds on the outline at its ends drag it along the sides. **Smoothness** is how
much of the round is a ramp: at 0 it is a plain circular round, which meets its sides with a
jump in curvature the eye reads as a kink; above it, the curvature rises from nothing on the
straight sides, the way the corners of application icons are drawn. At a tangent point there is
no corner to round, and the curve instead settles into the line over the size given, arriving
on it with no curvature. The sharp corner stays on the canvas as a faint dashed line. Joining
outlines, subtracting and offsetting work on the drawn round, and a `.ufo` gets the round in its
outline, with the corner kept in the glyph's lib so it comes back continuous.

**Setting a line with the features on.** The Spacing bar and the Proof bar each have a
**Features** panel: the first row applies the font's own rules or silences them, and under it
is a switch for every feature the feature file defines. Each starts where a text renderer
would leave it — `liga` on, `ss01` off — so a proof shows what somebody gets by typing until
you say otherwise, and a stylistic set can be seen substituted without exporting the font.
Switching the master row off greys the rest out with it: off means the letters the
substitutions stand in for, kerning and mark attachment included. The switches are kept per
view and in this browser, not in the font, and a dot on the button says the line is not being
set the way a reader's would be. A moment after a line is set, HarfBuzz takes it over and
sets it exactly as the exported font would; until then the editor's own shaper stands in, and
it takes the first of a rule offering several alternates rather than choosing between them.

**Naming stylistic sets.** A stylistic set is named in the feature file, inside the set, the way
every other font tool reads it:

```
feature ss01 {
    featureNames {
        name "Single-storey a";
    };
    sub a by a.ss01;
} ss01;
```

A character variant takes `cvParameters` instead — a `FeatUILabelNameID` block for its name,
and optionally a line on what it does, a sample, a name for each alternate
(`ParamUILabelNameID`) and the characters it changes (`Character 0x0061;`). Type
`featureNames` or `cvParameters` and accept the completion to get the block with the caret
in the name. The names go into the exported font, where an application's typography panel
shows them, and the Features switches show them beside the tag. A font opened from a file gives
its names back as these blocks. `aalt`, the feature a glyph palette lists every alternate from,
is compiled as written — `feature aalt { feature ss01; feature salt; } aalt;` — and if the file
has none, the exported font gets one gathered from the stylistic sets, character variants,
stylistic and swash alternates, small capitals and figure styles.

**Joining shapes, and what that does to components.** **Remove overlap** takes the outline of
what the selected contours cover together, or of the whole glyph where nothing is selected. Two
shapes that cross are joined, and so are two that share an edge and no area — two squares set
side by side become one rectangle, because the edge between them is inside the ink and a
rasteriser would otherwise leave a pale line down it. Shapes that meet at a single point are
left as they are: one contour through that point would pinch to nothing, which says something
the drawing does not.

**Subtract, intersect and exclude** sit beside it, and they work the other way round: the
selection is the shape being applied and everything else is what it is applied to. Draw a
rectangle across a stem, select it, and **Subtract** cuts the notch and takes the rectangle with
it; **Intersect** keeps only what the two of them both cover; **Exclude** keeps what only one of
them covers. A tool swallowed whole by the shape under it cuts a hole, which comes out running
against the outline around it, as a counter must. The three are greyed out until something is
selected, because without a selection there is nothing to apply. Shapes that do not overlap are
said to be apart and nothing is done; an operation that would leave nothing at all is declined,
because that is almost always the wrong shape picked as the tool.

A glyph drawn partly by reference — a dollar sign as an `S` with two bars laid across it — is
joined too, and the components that take part become outlines to do it, in one undo step. The
button says so: "Removed overlap at 4 places, 1 component decomposed." A component that meets
nothing is left as a reference, so joining a letter does not flatten the accent sitting above
it. Where the edges cannot be resolved the button declines and says so rather than reshaping
the letter.

**Offset** moves an outline outwards or inwards: a panel on the bar takes a horizontal and a
vertical distance — separately, because a letter given more weight usually wants more on the
stems than on the thins — and a choice of what to do with the corners. Round puts an arc in,
mitre carries the two sides on to their point, and flat cuts across. A mitre that would run away
to a spike on a sharp corner is given up as a flat one. Inwards is a negative distance, and an
inward offset that folds over itself is resolved on the way out, so what you get back is an
outline rather than a knot. The em's own counters thin as the shape around them thickens, because
outwards for a hole is inwards on the page.

**Simplify** takes out the points the outline does not need: those are the ones a curve through
their neighbours passes through anyway, to within a thousandth of the em. Two kinds are never
taken out, whatever else is. A point at an extreme stays — it is what hinting rounds to the
grid, what an interpolation needs on both sides to have anything to pair, and what several
renderers read a glyph's extent from — and a corner stays, because taking one out would round it
off. So a circle drawn on its four extremes and a rectangle both come back untouched, and the
button says so rather than appearing to do nothing. It tidies as well, in the same undo step:
a segment that goes nowhere — a point on top of its neighbour, or a corner rounded to nothing,
as fonts cut from a variable font often have — is taken out first; a contour that then draws
nothing at all, a closed line there and back or a point on its own, goes whole; and a point is
put in at every extreme the outline lacks, before the points that leaves unneeded come out. A
pen stroke is never taken out, since a pen leaves ink along a line.

**The knife and components.** A stroke drawn across a component cuts it as it would any
contour: a reference cannot be cut, so the component becomes outlines first, and the undo menu
says **Cut through component** rather than just **Cut**. A stroke that only enters a component
puts a point on it the same way. Components the stroke does not reach are left as references.
The ruler and the gap measure read components too, so a ruler laid across a letter built partly
by reference measures the whole of it.

Components are only ever drawn in by the whole-glyph union. Joining or cutting a _selection_
leaves every reference alone — a selection names contours, and turning a reference into outlines
because something was drawn across it is a decision to take deliberately rather than one to
have taken for you.

**A waterfall, and two settings on one page.** The Proof bar begins with a choice between
**One size** and **Waterfall**. A waterfall sets the same text as several blocks, each with
its own size and its own **Features** panel, and choosing it fills in the sizes a specimen
sheet is set at — 8 through 14, then 18, 24, 36, 48 and 72. The sizes are a row of chips
under the bar. Press one to choose it: its size field and its **Features** panel appear after
the chips, and a dot on a chip says that size has features of its own. The × on a chip, or
Delete while it has the keyboard, takes it away; **+** adds a size at the last one's. **Ladder**
fills the page afresh — the classic ladder, the text sizes up to 16 or the display sizes from
18 to 96. On the page, a rule above each block gives its size, and names the features that block has
switched where they differ from the bar — so two blocks at one size with a stylistic set on in
the second are a comparison the page itself labels. Leading stays one number for the whole
page, because it is a multiple of the em and already means the same proportions at every size,
and the text, the specimen and the way the line runs are shared for the same reason: a
comparison needs one thing to be different at a time. Ctrl and the wheel zoom the whole
page, every block by the same factor, and leave the sizes as they are: the row then says
**Zoom 125%**, the rules still give each block's own size, and pressing the zoom, or Ctrl-0,
goes back to 100%. Going back to **One size** puts the page back at the
slider's size and forgets the blocks.

**Old Macintosh fonts.** A `.sit` file — a StuffIt archive, which is how a font from the
1990s was passed around — opens like any other font. The archive is unpacked, the font
suitcase found inside it, and its bitmap strike turned into outlines: one square per lit
pixel, the widths from the font's own tables, and the em set by the strike's ascent and
descent, so a ten pixel font arrives on a 1000-unit em with every point on a round number.
The staircase edges are the design and are left exactly as they were drawn. A suitcase
holding several sizes opens the largest, which is the one with the most in it; a suitcase
holding a TrueType font rather than a bitmap one opens as that font.

**What comes out.** OTF and TTF to install, WOFF and WOFF2 for a web page, a UFO as
source, and — once a font has more than one master — a family as a designspace with a
UFO each, one variable font, and every named style as an ordinary static font. The web
formats are written from the TrueType flavour, which is what WOFF2's transform is for.
A variable font is kerned at each master's place as that master is, and between two of
them by what lies between: a bold kerned more tightly than its light stays so. The masters
have to agree what is in each kerning group, which the editor keeps the same across them;
where they do not, the font is kerned as its default master is and the export says so.
A font file is compiled away from the window, which goes on answering while it is: a large
font is some seconds in the making, and the status bar says how far it has got, such as
_Exporting… 1,280 of 4,042 glyphs_, in whichever workspace is open. When it is done the
status bar names the file, with what the export had to say about it in the tooltip, until
it is clicked away; a failure is said there too. A glyph whose overlapping contours cannot
be joined without changing its shape keeps its overlap, and the export names it.

A UFO is written with every point where it is, to the fraction: sources made by other tools
hold points between whole units, and opening and saving them leaves those where they were.
A font file is on whole units, as the format is. To put a drawing on them — or on a coarser
grid — use **Round coordinates** in the Clean up menu, a step you take rather than one a save
takes for you.

**A font imported a while ago.** Reading a font file has got better at two things, and a font
read in before it did keeps what it was given then. Two items in the Clean up menu bring one
up to what it would be read as now, without importing it again and losing what has been
drawn in it since. **Tidy imported outlines** takes out what draws nothing — a point sitting
on the point before it, of which a TrueType outline once came in with one after nearly every
curve, and a handle sitting on its own point. No shape changes. **Fill as the font file did**
is for glyphs built of pieces laid over each other, which a font file fills by which way
their contours run and this editor by how they nest: an icon drawn that way was shown here
with holes where its pieces met. It says how many glyphs it would redraw, and which, and
redraws them when you say so — asked first because it is right for a glyph as it came in and
wrong for one you have redrawn since, where the directions are whatever they happen to be.
Each is one step to take back.

**Which glyph is which.** A cell in the font's grid has room for a glyph name and a code
point, which for a mark is `uni0308` above `U+0308` and says nothing about which mark it
is. Rest the pointer on a cell and a tip beside it gives the character, the name the
standard gives it — COMBINING DIAERESIS — the block it comes from, and whether it has been
drawn. A glyph the font has not drawn yet shows the character faintly in one of the
system's own fonts instead of an empty box, with a combining mark on the dotted circle it
is always shown on, so a screenful of empty cells after **Add missing** can be read at a
glance.

**What the font has not got.** Choosing a Unicode block — or ASCII — lists the whole of
it, and the code points with no glyph get cells of their own: the character fainter
still, in a dashed box, with the code point under it and no name, since the font has not
named it yet. The list opens in code-point order, which puts them in their places, so a
block reads as a chart with gaps; in font order they follow the glyphs, a glyph the font
has not got having no place in the order the font declares. The order is chosen from the
sort menu at the right of the bar, beside the field the glass marks as the search. Searching does the same for one
character: type a `ǧ` the font has not got and it is offered rather than answered with an
empty grid. A search of three letters or more also looks among what the standard calls the
characters: `dotless` finds ı and ȷ whatever the font named them, and `dotless j` only
the second; each word has to begin a word of the name. The characters so named that the
font has not got are offered too, within the set showing and a hundred at most.
**Double-click one, or press Enter on it, to make that glyph and open it**;
its menu adds it without opening. They are offers and not glyphs, so they are not picked,
not counted among the glyphs, and nothing that acts on a glyph — deleting, renaming,
marking — acts on them. **Add missing** still makes the whole block at once.

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
and reverse. A segment offers insert-point-here, a point halfway along it where it is
straight, a point at each extreme or inflection it has none on, line/curve conversion,
balance and reverse. Which items appear depends on
what is under the pointer, using the same hit
index the tools use — the menu can never offer an action for something the canvas is
not showing. Space previews without controls, the wheel pans, Ctrl-wheel zooms at the
cursor, middle-drag pans, and Ctrl-0 refits. Ctrl-wheel also sets the type size in the
Spacing and Proof workspaces.

Preferences are kept in this browser rather than in the font, and are in two places
according to what they are about. The gear at the top right of the **window**, in the
strip that names the font, holds what is true of the application: the theme, which
follows the operating system until you choose light or dark yourself. Ctrl-, opens it
from anywhere. The sliders button at the right of a **drawing toolbar** holds what that
canvas shows — outline weight, handles, snapping, neighbours, anchors, the comb — and
each pane keeps its own, so a split window can carry the comb on the letter being worked
and leave it off the one beside it. The type sizes in Spacing and Proof are set in those
workspaces and remembered the same way.

Edits autosave to the browser's private filesystem after a second's pause, so closing
the tab and coming back keeps your work. Note that this store belongs to the browser,
not to you — the files cannot be opened in a file manager. To keep a font where other
tools can read it, save it from the File menu, or with Ctrl-S.

**Opening a large font** takes a few seconds — an icon font of four thousand glyphs is four
thousand files to read and as many glyphs to draw — and for those seconds the window says so:
the font's name, a bar, and how far it has got, such as _Reading glyphs · 1,280 of 4,042_. It
is shown when the program starts on a font, when a UFO folder is opened and when a font file
is imported, and goes as soon as the font is on screen; a font that was opened or imported is
then written to the browser's store in the background, which the status bar shows as _saving_.
Until it says _saved_ the font is only on screen, so closing or reloading the tab in those
seconds is asked about first, and the desktop window waits for the writing before it closes.

**The File menu** is in four groups, each named for what happens to files. **New font**
starts another font and **Switch font** opens one of the others: both keep the font that
was open, in this browser, on the list of fonts — nothing is thrown away by starting a new
one. **Open UFO folder** works on a font where it is kept on disk and saves back to it;
**Import font file** reads a TTF, OTF, WOFF, zipped UFO or family in as a copy, opened as a
new font beside the one that was open, which stays on the list; dropping a font file on the
File menu does the same. **Import SVGs as glyphs** adds glyphs to the font that is open. **Save** (or **Save to
folder** the first time) and **Save to another folder** write it to disk, and **Open another
window** is last.

**Where a font is kept.** Each font is kept on disk as a UFO of its own — a folder named after
the font, such as `MyFont-Regular.ufo`. The first time a font is saved, you are asked for the
folder to keep it _in_: your fonts folder, or the folder of the project the font belongs to.
The editor makes `MyFont-Regular.ufo` inside it; anything else in that folder is left alone,
and a font already there under the same name is never written over — the new one is saved
beside it as `MyFont-Regular-2.ufo`. From then on Ctrl-S writes to that UFO without asking.
**Save to another folder** does the same for another place, and the font is worked on there afterwards. The
picker opens where you last kept a font, not inside the last font's own folder, and it will
not save one font into another font's UFO. An empty folder whose name ends in `.ufo` is taken
as the font's own, if you would rather make the folder yourself. **Open UFO folder** is the
other way round: there you pick the `.ufo` itself.

**A family on disk.** A font drawn more than once is kept as a family: a folder of its own,
named for the family, holding a `.designspace` and a UFO for each master —
`MyFont/MyFont.designspace`, `MyFont/MyFont-Regular.ufo`, `MyFont/MyFont-Bold.ufo` — which is
what fontmake is given and what other editors read. Ctrl-S writes every master that has
changed since the last save and leaves the others alone, and the File menu shows the font as
unsaved while any master, or the designspace, is behind. **Open UFO folder** on a family's
folder reads every master, and **Re-read** does the same, replacing them all with what the
folder has. A font saved as a single UFO that has since been given a second master is asked
for a folder the next time it is saved — a browser gives no way from a folder to the one it is
in — and is kept as a family there from then on; the UFO it was saved in is left where it was.
A master renamed or removed has its UFO taken out of the family's folder at the next save;
anything in the folder the editor did not write is left alone.

The list under **Switch font** names the UFO each font is
kept in, or says it has not been saved to disk yet. Its **Open UFO folder** button opens a
font kept anywhere on disk straight from the list, and **Import font file** opens a TTF, OTF,
WOFF or zipped UFO there as a new font, the same as in the File menu.
