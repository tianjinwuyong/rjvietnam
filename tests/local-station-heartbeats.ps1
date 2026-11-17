param([string]$MesBase = 'http://127.0.0.1:8080')

$stations = @(
  'manu_pda','manu_aio','wave_solder','manu_ict','manu_fct','manu_depanel',
  'manu_shellbinding','manu_assem_ate','manu_supersonic','manu_agingcab',
  'manu_hivolt_ate','manu_package_ate','manu_outer_box_binding',
  'manu_pallet_binding','manu_rework'
)

while ($true) {
  foreach ($station in $stations) {
    $body = @{
      agent = 'LOCAL_PREFLIGHT_HEARTBEAT'
      lineCode = 'L004'
      status = 'running'
      timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json
    try {
      Invoke-RestMethod -Method Post -Uri "$MesBase/api/mes/heartbeat/$station" `
        -ContentType 'application/json' -Body $body -TimeoutSec 3 | Out-Null
    } catch {
      # Retry on the next cycle; this process is only a local preflight signal source.
    }
  }
  Start-Sleep -Seconds 10
}
