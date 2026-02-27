# redeploy_service.ps1 — Stop service, rebuild exe, copy, restart
# Run as Administrator
$ErrorActionPreference = "Continue"
$nssm = "C:\Users\roshan\AppData\Local\Microsoft\WinGet\Packages\NSSM.NSSM_Microsoft.Winget.Source_8wekyb3d8bbwe\nssm-2.24-101-g897c7ad\win64\nssm.exe"

Write-Host "Stopping service..." -ForegroundColor Yellow
& $nssm stop PassportEngine 2>$null
Start-Sleep 3

Write-Host "Copying new exe..." -ForegroundColor Green
Copy-Item "C:\Users\roshan\Desktop\Face Cropper\dist\PassportEngine.exe" "C:\Program Files\PassportEngine\PassportEngine.exe" -Force

Write-Host "Clearing old logs..." -ForegroundColor Yellow
Remove-Item "C:\Program Files\PassportEngine\logs\passport_engine.log*" -Force -ErrorAction SilentlyContinue

Write-Host "Starting service..." -ForegroundColor Green
& $nssm start PassportEngine
Start-Sleep 10

Write-Host "`n=== SC QUERY ===" -ForegroundColor Cyan
sc.exe query PassportEngine

Write-Host "`n=== PORT CHECK ===" -ForegroundColor Cyan
netstat -ano | Select-String "4765"

Write-Host "`nDone! Press Enter."
Read-Host
