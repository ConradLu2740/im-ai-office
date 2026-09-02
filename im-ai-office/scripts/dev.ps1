# IMAI 开发模式一键启动（DX Spec D6；TS 后端版，2026-09-02）
# 用法：powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
# 行为：杀旧后端 -> 起 tsx watch（改码即生效）-> 起 app.js/index.html 自动同步到 web/
$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Write-Host "[dev] 项目根：$root" -ForegroundColor Cyan

# ---- 0. 杀掉旧后端（按端口；8400 网关已下线，一并清理残留）----
foreach ($port in 8000, 8400) {
    try {
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    } catch {}
}
Start-Sleep -Milliseconds 500

# ---- 1. 后端（tsx watch，改 backend-ts/src 下代码自动重启）----
$backendLog = Join-Path $root "backend.log"
$backendProc = Start-Process "npx.cmd" -ArgumentList "tsx","watch","src/index.ts" `
    -WorkingDirectory (Join-Path $root "backend-ts") `
    -RedirectStandardOutput $backendLog -RedirectStandardError (Join-Path $root "backend.err.log") -PassThru -WindowStyle Hidden
Write-Host "[dev] 后端  pid=$($backendProc.Id)  http://127.0.0.1:8000  日志 backend.log（tsx watch 已开）" -ForegroundColor Green

# ---- 2. 前端同步监听：desktop/src/{app.js,index.html} 变更自动 cp 到 web/ ----
$watcher = Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "watch-sync.ps1"), "-Root", $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root "sync.log") -RedirectStandardError (Join-Path $root "sync.err.log")
Write-Host "[dev] 前端同步  pid=$($watcher.Id)  desktop/src/{app.js,index.html} -> web/（2s 轮询）" -ForegroundColor Green
