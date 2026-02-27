# setup_service.ps1 — Install PassportEngine as a Windows Service (run as Admin)
$ErrorActionPreference = "Stop"

$exeSrc     = "C:\Users\roshan\Desktop\Face Cropper\dist\PassportEngine.exe"
$modelsSrc  = "C:\Users\roshan\Desktop\Face Cropper\models"
$installDir = "C:\Program Files\PassportEngine"
$logsDir    = "$installDir\logs"
$exeDest    = "$installDir\PassportEngine.exe"

# Refresh PATH to find nssm from winget install
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

Write-Host "`n=== PassportEngine Service Setup ===" -ForegroundColor Cyan

# 1. Create install directory
Write-Host "`n[1/6] Creating install directory..."
if (!(Test-Path $installDir)) { New-Item -ItemType Directory -Path $installDir -Force | Out-Null }
if (!(Test-Path $logsDir))    { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }

# 2. Copy exe
Write-Host "[2/6] Copying PassportEngine.exe..."
Copy-Item $exeSrc $exeDest -Force

# 3. Copy models
Write-Host "[3/6] Copying ML models..."
if (!(Test-Path "$installDir\models")) { New-Item -ItemType Directory -Path "$installDir\models" -Force | Out-Null }
Copy-Item "$modelsSrc\*" "$installDir\models\" -Force -Recurse

# 4. Copy VERSION.txt
Write-Host "[4/6] Copying VERSION.txt..."
Copy-Item "C:\Users\roshan\Desktop\Face Cropper\VERSION.txt" "$installDir\VERSION.txt" -Force

# 5. Remove old service if exists
Write-Host "[5/6] Removing old service (if any)..."
nssm stop PassportEngine 2>$null
nssm remove PassportEngine confirm 2>$null
Start-Sleep -Seconds 2

# 6. Install and configure service
Write-Host "[6/6] Installing service..."
nssm install PassportEngine "$exeDest"
nssm set PassportEngine DisplayName "Passport Photo Processing Engine"
nssm set PassportEngine Description "Local Passport Photo Processing Engine - API on 127.0.0.1:4765"
nssm set PassportEngine Start SERVICE_AUTO_START
nssm set PassportEngine ObjectName LocalSystem
nssm set PassportEngine AppEnvironmentExtra PASSPORT_ENGINE_MODE=service

# Restart on crash
nssm set PassportEngine AppExit Default Restart
nssm set PassportEngine AppRestartDelay 5000

# Logging
nssm set PassportEngine AppStdout "$logsDir\service.log"
nssm set PassportEngine AppStderr "$logsDir\error.log"
nssm set PassportEngine AppStdoutCreationDisposition 4
nssm set PassportEngine AppStderrCreationDisposition 4
nssm set PassportEngine AppRotateFiles 1
nssm set PassportEngine AppRotateBytes 5242880

# Start service
Write-Host "`nStarting service..."
nssm start PassportEngine
Start-Sleep -Seconds 8

# Verify
Write-Host "`n=== Service Status ===" -ForegroundColor Green
sc.exe query PassportEngine

Write-Host "`n=== Setup Complete ===" -ForegroundColor Cyan
Write-Host "Press any key to close..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
