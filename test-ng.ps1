$base = "http://127.0.0.1:8080"

# 1. Login
Write-Host "=== [1] Login ==="
$login = Invoke-RestMethod -Uri "$base/api/auth/login" -Method POST -ContentType "application/json" -Body (@{username="VN_OP_001";password="Factory@123"} | ConvertTo-Json)
$token = $login.data.token
Write-Host "Token: $($token.Substring(0, [Math]::Min(30, $token.Length)))..."
$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

# 2. Get available stations
Write-Host "`n=== [2] Get stations ==="
$stations = Invoke-RestMethod -Uri "$base/mes/stations" -Headers $headers
$stationList = $stations.data.items
Write-Host "Found $($stationList.Count) stations"
if ($stationList.Count -gt 0) {
    $stationList | Select-Object -First 3 | ForEach-Object { Write-Host "  - $($_.code) ($($_.lineCode))" }
}

# Pick a station to test with
$testStation = $stationList[0]
$stationCode = $testStation.code
$lineCode = $testStation.lineCode
Write-Host "`nUsing station: $stationCode on line: $lineCode"

# 3. Register a test SN
$testSN = "TEST-NG-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Write-Host "`n=== [3] Register SN: $testSN ==="
$checkin = Invoke-RestMethod -Uri "$base/mes/events" -Method POST -Headers $headers -Body (@{ payload = @{
    stationCode = $stationCode
    pcbSerial = $testSN
    eventType = "checkin"
    result = "OK"
    operator = "VN_OP_001"
} } | ConvertTo-Json)
Write-Host "Checkin result: $($checkin | ConvertTo-Json)"

# 4. Post an NG event at the station
Write-Host "`n=== [4] Post NG event ==="
$ngResult = Invoke-RestMethod -Uri "$base/mes/events" -Method POST -Headers $headers -Body (@{ payload = @{
    stationCode = $stationCode
    pcbSerial = $testSN
    eventType = "ng"
    result = "fail"
    defectCode = "ICT-001"
    defectDescription = "Capacitor short circuit"
    operator = "VN_OP_001"
} } | ConvertTo-Json)
Write-Host "NG posted, ngDefectId: $($ngResult.data.ngDefectId)"

# 5. Check upstream — should show BLOCK_NG if tested from a downstream station
Write-Host "`n=== [5] Upstream check for same SN at SAME station ==="
$upstream = Invoke-RestMethod -Uri "$base/mes/events/upstream-check/$([System.Uri]::EscapeDataString($testSN))?stationCode=$stationCode" -Headers $headers
$upstream | ConvertTo-Json | Write-Host

# 6. Check if SN is in ng_defect_records
Write-Host "`n=== [6] NG defect records for station ==="
$ngRecords = Invoke-RestMethod -Uri "$base/mes/stations/$stationCode/ng-defects" -Headers $headers
$ngRecords.data.items | Where-Object { $_.sn -eq $testSN } | ForEach-Object {
    Write-Host "  NG Record: SN=$($_.sn) defectCode=$($_.defectCode) stationCode=$($_.stationCode)"
}

Write-Host "`n=== DONE ==="
