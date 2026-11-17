$rtf = Get-Content 'C:\Users\tianj\Desktop\越南工厂瑞晶\dc\PDA功能(1).rtf' -Raw
$text = $rtf -replace '\\par', "`n" -replace '\\[a-z]+\d*\s?', '' -replace '[{}]', '' -replace '\\s quot', '"' -replace "\\\\", ''
Write-Output $text
