$ErrorActionPreference = "Continue"

# -- Paths --
$engineDir  = $PSScriptRoot   # This script lives inside the engine folder
$python     = Join-Path $engineDir  "venv\Scripts\python.exe"
$mainPy     = Join-Path $engineDir  "main.py"
$nssm       = Join-Path $engineDir  "nssm.exe"
$logs       = Join-Path $engineDir  "logs"

# Fallback nssm locations
if (-not (Test-Path $nssm)) {
    $nssm = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter "nssm.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
}
if (-not $nssm) { $nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source }

Write-Host "Engine dir : $engineDir" -ForegroundColor Cyan
Write-Host "Python     : $python" -ForegroundColor Cyan
Write-Host "NSSM       : $nssm" -ForegroundColor Cyan

if (-not (Test-Path $python)) {
    Write-Host "ERROR: Python venv not found at $python" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not $nssm -or -not (Test-Path $nssm)) {
    Write-Host "ERROR: nssm.exe not found. Install via: winget install NSSM.NSSM" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# -- Remove old service (all legacy names) --
Write-Host "`nStopping old services..." -ForegroundColor Yellow
foreach ($svc in @('AdarshEngine', 'AdarshCropper', 'PassportEngine')) {
    & $nssm stop $svc 2>$null
    & $nssm remove $svc confirm 2>$null
}
Start-Sleep 2

# ── Ensure logs dir ─────────────────────────────────────────────────────
if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Path $logs -Force | Out-Null }

# -- Install service (source-based, uses venv Python) --
Write-Host "Installing AdarshEngine service (source-based)..." -ForegroundColor Green
& $nssm install AdarshEngine $python
& $nssm set AdarshEngine AppParameters $mainPy
& $nssm set AdarshEngine AppDirectory $engineDir
& $nssm set AdarshEngine DisplayName "Adarsh Engine - Photo Processing Engine"
& $nssm set AdarshEngine Description "Adarsh Engine - Local Photo Processing Engine on 127.0.0.1:4765 (source mode)"
& $nssm set AdarshEngine Start SERVICE_AUTO_START
& $nssm set AdarshEngine ObjectName LocalSystem
& $nssm set AdarshEngine AppEnvironmentExtra "PASSPORT_ENGINE_MODE=service"
& $nssm set AdarshEngine AppExit Default Restart
& $nssm set AdarshEngine AppRestartDelay 5000
& $nssm set AdarshEngine AppStdout "$logs\service.log"
& $nssm set AdarshEngine AppStderr "$logs\error.log"
& $nssm set AdarshEngine AppStdoutCreationDisposition 4
& $nssm set AdarshEngine AppStderrCreationDisposition 4
& $nssm set AdarshEngine AppRotateFiles 1
& $nssm set AdarshEngine AppRotateBytes 5242880
& $nssm set PassportEngine AppRotateFiles 1
& $nssm set PassportEngine AppRotateBytes 5242880

Write-Host "Starting service..." -ForegroundColor Green
& $nssm start AdarshEngine
Start-Sleep 10

Write-Host "`n=== SC QUERY ===" -ForegroundColor Cyan
sc.exe query AdarshEngine

Write-Host "`n=== PORT CHECK ===" -ForegroundColor Cyan
netstat -ano | Select-String "4765"

Write-Host "`nDone! Press Enter to close."
Read-Host
