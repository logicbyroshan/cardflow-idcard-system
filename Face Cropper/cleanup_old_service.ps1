# cleanup_old_service.ps1 — Remove existing manual service + files
$ErrorActionPreference = "Continue"
$nssm = "C:\Users\roshan\AppData\Local\Microsoft\WinGet\Packages\NSSM.NSSM_Microsoft.Winget.Source_8wekyb3d8bbwe\nssm-2.24-101-g897c7ad\win64\nssm.exe"

Write-Host "Stopping service..." -ForegroundColor Yellow
& $nssm stop PassportEngine 2>$null
Start-Sleep 3

Write-Host "Removing service..." -ForegroundColor Yellow
& $nssm remove PassportEngine confirm 2>$null
Start-Sleep 2

Write-Host "Deleting old install folder..." -ForegroundColor Yellow
Remove-Item "C:\Program Files\PassportEngine" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "`nVerifying cleanup..."
$svc = sc.exe query PassportEngine 2>&1
if ($svc -like "*1060*") { Write-Host "Service removed OK" -ForegroundColor Green }
else { Write-Host "WARNING: Service still exists" -ForegroundColor Red; $svc }

$dir = Test-Path "C:\Program Files\PassportEngine"
if (-not $dir) { Write-Host "Install folder removed OK" -ForegroundColor Green }
else { Write-Host "WARNING: Folder still exists" -ForegroundColor Red }

Write-Host "`nDone! Press Enter."
Read-Host
