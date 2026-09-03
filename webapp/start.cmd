@echo off
rem 喵喵茶記 Boba Cat — 一鍵開啟（需要 Node.js 18+）
cd /d "%~dp0"
where node >nul 2>nul || (echo 請先安裝 Node.js: https://nodejs.org & pause & exit /b 1)
start "" http://localhost:8080
node server.js
