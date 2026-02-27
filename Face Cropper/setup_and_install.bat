@echo off
REM ═══════════════════════════════════════════════════════════════
REM  setup_and_install.bat — Full setup: copy files + install service
REM  Right-click -> Run as Administrator
REM ═══════════════════════════════════════════════════════════════

:: Check admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Must run as Administrator!
    echo Right-click this file and select "Run as administrator"
    pause
    exit /b 1
)

set SRC=C:\Users\roshan\Desktop\Face Cropper
set DST=C:\Program Files\PassportEngine
set NSSM_DIR=C:\Users\roshan\AppData\Local\Microsoft\WinGet\Packages

echo.
echo ========================================
echo  PassportEngine Full Setup
echo ========================================
echo.

REM ── Find NSSM ──────────────────────────────────────────────
echo [1/7] Locating NSSM...
set NSSM=
for /r "%NSSM_DIR%" %%f in (nssm.exe) do (
    if exist "%%f" set NSSM=%%f
)
if "%NSSM%"=="" (
    where nssm >nul 2>&1
    if %errorlevel% equ 0 (
        for /f "tokens=*" %%i in ('where nssm') do set NSSM=%%i
    )
)
if "%NSSM%"=="" (
    echo ERROR: Cannot find nssm.exe
    pause
    exit /b 1
)
echo       Found: %NSSM%

REM ── Stop old service ───────────────────────────────────────
echo [2/7] Stopping old service...
"%NSSM%" stop PassportEngine >nul 2>&1
"%NSSM%" remove PassportEngine confirm >nul 2>&1
timeout /t 2 /nobreak >nul

REM ── Create directories ─────────────────────────────────────
echo [3/7] Creating directories...
if not exist "%DST%" mkdir "%DST%"
if not exist "%DST%\models" mkdir "%DST%\models"
if not exist "%DST%\logs" mkdir "%DST%\logs"

REM ── Copy files ─────────────────────────────────────────────
echo [4/7] Copying PassportEngine.exe...
copy /Y "%SRC%\dist\PassportEngine.exe" "%DST%\PassportEngine.exe"

echo [5/7] Copying models...
xcopy /Y /Q "%SRC%\models\*" "%DST%\models\"

echo       Copying VERSION.txt...
copy /Y "%SRC%\VERSION.txt" "%DST%\VERSION.txt"

REM ── Install service ────────────────────────────────────────
echo [6/7] Installing service...
"%NSSM%" install PassportEngine "%DST%\PassportEngine.exe"
if %errorlevel% neq 0 (
    echo ERROR: Service install failed!
    pause
    exit /b 1
)

"%NSSM%" set PassportEngine DisplayName "Passport Photo Processing Engine"
"%NSSM%" set PassportEngine Description "Local Passport Photo Processing Engine - API on 127.0.0.1:4765"
"%NSSM%" set PassportEngine Start SERVICE_AUTO_START
"%NSSM%" set PassportEngine ObjectName LocalSystem
"%NSSM%" set PassportEngine AppEnvironmentExtra PASSPORT_ENGINE_MODE=service
"%NSSM%" set PassportEngine AppExit Default Restart
"%NSSM%" set PassportEngine AppRestartDelay 5000
"%NSSM%" set PassportEngine AppStdout "%DST%\logs\service.log"
"%NSSM%" set PassportEngine AppStderr "%DST%\logs\error.log"
"%NSSM%" set PassportEngine AppStdoutCreationDisposition 4
"%NSSM%" set PassportEngine AppStderrCreationDisposition 4
"%NSSM%" set PassportEngine AppRotateFiles 1
"%NSSM%" set PassportEngine AppRotateBytes 5242880

REM ── Start service ──────────────────────────────────────────
echo [7/7] Starting service...
"%NSSM%" start PassportEngine
timeout /t 10 /nobreak >nul

echo.
echo ========================================
echo  Service Status:
echo ========================================
sc query PassportEngine
echo.
echo ========================================
echo  Port Check:
echo ========================================
netstat -ano | findstr 4765
echo.
echo Setup complete!
pause
