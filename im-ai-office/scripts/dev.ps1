# IMAI 开发模式一键启动（DX Spec D5；网关已收敛进后端，2026-09-02）
# 用法：powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
# 行为：杀旧后端 -> 起 uvicorn --reload（改码即生效）-> 起 app.js/index.html 自动同步到 web/
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

# ---- 1. 后端（uvicorn --reload，改 imai/ 下代码自动重启）----
$backendLog = Join-Path $root "backend.log"
$backendProc = Start-Process python -ArgumentList "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8000", "--reload" `
    -WorkingDirectory $root -RedirectStandardOutput $backendLog -RedirectStandardError (Join-Path $root "backend.err.log") -PassThru -WindowStyle Hidden
Write-Host "[dev] 后端  pid=$($backendProc.Id)  http://127.0.0.1:8000  日志 backend.log（--reload 已开）" -ForegroundColor Green

# ---- 2. 网关：已删除（网关收敛Spec 2026-09-02，实时收发走回调+SSE）----

# ---- 3. 前端同步监听：desktop/src/{app.js,index.html} 变更自动 cp 到 web/ ----
# 独立进程跑 watch-sync.ps1（Start-Job 会随本会话退出而死亡，实测 2026-08-30）
$watcher = Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "watch-sync.ps1"), "-Root", $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root "sync.log") -RedirectStandardError (Join-Path $root "sync.err.log")
Write-Host "[dev] 前端同步  pid=$($watcher.Id)  desktop/src/{app.js,index.html} -> web/（2s 轮询）" -ForegroundColor Green

Write-Host ""
Write-Host "[dev] 全部就绪。停止：Stop-Process -Name python,node 或关闭本窗口后手动杀端口。" -ForegroundColor Cyan
Write-Host "[dev] 浏览器访问 http://localhost:8000 ｜ 一键测试：scripts\test-env.ps1"
