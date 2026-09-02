# IMAI 业务数据库每日备份（原生 PG → C:\imai\backups，保留 14 天）
# 注册：schtasks /create /tn "IMAI Backup" /sc daily /st 03:00 /tr "powershell -ExecutionPolicy Bypass -File C:\Users\13906\.proma\agent-workspaces\im-llm\workspace-files\im-ai-office\scripts\backup-db.ps1"
$ErrorActionPreference = "Continue"
$env:PGPASSWORD = "imai_secret"
$bin = "C:\imai\pgsql\bin"
$dir = "C:\imai\backups"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
& "$bin\pg_dump.exe" -h 127.0.0.1 -U imai -d imai -f "$dir\imai-$stamp.sql"
& "$bin\pg_dump.exe" -h 127.0.0.1 -U imai -d imai_test -f "$dir\imai_test-$stamp.sql"
# 清理 14 天前的备份
Get-ChildItem $dir -Filter "*.sql" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Force
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') backup done: imai-$stamp.sql" | Add-Content "$dir\backup.log"
