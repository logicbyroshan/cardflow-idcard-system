@echo off
REM ═══════════════════════════════════════════════════════════════════
REM  service_install.bat — Install PassportEngine as a Windows Service
REM  Run as Administrator.
REM ═══════════════════════════════════════════════════════════════════

echo.
echo Installing PassportEngine Service...
echo.

REM ── Stop & remove previous installation (if any) ─────────────
nssm stop PassportEngine >nul 2>&1
nssm remove PassportEngine confirm >nul 2>&1

REM ── Install service ──────────────────────────────────────────
nssm install PassportEngine "C:\Program Files\PassportEngine\PassportEngine.exe"
if %errorlevel% neq 0 (
    echo ERROR: Failed to install service. Is NSSM in PATH or same folder?
    pause
    exit /b 1
)

REM ── Configure ────────────────────────────────────────────────
nssm set PassportEngine DisplayName "Passport Photo Processing Engine"
nssm set PassportEngine Description "Local Passport Photo Processing Engine - API on 127.0.0.1:4765"
nssm set PassportEngine Start SERVICE_AUTO_START
nssm set PassportEngine ObjectName LocalSystem
nssm set PassportEngine AppEnvironmentExtra PASSPORT_ENGINE_MODE=service

REM ── Restart on crash ─────────────────────────────────────────
nssm set PassportEngine AppExit Default Restart
nssm set PassportEngine AppRestartDelay 5000

REM ── Logging ──────────────────────────────────────────────────
if not exist "C:\Program Files\PassportEngine\logs" (
    mkdir "C:\Program Files\PassportEngine\logs"
)
nssm set PassportEngine AppStdout "C:\Program Files\PassportEngine\logs\service.log"
nssm set PassportEngine AppStderr "C:\Program Files\PassportEngine\logs\error.log"
nssm set PassportEngine AppStdoutCreationDisposition 4
nssm set PassportEngine AppStderrCreationDisposition 4
nssm set PassportEngine AppRotateFiles 1
nssm set PassportEngine AppRotateBytes 5242880

REM ── Start service ────────────────────────────────────────────
nssm start PassportEngine
if %errorlevel% neq 0 (
    echo WARNING: Service installed but failed to start.
    echo          Check logs at C:\Program Files\PassportEngine\logs\
) else (
    echo.
    echo Service installed and started.
    echo Status: http://127.0.0.1:4765/status
)

echo.
pause
