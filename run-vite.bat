@echo off
cd /d "%~dp0apps\web"
node "%~dp0node_modules\vite\bin\vite.js" --port 5178 --host 0.0.0.0
