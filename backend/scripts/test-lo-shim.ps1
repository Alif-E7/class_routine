$ErrorActionPreference = 'Continue'
$shimDir = Join-Path $env:TEMP ("lo-shim-test-" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $shimDir | Out-Null
$shim = Join-Path $shimDir "lo.bat"
$tmpOut = Join-Path $env:TEMP ("lo-out-" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $tmpOut | Out-Null
$inFile = Join-Path $shimDir "input.docx"
"dummy" | Out-File -FilePath $inFile -Encoding ascii

$batLines = @(
    "@echo off",
    'copy /Y NUL "%~4\input.pdf" >NUL',
    "exit /b 0"
)
$batLines -join "`r`n" | Out-File -FilePath $shim -Encoding ascii -NoNewline

Write-Host "shim: $shim"
Write-Host "outdir: $tmpOut"
Write-Host "infile: $inFile"
Write-Host "----- invoke via cmd /c with quoted shim path -----"
cmd.exe /c ('"' + $shim + '" --headless --convert-to pdf --outdir "' + $tmpOut + '" "' + $inFile + '"')
Write-Host "exitcode=$LASTEXITCODE"
Write-Host "----- outdir contents -----"
Get-ChildItem $tmpOut

Remove-Item -Recurse -Force $shimDir, $tmpOut -ErrorAction SilentlyContinue