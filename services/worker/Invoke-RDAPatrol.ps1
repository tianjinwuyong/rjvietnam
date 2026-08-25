# Invoke-RDAPatrol.ps1
# RDA Manager Patrol — runs every 30 minutes
# Checks for missing archives, anomaly detection, integrity

$ErrorActionPreference = "SilentlyContinue"
$repoRoot = "C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system"
$workerDir = "$repoRoot\services\worker"

& node "$workerDir\rda-manager.js" patrol 2>&1
