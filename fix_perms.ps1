$dir = "C:\PostgreSQL\data"
$acl = Get-Acl $dir
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule("Everyone","ReadAndExecute","Allow")
$acl.AddAccessRule($rule)
Set-Acl $dir $acl
Write-Host "Added Everyone ReadAndExecute to $dir"

Get-ChildItem $dir -Recurse | ForEach-Object {
    $acl = Get-Acl $_.FullName
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule("Everyone","ReadAndExecute","Allow")
    $acl.AddAccessRule($rule)
    Set-Acl $_.FullName $acl
}
Write-Host "Fixed permissions recursively"
