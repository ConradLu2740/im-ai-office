# IMAI 一键测试（TS 后端版，2026-09-02；Vitest）
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\test-env.ps1          # 全部守卫测试（约 5s）
param([switch]$Full)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $root "backend-ts")
Write-Host "[test] Vitest 守卫套件（PG: imai_test）..." -ForegroundColor Cyan
& npx vitest run 2>&1
Write-Host "[test] 完成。集成验收请跑: python scripts\acceptance.py（需后端已启动）" -ForegroundColor Cyan
