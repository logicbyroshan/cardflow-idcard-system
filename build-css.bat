@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM ============================================
REM Frontend Build Script
REM ============================================
REM Production build (minified):  build-css.bat
REM Watch mode (development):     build-css.bat --watch
REM ============================================

SET "TW_CMD=node node_modules\@tailwindcss\cli\dist\index.mjs"
SET "TW_INPUT=tailwind-input.css"
SET "TW_OUTPUT=static\css\tailwind.css"
SET "TW_TEMP_OUTPUT=static\css\tailwind.__new.css"
SET "TW_BACKUP_OUTPUT=static\css\tailwind.__last_good.css"
SET "TW_CUSTOM_BASE=static\css\tailwind-custom-base.css"

IF NOT EXIST "node_modules\@tailwindcss\cli\dist\index.mjs" (
    echo ERROR: @tailwindcss/cli not found. Run: npm install @tailwindcss/cli
    exit /b 1
)

IF NOT EXIST "%TW_CUSTOM_BASE%" (
    echo ERROR: Missing %TW_CUSTOM_BASE%
    exit /b 1
)

IF NOT EXIST "%TW_INPUT%" (
    echo ERROR: Missing %TW_INPUT%
    exit /b 1
)

IF "%1"=="--watch" (
    echo Starting Tailwind CSS in watch mode...
    echo NOTE: Watch mode writes directly to live CSS and skips rollback protection.
    %TW_CMD% -i %TW_INPUT% -o %TW_OUTPUT% --watch
) ELSE (
    echo Building Tailwind CSS [production]...
    IF EXIST "%TW_OUTPUT%" copy /Y "%TW_OUTPUT%" "%TW_BACKUP_OUTPUT%" >nul
    IF EXIST "%TW_TEMP_OUTPUT%" del /Q "%TW_TEMP_OUTPUT%"

    %TW_CMD% -i %TW_INPUT% -o %TW_TEMP_OUTPUT% --minify
    IF ERRORLEVEL 1 (
        echo ERROR: Tailwind compile failed.
        call :restore_last_good
        exit /b 1
    )

    call :validate_css "%TW_TEMP_OUTPUT%"
    IF ERRORLEVEL 1 (
        call :restore_last_good
        exit /b 1
    )

    move /Y "%TW_TEMP_OUTPUT%" "%TW_OUTPUT%" >nul
    IF ERRORLEVEL 1 (
        echo ERROR: Could not replace live CSS with validated build output.
        call :restore_last_good
        exit /b 1
    )

    echo Done! Output: %TW_OUTPUT%

    echo.
    echo Building JS/CSS bundles...
    python build_bundles.py
    IF ERRORLEVEL 1 exit /b 1
    echo Done! Bundles in static/dist/
)

exit /b 0

:validate_css
SET "TARGET_CSS=%~1"
powershell -NoProfile -Command ^
 "$css = Get-Content -Path '%TARGET_CSS%' -Raw;" ^
 "$required = @(':root{--primary','--spacing-sidebar:','--spacing-topbar:','--color-body:','--color-primary:','--z-sidebar:','--space-xs','.sidebar{','.topbar{','.main{','.sidebar-logo','.sidebar-footer','.pagination-bar','.toast-wrapper','.notif-wrapper{','.notif-dropdown{','.notif-item{');" ^
 "$missing = @(); foreach ($token in $required) { if (-not $css.Contains($token)) { $missing += $token } };" ^
 "if ($missing.Count -gt 0) { Write-Host ('ERROR: Missing required CSS markers: ' + ($missing -join ', ')); exit 1 }"
exit /b %ERRORLEVEL%

:restore_last_good
IF EXIST "%TW_TEMP_OUTPUT%" del /Q "%TW_TEMP_OUTPUT%" >nul
IF EXIST "%TW_BACKUP_OUTPUT%" (
    copy /Y "%TW_BACKUP_OUTPUT%" "%TW_OUTPUT%" >nul
    echo Restored last known good CSS: %TW_OUTPUT%
) ELSE (
    echo WARNING: No previous CSS backup found. Nothing to restore.
)
exit /b 0
