@echo off
REM ============================================
REM Tailwind CSS Build Script
REM ============================================
REM Production build (minified, purged):
REM   build-css.bat
REM
REM Watch mode (development):
REM   build-css.bat --watch
REM ============================================

IF "%1"=="--watch" (
    echo Starting Tailwind CSS in watch mode...
    .\tailwindcss.exe -i static/css/tailwind-input.css -o static/css/tailwind.css --watch
) ELSE (
    echo Building Tailwind CSS (production)...
    .\tailwindcss.exe -i static/css/tailwind-input.css -o static/css/tailwind.css --minify
    echo Done! Output: static/css/tailwind.css
)
