@echo off
chcp 65001 >nul
PowerShell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync_to_122.ps1" -Continuous -IntervalSeconds 30
