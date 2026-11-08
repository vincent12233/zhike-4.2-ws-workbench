[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath,
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
  throw "icon source does not exist: $SourcePath"
}

Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Bitmap]::new([IO.Path]::GetFullPath($SourcePath))
$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$images = @()

try {
  foreach ($size in $sizes) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.DrawImage($source, 0, 0, $size, $size)
    } finally {
      $graphics.Dispose()
    }

    $stream = [IO.MemoryStream]::new()
    try {
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      $images += [pscustomobject]@{ Size = $size; Data = $stream.ToArray() }
    } finally {
      $stream.Dispose()
      $bitmap.Dispose()
    }
  }
} finally {
  $source.Dispose()
}

$outputFullPath = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($outputFullPath)) | Out-Null
$writer = [IO.BinaryWriter]::new([IO.File]::Open($outputFullPath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None))
try {
  $writer.Write([uint16]0) # reserved
  $writer.Write([uint16]1) # icon type
  $writer.Write([uint16]$images.Count)
  $offset = 6 + (16 * $images.Count)
  foreach ($image in $images) {
    $dimension = if ($image.Size -eq 256) { [byte]0 } else { [byte]$image.Size }
    $writer.Write($dimension)
    $writer.Write($dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$image.Data.Length)
    $writer.Write([uint32]$offset)
    $offset += $image.Data.Length
  }
  foreach ($image in $images) {
    $writer.Write($image.Data)
  }
} finally {
  $writer.Dispose()
}

Write-Output (ConvertTo-Json @{ output = $outputFullPath; sizes = $sizes; bytes = (Get-Item -LiteralPath $outputFullPath).Length })
