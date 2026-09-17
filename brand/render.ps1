Add-Type -AssemblyName System.Drawing

$root = $PSScriptRoot
$repo = Split-Path -Parent $root
New-Item -ItemType Directory -Force -Path "$root\png" | Out-Null

function Poly($pts) {
  $a = New-Object 'System.Drawing.PointF[]' ($pts.Count)
  for ($i = 0; $i -lt $pts.Count; $i++) { $a[$i] = New-Object System.Drawing.PointF($pts[$i][0], $pts[$i][1]) }
  return $a
}
function B($hex) { return New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($hex)) }
<#
  The drawing at one size, with its straight edges put on whole pixels.

  Three edges in this mark are vertical: the outer flank of each side face, and
  the seam between them. A vertical edge landing at 1.63 pixels is drawn as a
  column of 63%-opaque pixels down the whole height of the icon, and that column
  is what makes a small icon look soft — not the diagonals, which are honestly
  antialiased and look right that way.

  So the flanks are rounded to whole pixels and the far one is placed by
  reflection, which keeps the block symmetrical and puts the seam on an exact
  half. Everything else is carried along by the same linear map, so the
  isometric proportions do not shift: x runs from the left flank to the right,
  y from the top vertex to the bottom.
#>
function Place($pts, $size) {
  $k = $size / 100.0
  $left = [math]::Max(1, [math]::Round(6.8 * $k))
  $right = $size - $left
  $top = [math]::Round(2.0 * $k)
  $bottom = $size - $top

  $sx = ($right - $left) / 86.4
  $sy = ($bottom - $top) / 96.0

  $out = @()
  foreach ($p in $pts) {
    $out += ,@(($left + ($p[0] - 6.8) * $sx), ($top + ($p[1] - 2) * $sy))
  }
  return $out
}

# The block, filling the square it is drawn in. An icon sits beside others in a
# taskbar and is read against them: art that stops at seven tenths of its canvas
# looks like a smaller program, whatever its own proportions are.
$BLOCK = @{
  left  = @(@(6.8,23.6),@(50,45.2),@(50,98),@(6.8,76.4))
  right = @(@(93.2,23.6),@(50,45.2),@(50,98),@(93.2,76.4))
  top   = @(@(50,2),@(93.2,23.6),@(50,45.2),@(6.8,23.6))
}

# The nick, in two depths.
#
# It is always drawn. Dropping it at small sizes was a mistake with a very
# specific cost: a taskbar at 100% scaling shows a 24 pixel icon, which is
# exactly where it had been dropped, so the one detail that says "metal type"
# was missing from the place the icon is looked at most.
#
# What it needs at that size is not to be there, but to be deeper. Ten units is
# two pixels at 24, and two pixels of pale blue against white survives neither
# antialiasing nor whatever rescaling the shell does on its way to the taskbar.
# From 28 up the drawn depth has the pixels it needs, and the deep one only
# looks heavy beside the mark it was taken from.
$NICK = @(@(6.8,57.2),@(50,78.8),@(50,88.4),@(6.8,66.8))
$NICK_DEEP = @(@(6.8,53.6),@(50,75.2),@(50,89.6),@(6.8,68))

# The letter as mark.svg draws it, already sheared onto the face.
#
# A bold cut used to stand in up to 48 pixels, on the reasoning that the shear
# thins the crossbar first. At 32 and 48 — the desktop and a folder's icons — it
# looked coarse beside the mark itself, which holds up at those sizes. So the
# mark's own letter is drawn from 28 up.
$MEDIUM = @{
  bar  = @(@(25.376,23.816),@(50.432,11.288),@(56.48,14.312),@(31.424,26.84))
  stem = @(@(34.88,19.064),@(40.928,16.04),@(65.12,28.136),@(59.072,31.16))
}

# The letter at the sizes where it is barely a letter at all.
#
# At 24 pixels the face is ten pixels deep, and a T set with the margins that
# look right at 128 has three pixels to say what it is with. It does not read as
# a T, it reads as a smudge. So at these sizes it is not set on the face, it
# very nearly is the face: margins cut to a tenth, and a stem wide enough that
# the crossbar and the stem are the same two strokes after rounding.
$HUGE = @{
  bar  = @(@(15.44,24.464),@(51.728,6.32),@(60.8,10.856),@(24.512,29))
  stem = @(@(28.832,17.768),@(38.336,13.016),@(71.168,29.432),@(61.664,34.184))
}

$C = @{ left = "#EDF3F9"; right = "#7E97B2"; nick = "#2C6DAF"; top = "#131922"; t = "#FFFFFF" }

<#
  Drawn at the size asked for, not drawn large and shrunk.

  Supersampling and then resampling down is the obvious way and it is the wrong
  one here: every edge in this mark is a straight line between two flat fills,
  and a bicubic downsample spreads each of them over two or three pixels. The
  result is an icon that looks soft beside neighbours that are not. GDI+ draws
  an antialiased polygon edge directly, which puts the softness only where the
  edge actually falls.
#>
function Render($size) {
  # Everything gets heavier at 24 and below, the sizes of the taskbar and the
  # title bar, because there a detail either survives or is not there at all:
  # the deeper nick, and the letter that very nearly is the face. From 28 up the
  # icon is the mark.
  $nick = if ($size -le 24) { $NICK_DEEP } else { $NICK }
  $letter = if ($size -le 24) { $HUGE } else { $MEDIUM }
  $out = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $g.FillPolygon((B $C.left),  (Poly (Place $BLOCK.left  $size)))
  $g.FillPolygon((B $C.right), (Poly (Place $BLOCK.right $size)))
  $g.FillPolygon((B $C.nick),  (Poly (Place $nick        $size)))
  $g.FillPolygon((B $C.top),   (Poly (Place $BLOCK.top   $size)))
  $wb = B $C.t
  $g.FillPolygon($wb, (Poly (Place $letter.bar  $size)))
  $g.FillPolygon($wb, (Poly (Place $letter.stem $size)))
  $g.Dispose()
  return $out
}

# Every size Windows asks for, drawn rather than interpolated. The shell wants
# 16, 20, 24, 32, 40, 48, 64, 96, 128 and 256 depending on where the icon is
# shown and how the display is scaled; a size that is missing is one the shell
# resamples for itself, which is where a blurry taskbar icon comes from.
$sizes = @(16, 20, 24, 28, 30, 32, 36, 40, 44, 48, 50, 56, 60, 64, 71, 72, 80, 89, 96, 107, 128, 142, 150, 256, 284, 310, 512, 1024)
foreach ($s in $sizes) {
  $bmp = Render $s
  $bmp.Save("$root\png\$s.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# Into the two places the application actually reads them from. Every Tauri icon
# is replaced except icon.icns, which is the macOS bundle icon and needs a mac
# toolchain to write; the Windows build does not read it.
$icons = Join-Path $repo "apps\editor\src-tauri\icons"
$public = Join-Path $repo "apps\editor\public"
New-Item -ItemType Directory -Force -Path $public | Out-Null

$named = [ordered]@{
  "32.png"   = "32x32.png"
  "128.png"  = "128x128.png"
  "256.png"  = "128x128@2x.png"
  "1024.png" = "icon.png"
  "30.png"   = "Square30x30Logo.png"
  "44.png"   = "Square44x44Logo.png"
  "50.png"   = "StoreLogo.png"
  "71.png"   = "Square71x71Logo.png"
  "89.png"   = "Square89x89Logo.png"
  "107.png"  = "Square107x107Logo.png"
  "142.png"  = "Square142x142Logo.png"
  "150.png"  = "Square150x150Logo.png"
  "284.png"  = "Square284x284Logo.png"
  "310.png"  = "Square310x310Logo.png"
}

# Copy, and then say so if it did not take. Windows keeps icon files memory
# mapped for the thumbnail cache, and a mapped file refuses to be overwritten in
# place — so the target is removed first, and the result is checked rather than
# assumed.
function Install($from, $to) {
  if (Test-Path $to) { Remove-Item $to -Force -ErrorAction SilentlyContinue }
  Copy-Item $from $to -Force
  if (-not (Test-Path $to) -or (Get-FileHash $from).Hash -ne (Get-FileHash $to).Hash) {
    Write-Error "could not write $to - is it open somewhere?"
  }
}

foreach ($from in $named.Keys) {
  Install (Join-Path "$root\png" $from) (Join-Path $icons $named[$from])
}

python (Join-Path $root "make-ico.py")
Install (Join-Path $root "icon.ico") (Join-Path $icons "icon.ico")
Install (Join-Path $root "icon.ico") (Join-Path $public "favicon.ico")
Install (Join-Path $root "favicon.svg") (Join-Path $public "favicon.svg")

Write-Output "icons rendered and installed"
