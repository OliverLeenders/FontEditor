Add-Type -AssemblyName System.Drawing

$root = $PSScriptRoot
$repo = Split-Path -Parent $root
New-Item -ItemType Directory -Force -Path "$root\png" | Out-Null
$SS = 8

function Poly($pts) {
  $a = New-Object 'System.Drawing.PointF[]' ($pts.Count)
  for ($i = 0; $i -lt $pts.Count; $i++) { $a[$i] = New-Object System.Drawing.PointF($pts[$i][0], $pts[$i][1]) }
  return $a
}
function B($hex) { return New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($hex)) }
function Scale($pts, $k) {
  $out = @(); foreach ($p in $pts) { $out += ,@(($k * $p[0]), ($k * $p[1])) }; return $out
}

$FULL = @{
  left  = @(@(14,30),@(50,48),@(50,92),@(14,74))
  right = @(@(86,30),@(50,48),@(50,92),@(86,74))
  nick  = @(@(14,58),@(50,76),@(50,84),@(14,66))
  top   = @(@(50,12),@(86,30),@(50,48),@(14,30))
  bar   = @(@(29.48,30.18),@(50.36,19.74),@(55.40,22.26),@(34.52,32.70))
  stem  = @(@(37.40,26.22),@(42.44,23.70),@(62.60,33.78),@(57.56,36.30))
}
$SMALL = @{
  left  = @(@(14,30),@(50,48),@(50,92),@(14,74))
  right = @(@(86,30),@(50,48),@(50,92),@(86,74))
  nick  = $null
  top   = @(@(50,12),@(86,30),@(50,48),@(14,30))
  bar   = @(@(28.40,30.72),@(51.44,19.20),@(57.56,22.26),@(34.52,33.78))
  stem  = @(@(36.86,26.49),@(42.98,23.43),@(63.14,33.51),@(57.02,36.57))
}

$C = @{ left = "#EDF3F9"; right = "#7E97B2"; nick = "#2C6DAF"; top = "#131922"; t = "#FFFFFF" }

function Render($size) {
  $geo = if ($size -le 24) { $SMALL } else { $FULL }
  $big = New-Object System.Drawing.Bitmap ($size*$SS), ($size*$SS)
  $g = [System.Drawing.Graphics]::FromImage($big)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $k = ($size*$SS) / 100.0
  $g.FillPolygon((B $C.left),  (Poly (Scale $geo.left  $k)))
  $g.FillPolygon((B $C.right), (Poly (Scale $geo.right $k)))
  if ($null -ne $geo.nick) { $g.FillPolygon((B $C.nick), (Poly (Scale $geo.nick $k))) }
  $g.FillPolygon((B $C.top),   (Poly (Scale $geo.top   $k)))
  $wb = B $C.t
  $g.FillPolygon($wb, (Poly (Scale $geo.bar  $k)))
  $g.FillPolygon($wb, (Poly (Scale $geo.stem $k)))
  $g.Dispose()
  $out = New-Object System.Drawing.Bitmap $size, $size
  $g2 = [System.Drawing.Graphics]::FromImage($out)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g2.Clear([System.Drawing.Color]::Transparent)
  $g2.DrawImage($big, (New-Object System.Drawing.Rectangle 0, 0, $size, $size))
  $g2.Dispose(); $big.Dispose()
  return $out
}

$sizes = @(16, 20, 24, 30, 32, 44, 48, 50, 64, 71, 89, 107, 128, 142, 150, 256, 284, 310, 512, 1024)
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

