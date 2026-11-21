$file = "C:\PostgreSQL\data\backup_label"
$acl = Get-Acl $file
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule("Everyone","FullControl","Allow")
$acl.SetAccessRule($rule)
Set-Acl $file $acl
Write-Host "Fixed $file"
