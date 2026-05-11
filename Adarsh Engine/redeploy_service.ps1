# redeploy_service.ps1 — Stop service, rebuild exe, copy, restart
# Run as Administrator
$ErrorActionPreference = "Continue"
$nssm = "C:\Users\roshan\AppData\Local\Microsoft\WinGet\Packages\NSSM.NSSM_Microsoft.Winget.Source_8wekyb3d8bbwe\nssm-2.24-101-g897c7ad\win64\nssm.exe"

Write-Host "Stopping service..." -ForegroundColor Yellow
& $nssm stop AdarshEngine 2>$null
Start-Sleep 3

Write-Host "Copying new exe..." -ForegroundColor Green
Copy-Item "C:\Users\roshan\Desktop\Adarsh Engine\dist\AdarshEngine.exe" "C:\Program Files\Adarsh Engine\AdarshEngine.exe" -Force

Write-Host "Clearing old logs..." -ForegroundColor Yellow
Remove-Item "C:\Program Files\Adarsh Engine\logs\adarsh_engine.log*" -Force -ErrorAction SilentlyContinue

Write-Host "Starting service..." -ForegroundColor Green
& $nssm start AdarshEngine
Start-Sleep 10

Write-Host "`n=== SC QUERY ===" -ForegroundColor Cyan
sc.exe query AdarshEngine

Write-Host "`n=== PORT CHECK ===" -ForegroundColor Cyan
netstat -ano | Select-String "4765"

Write-Host "`nDone! Press Enter."
Read-Host
