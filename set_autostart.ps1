Set-Service -Name PostgreSQL_Standby -StartupType Automatic
Get-Service PostgreSQL_Standby | Format-Table Name,Status,StartType
