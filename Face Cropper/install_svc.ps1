$ErrorActionPreference = "Continue"

# ── Paths ────────────────────────────────────────────────────────────────
$projectDir = Split-Path -Parent $PSScriptRoot   # Adarsh Admin New
$engineDir  = Join-Path $projectDir "Face Cropper"
$python     = Join-Path $engineDir  "venv\Scripts\python.exe"
$mainPy     = Join-Path $engineDir  "main.py"
$nssm       = Join-Path $engineDir  "installer\nssm.exe"
$logs       = Join-Path $engineDir  "logs"

# Fallback nssm location
if (-not (Test-Path $nssm)) {
    $nssm = "C:\Users\roshan\AppData\Local\Microsoft\WinGet\Packages\NSSM.NSSM_Microsoft.Winget.Source_8wekyb3d8bbwe\nssm-2.24-101-g897c7ad\win64\nssm.exe"
}

Write-Host "Engine dir : $engineDir" -ForegroundColor Cyan
Write-Host "Python     : $python" -ForegroundColor Cyan
Write-Host "NSSM       : $nssm" -ForegroundColor Cyan

if (-not (Test-Path $python)) {
    Write-Host "ERROR: Python venv not found at $python" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# ── Remove old service ──────────────────────────────────────────────────
Write-Host "`nStopping old service..." -ForegroundColor Yellow
& $nssm stop PassportEngine 2>$null
& $nssm remove PassportEngine confirm 2>$null
Start-Sleep 2

# ── Ensure logs dir ─────────────────────────────────────────────────────
if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Path $logs -Force | Out-Null }

# ── Install service (source-based) ─────────────────────────────────────
Write-Host "Installing service (source-based)..." -ForegroundColor Green
& $nssm install PassportEngine $python
& $nssm set PassportEngine AppParameters $mainPy
& $nssm set PassportEngine AppDirectory $engineDir
& $nssm set PassportEngine DisplayName "Passport Photo Processing Engine"
& $nssm set PassportEngine Description "Local Passport Photo Engine on 127.0.0.1:4765 (source mode)"
& $nssm set PassportEngine Start SERVICE_AUTO_START
& $nssm set PassportEngine ObjectName LocalSystem
& $nssm set PassportEngine AppEnvironmentExtra "PASSPORT_ENGINE_MODE=service"
& $nssm set PassportEngine AppExit Default Restart
& $nssm set PassportEngine AppRestartDelay 5000
& $nssm set PassportEngine AppStdout "$logs\service.log"
& $nssm set PassportEngine AppStderr "$logs\error.log"
& $nssm set PassportEngine AppStdoutCreationDisposition 4
& $nssm set PassportEngine AppStderrCreationDisposition 4
& $nssm set PassportEngine AppRotateFiles 1
& $nssm set PassportEngine AppRotateBytes 5242880

Write-Host "Starting service..." -ForegroundColor Green
& $nssm start PassportEngine
Start-Sleep 10

Write-Host "`n=== SC QUERY ===" -ForegroundColor Cyan
sc.exe query PassportEngine

Write-Host "`n=== PORT CHECK ===" -ForegroundColor Cyan
netstat -ano | Select-String "4765"

Write-Host "`nDone! Press Enter to close."
Read-Host
