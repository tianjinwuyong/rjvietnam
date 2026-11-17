$lines = Get-Content 'apps/web/src/agents/agentData.ts' -Encoding UTF8
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -like '*MES 产线层*') {
        Write-Host "Found at line $($i+1): $($lines[$i])"
        break
    }
}
