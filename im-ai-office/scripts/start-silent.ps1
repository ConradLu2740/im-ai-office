# IMAI silent starter - executed by the "IMAI Autostart" scheduled task (or manually).
# Starts TS backend (tsx, no watch) only. Hidden windows, idempotent port cleanup.
# NOT a dev tool: use scripts/dev.ps1 for development (watch + web sync watcher).
param([string]$Root = "")

$ErrorActionPreference = "SilentlyContinue"
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
Set-Location $Root
$env:PYTHONUTF8 = "1"

# Kill stale listeners on 8000 (and legacy 8400 gateway, idempotent re-run)
foreach ($port in 8000, 8400) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Milliseconds 800

Start-Process "npx.cmd" -ArgumentList "tsx","src/index.ts" `
    -WorkingDirectory (Join-Path $Root "backend-ts") -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $Root "backend.log") `
    -RedirectStandardError (Join-Path $Root "backend.err.log")

# Wait and verify backend, log result
Start-Sleep -Seconds 8
try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/roles" -TimeoutSec 5
    $ok = $r.ok
} catch { $ok = $false }
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') autostart done, backend ok=$ok" |
    Add-Content (Join-Path $Root "autostart.log")
