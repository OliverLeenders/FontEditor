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
function Scale($pts, $k) {
  $out = @(); foreach ($p in $pts) { $out += ,@(($k * $p[0]), ($k * $p[1])) }; return $out
}

# The block, filling the square it is drawn in. An icon sits beside others in a
# taskbar and is read against them: art that stops at seven tenths of its canvas
# looks like a smaller program, whatever its own proportions are.
$BLOCK = @{
  left  = @(@(6.8,23.6),@(50,45.2),@(50,98),@(6.8,76.4))
  right = @(@(93.2,23.6),@(50,45.2),@(50,98),@(93.2,76.4))
  nick  = @(@(6.8,57.2),@(50,78.8),@(50,88.4),@(6.8,66.8))
  top   = @(@(50,2),@(93.2,23.6),@(50,45.2),@(6.8,23.6))
}

# The letter, in two weights, already sheared onto the face.
#
# The shear is not kind to a crossbar: it compresses the bar while leaving the
# stem near full width, so the arm that runs away from the viewer thins out
# first. At and below 48 pixels that arm is under a pixel and the T reads as a
# bent stick, so the bold cut is used there and the medium one is kept for the
# sizes with room for it.
$MEDIUM = @{
  bar  = @(@(25.376,23.816),@(50.432,11.288),@(56.48,14.312),@(31.424,26.84))
  stem = @(@(34.88,19.064),@(40.928,16.04),@(65.12,28.136),@(59.072,31.16))
}
$BOLD = @{
  bar  = @(@(24.08,24.464),@(51.728,10.64),@(59.072,14.312),@(31.424,28.136))
  stem = @(@(34.232,19.388),@(41.576,15.716),@(65.768,27.812),@(58.424,31.484))
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
  # Two decisions, and they do not turn over at the same size. The nick is a
  # six-unit slot: below 32 pixels it is less than two and reads as dirt, so it
  # goes. The letter turns bold earlier than that, at 48.
  $nick = $size -ge 32
  $letter = if ($size -le 48) { $BOLD } else { $MEDIUM }
  $out = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $k = $size / 100.0
  $g.FillPolygon((B $C.left),  (Poly (Scale $BLOCK.left  $k)))
  $g.FillPolygon((B $C.right), (Poly (Scale $BLOCK.right $k)))
  if ($nick) { $g.FillPolygon((B $C.nick), (Poly (Scale $BLOCK.nick $k))) }
  $g.FillPolygon((B $C.top),   (Poly (Scale $BLOCK.top   $k)))
  $wb = B $C.t
  $g.FillPolygon($wb, (Poly (Scale $letter.bar  $k)))
  $g.FillPolygon($wb, (Poly (Scale $letter.stem $k)))
  $g.Dispose()
  return $out
}

# Every size Windows asks for, drawn rather than interpolated. The shell wants
# 16, 20, 24, 32, 40, 48, 64, 96, 128 and 256 depending on where the icon is
# shown and how the display is scaled; a size that is missing is one the shell
# resamples for itself, which is where a blurry taskbar icon comes from.
$sizes = @(16, 20, 24, 30, 32, 36, 40, 44, 48, 50, 56, 60, 64, 71, 72, 89, 96, 107, 128, 142, 150, 256, 284, 310, 512, 1024)
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
