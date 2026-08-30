# IMAI 一键测试（DX Spec D6）
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\test-env.ps1          # 快速层（guard/auth/remind，约 5s）
#   powershell -ExecutionPolicy Bypass -File scripts\test-env.ps1 -Full    # 全量（含 async/pg/eval，约 1-2min）
param([switch]$Full)
$ErrorActionPreference = "Continue"
$env:PYTHONUTF8 = "1"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# ---- 1. 依赖可达性检查（redis 6379 / pg 5432）----
function Test-Port([int]$p) {
    $c = New-Object Net.Sockets.TcpClient
    try { $c.Connect("127.0.0.1", $p); return $true } catch { return $false } finally { $c.Close() }
}
$fail = $false
foreach ($spec in @(@("Redis", 6379), @("PostgreSQL", 5432))) {
    $ok = Test-Port $spec[1]
    $mark = if ($ok) { "OK " } else { "MISSING" }
    Write-Host ("[env] {0,-12} 127.0.0.1:{1}  {2}" -f $spec[0], $spec[1], $mark) -ForegroundColor $(if ($ok) { "Green" } else { "Red" })
    if (-not $ok) { $fail = $true }
}
if ($fail -and -not $Full) { Write-Host "[env] 依赖缺失，先启动 deploy\docker-compose.yml 全家桶" -ForegroundColor Red; exit 1 }

# ---- 2. 确保 imai_test 库存在（guard_pg 用）----
python -c "import os;from dotenv import load_dotenv;load_dotenv();import psycopg2;con=psycopg2.connect(os.environ['DATABASE_URL']);con.autocommit=True;c=con.cursor();c.execute('SELECT 1 FROM pg_database WHERE datname=%s',('imai_test',));import sys;con.commit();c.execute('CREATE DATABASE imai_test') if not c.fetchone() else None;con.close();print('[env] imai_test 库就绪')" 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "[env] imai_test 检查跳过（无 PG 连接？）" -ForegroundColor Yellow }

# ---- 3. 分层执行 ----
if ($Full) {
    Write-Host "[test] 全量：tests/（含 async 真队列 + PG 方言 + eval 真模型）" -ForegroundColor Cyan
    python -m pytest tests/ -q
} else {
    Write-Host "[test] 快速层：guard + guard_auth + guard_remind（SQLite + fake_llm）" -ForegroundColor Cyan
    python -m pytest tests/guard tests/guard_auth tests/guard_remind -q
}
exit $LASTEXITCODE
