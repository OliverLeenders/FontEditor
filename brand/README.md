# The mark

Typewright's logo is a piece of foundry type seen isometrically: a body, the two
nicks a compositor's thumb finds in the dark, and the letter standing on the
inked face. The `T` is not set in a typeface — it is two rectangles in the
face's own hundred-unit square, pushed through the matrix that maps that square
onto the rhombus, so it shears with the face instead of floating above it, and
so the icon does not depend on a font being installed.

| File             | What it is                                                           |
| ---------------- | -------------------------------------------------------------------- |
| `mark.svg`       | The mark. The source everything else is drawn from.                  |
| `mark-small.svg` | The same mark for 16–24px: no nick, bolder `T`, larger block.        |
| `favicon.svg`    | A copy of `mark.svg`, under the name the browser wants.              |
| `render.ps1`     | Draws every size, builds the `.ico`, and installs both into the app. |
| `make-ico.py`    | Packs the PNGs into a multi-size `.ico`. Called by `render.ps1`.     |

## Building it

```powershell
brand\render.ps1
```

Rasterising is `System.Drawing`, which ships with Windows, and the `.ico`
container is thirty lines of `struct` — no image library is installed for this.

Every size is **drawn at that size**, never drawn large and shrunk. Every edge
in this mark is a straight line between two flat fills, and resampling spreads
each of them over two or three pixels — which is what a blurry icon is.

Three of those edges are vertical: the outer flank of each side face, and the
seam between them. Those are **snapped to whole pixels** at every size. A
vertical edge landing at 1.63 pixels is a column of 63%-opaque pixels running
the full height of the icon, and that column is what makes a small icon look
soft — the diagonals are honestly antialiased and look right that way. The left
flank is rounded and the right one placed by reflection, so the block stays
symmetrical and the seam lands on an exact half; everything else rides the same
linear map, so the isometric proportions do not shift.

Two details change with size, both at the same size:

| Size      | Nick                   | Letter                     |
| --------- | ---------------------- | -------------------------- |
| 16–24     | deeper                 | very nearly fills the face |
| 28 and up | as `mark.svg` draws it | as `mark.svg` draws it     |

At 24 pixels and below — the taskbar and the title bar — the nick as drawn is
two pixels of pale blue and the letter three pixels wide, and neither survives
antialiasing. From 28 up the mark holds up as it is: a heavier letter and nick
were drawn up to 48 once, and at the desktop's sizes they looked coarse beside
the mark itself.

The `.ico` carries 16, 20, 24, 32, 40, 48, 56, 64, 96, 128 and 256. A size the
shell wants and does not find is one it resamples for itself.

The script writes `png/` and `icon.ico` here — both ignored, both intermediates —
and then copies what ships into `apps/editor/src-tauri/icons` and
`apps/editor/public`, which are committed. It replaces every Tauri icon except
`icon.icns`: that is the macOS bundle icon, it needs a mac toolchain to write,
and the Windows build does not read it.

## The colours

Taken from the editor's own light palette, so the icon and the interface agree.

| Part            | Colour    | Token in `tokens.css` |
| --------------- | --------- | --------------------- |
| Body, left face | `#edf3f9` | near `--surface-2`    |
| Body, right     | `#7e97b2` | —                     |
| Nick            | `#2c6daf` | `--accent`            |
| Inked face      | `#131922` | `--ink`               |
| The letter      | `#ffffff` | `--surface`           |

The right face is darker than the drawing wants at large sizes. It has to be: at
a lighter tone the block loses its silhouette against a light taskbar and reads
as a black rhombus floating over a blue stripe.
