@echo off
REM ═══════════════════════════════════════════════════════════════════
REM  service_uninstall.bat — Remove PassportEngine Windows Service
REM  Run as Administrator.
REM ═══════════════════════════════════════════════════════════════════

echo.
echo Stopping PassportEngine Service...
echo.

nssm stop PassportEngine
timeout /t 3 /nobreak >nul
nssm remove PassportEngine confirm

echo.
echo Service removed.
echo.
pause
