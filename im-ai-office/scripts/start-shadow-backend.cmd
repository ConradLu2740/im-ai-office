@echo off
rem IMAI shadow backend: Jev gate shadow mode + imai_test DB + port 8001
rem Usage: double-click this file, or: powershell Start-Process scripts\start-shadow-backend.cmd
rem Stop: taskkill /F /PID <the node process listening on 8001>
cd /d %~dp0..\backend-ts
set DATABASE_URL=postgresql://imai:imai_secret@127.0.0.1:5432/imai_test
set IMAI_TS_PORT=8001
set IMAI_REMIND_INTERVAL_SEC=0
echo [shadow-backend] starting on port 8001 - imai_test - gate jev shadow
node dist\index.js
