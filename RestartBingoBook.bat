@echo off
cd /d "%~dp0"
start cmd /c node server.js
timeout /T 3 /NOBREAK >nul
start http://localhost:3000