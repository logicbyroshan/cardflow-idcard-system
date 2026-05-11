@echo off
REM ═══════════════════════════════════════════════════════════════════
REM  service_install.bat — Install AdarshEngine as a Windows Service
REM  Run as Administrator.
REM ═══════════════════════════════════════════════════════════════════

echo.
echo Installing AdarshEngine Service...
echo.

REM ── Stop & remove previous installation (if any) ─────────────
nssm stop PassportEngine >nul 2>&1
nssm remove PassportEngine confirm >nul 2>&1
nssm stop AdarshEngine >nul 2>&1
nssm remove AdarshEngine confirm >nul 2>&1

REM ── Install service ──────────────────────────────────────────
nssm install AdarshEngine "C:\Program Files\Adarsh Engine\AdarshEngine.exe"
if %errorlevel% neq 0 (
    echo ERROR: Failed to install service. Is NSSM in PATH or same folder?
    pause
    exit /b 1
)

REM ── Configure ────────────────────────────────────────────────
nssm set AdarshEngine DisplayName "Adarsh Engine - Photo Processing Engine"
nssm set AdarshEngine Description "Adarsh Engine - Local Photo Processing Engine - API on 127.0.0.1:4765"
nssm set AdarshEngine Start SERVICE_AUTO_START
nssm set AdarshEngine ObjectName LocalSystem
nssm set AdarshEngine AppEnvironmentExtra PASSPORT_ENGINE_MODE=service

REM ── Restart on crash ─────────────────────────────────────────
nssm set AdarshEngine AppExit Default Restart
nssm set AdarshEngine AppRestartDelay 5000

REM ── Logging ──────────────────────────────────────────────────
if not exist "C:\Program Files\Adarsh Engine\logs" (
    mkdir "C:\Program Files\Adarsh Engine\logs"
)
nssm set AdarshEngine AppStdout "C:\Program Files\Adarsh Engine\logs\service.log"
nssm set AdarshEngine AppStderr "C:\Program Files\Adarsh Engine\logs\error.log"
nssm set AdarshEngine AppStdoutCreationDisposition 4
nssm set AdarshEngine AppStderrCreationDisposition 4
nssm set AdarshEngine AppRotateFiles 1
nssm set AdarshEngine AppRotateBytes 5242880

REM ── Start service ────────────────────────────────────────────
nssm start AdarshEngine
if %errorlevel% neq 0 (
    echo WARNING: Service installed but failed to start.
    echo          Check logs at C:\Program Files\Adarsh Engine\logs\
) else (
    echo.
    echo Service installed and started.
    echo Status: http://127.0.0.1:4765/status
)

echo.
pause
