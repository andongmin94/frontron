param(
    [string]$Output = "icon.ico",
    [string[]]$Files
)

if (-not $Files -or $Files.Count -eq 0) {
    # 파일명에 숫자 있으면 그 숫자로 정렬
    $Files = Get-ChildItem -File -Filter *.png |
        Sort-Object -Property {
            if ($_.BaseName -match '(\d+)') { [int]$Matches[1] } else { 9999 }
        } |
        Select-Object -ExpandProperty FullName
}

if (-not $Files -or $Files.Count -eq 0) {
    Write-Error "PNG 파일이 없습니다."
    exit 1
}

Add-Type -AssemblyName System.Drawing

$entries = @()

foreach ($f in $Files) {
    try {
        $img = [System.Drawing.Image]::FromFile($f)
    } catch {
        Write-Warning "로드 실패: $f"
        continue
    }

    $bytes = [IO.File]::ReadAllBytes($f)

    if ($img.Width -ne $img.Height) {
        Write-Warning "정사각 아님: $f (${($img.Width)}x$($img.Height))"
    }

    # ICO 헤더에서 256 은 0 으로 기록
    $w = if ($img.Width  -ge 256) { 0 } else { [byte]$img.Width }
    $h = if ($img.Height -ge 256) { 0 } else { [byte]$img.Height }

    $entries += [PSCustomObject]@{
        Width      = $w
        Height     = $h
        ColorCount = 0
        Reserved   = 0
        Planes     = 0
        BitCount   = 32
        BytesInRes = $bytes.Length
        ImageBytes = $bytes
    }

    $img.Dispose()
}

if (-not $entries) {
    Write-Error "유효한 PNG가 없습니다."
    exit 1
}

$fs = [IO.File]::Open($Output, [IO.FileMode]::Create, [IO.FileAccess]::Write)
$bw = New-Object IO.BinaryWriter($fs)

# ICONDIR
$bw.Write([UInt16]0)              # Reserved
$bw.Write([UInt16]1)              # Type (icon)
$bw.Write([UInt16]$entries.Count) # Count

# Directory entries
$offset = 6 + (16 * $entries.Count)
foreach ($e in $entries) {
    $bw.Write([Byte]$e.Width)
    $bw.Write([Byte]$e.Height)
    $bw.Write([Byte]$e.ColorCount)
    $bw.Write([Byte]$e.Reserved)
    $bw.Write([UInt16]$e.Planes)
    $bw.Write([UInt16]$e.BitCount)
    $bw.Write([UInt32]$e.BytesInRes)
    $bw.Write([UInt32]$offset)
    $offset += $e.BytesInRes
}

# Image data blocks
foreach ($e in $entries) {
    $bw.Write($e.ImageBytes)
}

$bw.Flush()
$bw.Dispose()
$fs.Close()

Write-Host "생성 완료: $Output"