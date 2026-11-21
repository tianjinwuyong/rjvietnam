$file = "C:\PostgreSQL\data\global\pg_control"
$acl = Get-Acl $file
$owner = [System.Security.Principal.NTAccount]"BUILTIN\Administrators"
$acl.SetOwner($owner)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule("Everyone","FullControl","Allow")
$acl.SetAccessRule($rule)
Set-Acl $file $acl
Write-Host "Fixed $file"
