$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\SMT-Factory-Watchdog.lnk")
$Shortcut.TargetPath = "C:\Users\tianj\Desktop\越南工厂瑞晶\越南工厂瑞晶\smt-factory-system\start-watchdog.bat"
$Shortcut.WorkingDirectory = "C:\Users\tianj\Desktop\越南工厂瑞晶\越南工厂瑞晶\smt-factory-system"
$Shortcut.Description = "SMT Factory Watchdog - keeps API(8080) and Vite(5178) alive"
$Shortcut.WindowStyle = 7  # Minimized, no activate
$Shortcut.Save()
Write-Host "Startup shortcut created in:"
Write-Host "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\SMT-Factory-Watchdog.lnk"
