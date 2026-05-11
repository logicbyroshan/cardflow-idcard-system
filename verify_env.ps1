Write-Host "--- Android Environment Check ---" -ForegroundColor Cyan

# 1. Check Java
$java = Get-Command java -ErrorAction SilentlyContinue
if ($java) {
    Write-Host "[OK] Java found: $(java -version 2>&1 | Select-Object -First 1)" -ForegroundColor Green
} else {
    Write-Host "[FAIL] Java (JDK) not found in Path." -ForegroundColor Red
}

# 2. Check ANDROID_HOME
if ($env:ANDROID_HOME) {
    if (Test-Path $env:ANDROID_HOME) {
        Write-Host "[OK] ANDROID_HOME is set and path exists: $env:ANDROID_HOME" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] ANDROID_HOME is set but path does not exist: $env:ANDROID_HOME" -ForegroundColor Red
    }
} else {
    Write-Host "[FAIL] ANDROID_HOME environment variable is missing." -ForegroundColor Red
}

# 3. Check adb
$adb = Get-Command adb -ErrorAction SilentlyContinue
if ($adb) {
    Write-Host "[OK] Android Debug Bridge (adb) found." -ForegroundColor Green
} else {
    Write-Host "[FAIL] adb not found. Ensure 'platform-tools' is in your Path." -ForegroundColor Red
}

Write-Host "-------------------------------"
if ($java -and $env:ANDROID_HOME -and $adb) {
    Write-Host "Your environment is READY for local builds!" -ForegroundColor Green -BackgroundColor Black
} else {
    Write-Host "Please follow the setup_android_guide.md to fix the missing components." -ForegroundColor Yellow
}
