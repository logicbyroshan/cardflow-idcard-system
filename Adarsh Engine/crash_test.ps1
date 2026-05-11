# crash_test.ps1 — Kill the service process, wait, verify auto-restart
# Run as Administrator
$ErrorActionPreference = "Continue"

Write-Host "`n=== BEFORE KILL ===" -ForegroundColor Cyan
sc.exe query PassportEngine | Select-String "STATE"

Write-Host "`nKilling PassportEngine.exe..." -ForegroundColor Red
taskkill /IM PassportEngine.exe /F 2>&1

Write-Host "Waiting 10 seconds for auto-restart..." -ForegroundColor Yellow
Start-Sleep 10

Write-Host "`n=== AFTER KILL ===" -ForegroundColor Cyan
sc.exe query PassportEngine | Select-String "STATE"

Write-Host "`n=== PORT CHECK ===" -ForegroundColor Cyan
netstat -ano | Select-String "4765"

Write-Host "`n=== API CHECK ===" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:4765/status" -UseBasicParsing -TimeoutSec 5
    Write-Host "Response: $($r.Content)" -ForegroundColor Green
} catch {
    Write-Host "API not responding yet - may need more time" -ForegroundColor Red
}

Write-Host "`nPress Enter."
Read-Host
