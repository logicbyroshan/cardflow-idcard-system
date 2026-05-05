@echo off
REM ═══════════════════════════════════════════════════════════════════
REM  service_uninstall.bat — Remove AdarshEngine Windows Service
REM  Run as Administrator.
REM ═══════════════════════════════════════════════════════════════════

echo.
echo Stopping AdarshEngine Service...
echo.

nssm stop AdarshEngine
timeout /t 3 /nobreak >nul
nssm remove AdarshEngine confirm

nssm stop PassportEngine >nul 2>&1
nssm remove PassportEngine confirm >nul 2>&1

echo.
echo Service removed.
echo.
pause
