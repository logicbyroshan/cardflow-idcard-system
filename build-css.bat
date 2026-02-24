@echo off
REM ============================================
REM Tailwind CSS Build Script
REM ============================================
REM Production build (minified):  build-css.bat
REM Watch mode (development):     build-css.bat --watch
REM ============================================

SET TW_CMD=node node_modules\@tailwindcss\cli\dist\index.mjs

IF NOT EXIST "node_modules\@tailwindcss\cli\dist\index.mjs" (
    echo ERROR: @tailwindcss/cli not found. Run: npm install @tailwindcss/cli
    exit /b 1
)

IF "%1"=="--watch" (
    echo Starting Tailwind CSS in watch mode...
    %TW_CMD% -i tailwind-input.css -o static/css/tailwind.css --watch
) ELSE (
    echo Building Tailwind CSS [production]...
    %TW_CMD% -i tailwind-input.css -o static/css/tailwind.css --minify
    echo Done! Output: static/css/tailwind.css
)
