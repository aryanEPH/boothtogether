@echo off
title BoothTogether Server
echo ===================================================
echo     Starting BoothTogether Virtual Photobooth
echo ===================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    node server.js
) else (
    set ELECTRON_RUN_AS_NODE=1
    if exist "C:\Users\aryan_79ip5n1\AppData\Local\Programs\antigravity\Antigravity.exe" (
        "C:\Users\aryan_79ip5n1\AppData\Local\Programs\antigravity\Antigravity.exe" server.js
    ) else (
        echo [ERROR] Node.js is not found in PATH.
        echo Please install Node.js from https://nodejs.org or run with agy-node.
        pause
    )
)
