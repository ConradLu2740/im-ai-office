# IMAI silent starter - executed by the "IMAI Autostart" scheduled task (or manually).
# Starts backend (uvicorn, no --reload) + gateway, hidden windows, idempotent port cleanup.
# NOT a dev tool: use scripts/dev.ps1 for development (reload + web sync watcher).
param([string]$Root = "")

$ErrorActionPreference = "SilentlyContinue"
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
Set-Location $Root
$env:PYTHONUTF8 = "1"

# Kill stale listeners on 8000/8400 (idempotent re-run)
foreach ($port in 8000, 8400) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Milliseconds 800

Start-Process python -ArgumentList "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8000" `
    -WorkingDirectory $Root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $Root "backend.log") `
    -RedirectStandardError (Join-Path $Root "backend.err.log")

Start-Process node -ArgumentList "desktop\src\msg_gateway.bundle.cjs" `
    -WorkingDirectory $Root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $Root "gateway.log") `
    -RedirectStandardError (Join-Path $Root "gateway.err.log")

# Backend auto-logins the gateway (_gateway_auto_login); wait and verify, log result
Start-Sleep -Seconds 8
try {
    $gw = Invoke-RestMethod -Uri "http://127.0.0.1:8400/gw/ping" -TimeoutSec 5
    $connected = $gw.connected
} catch { $connected = $false }
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') autostart done, gateway connected=$connected" |
    Add-Content (Join-Path $Root "autostart.log")
