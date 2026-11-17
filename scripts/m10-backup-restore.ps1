param(
  [string]$SourceDatabase = 'smt_factory',
  [string]$RestoreDatabase = 'smt_factory_m10_restore_20260722',
  [string]$PostgresBin = 'D:\d\postgresql\bin',
  [string]$BackupDirectory = "$PSScriptRoot\..\backups\acceptance"
)
$ErrorActionPreference = 'Stop'
if ($RestoreDatabase -notlike 'smt_factory_m10_restore_*') { throw 'RestoreDatabase must use the isolated smt_factory_m10_restore_ prefix.' }
if (-not $env:PGPASSWORD) { throw 'Set PGPASSWORD before running this acceptance script.' }
$backupDirectoryResolved = [System.IO.Path]::GetFullPath($BackupDirectory)
New-Item -ItemType Directory -Force -Path $backupDirectoryResolved | Out-Null
$dumpPath = Join-Path $backupDirectoryResolved 'smt_factory_m10_20260722.dump'
& "$PostgresBin\dropdb.exe" -h 127.0.0.1 -p 5432 -U postgres --if-exists $RestoreDatabase
& "$PostgresBin\pg_dump.exe" -h 127.0.0.1 -p 5432 -U postgres -Fc --no-owner --no-privileges -f $dumpPath $SourceDatabase
if ($LASTEXITCODE -ne 0) { throw 'Backup failed.' }
& "$PostgresBin\createdb.exe" -h 127.0.0.1 -p 5432 -U postgres $RestoreDatabase
if ($LASTEXITCODE -ne 0) { throw 'Restore database creation failed.' }
& "$PostgresBin\pg_restore.exe" -h 127.0.0.1 -p 5432 -U postgres -d $RestoreDatabase --no-owner --no-privileges $dumpPath
if ($LASTEXITCODE -ne 0) { throw 'Restore failed.' }
Write-Output "RESTORE_READY=$RestoreDatabase"
Write-Output "BACKUP_FILE=$dumpPath"
Write-Output 'Run the documented comparison, then drop only the isolated restore database.'
