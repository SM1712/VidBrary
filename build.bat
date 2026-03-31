@echo off
title Vidbrary - Build .exe
echo.
echo  ========================================
echo    Vidbrary - Building .exe installer
echo  ========================================
echo.

:: Clean previous builds
echo [1/3] Cleaning previous builds...
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build

:: Build with PyInstaller
echo [2/3] Building with PyInstaller...
echo      This may take 2-5 minutes...
echo.
pyinstaller vidbrary.spec --noconfirm

:: Check result
echo.
if exist "dist\Vidbrary\Vidbrary.exe" (
    echo  ========================================
    echo    BUILD SUCCESSFUL!
    echo  ========================================
    echo.
    echo  Output: dist\Vidbrary\Vidbrary.exe
    echo.
    echo  [3/3] You can now:
    echo    1. Run dist\Vidbrary\Vidbrary.exe
    echo    2. Zip the dist\Vidbrary folder
    echo    3. Upload the zip to Google Drive
    echo.
) else (
    echo  ========================================
    echo    BUILD FAILED - Check errors above
    echo  ========================================
)

pause
