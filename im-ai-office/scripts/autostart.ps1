# IMAI autostart switch. Default state: OFF (nothing registered, no autostart).
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Action status   # default
#   powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Action enable   # register logon task
#   powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Action disable  # unregister
# Scope: backend + gateway only (OpenIM server is a separate docker deployment, out of scope).
param(
    [ValidateSet("enable", "disable", "status")][string]$Action = "status",
    [string]$Root = ""
)
$ErrorActionPreference = "Stop"
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$taskName = "IMAI Autostart"
$runner = Join-Path $PSScriptRoot "start-silent.ps1"

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

switch ($Action) {
    "status" {
        if ($existing) {
            $state = $existing.State
            Write-Host "[autostart] ON  (task '$taskName' exists, state=$state)" -ForegroundColor Green
        } else {
            Write-Host "[autostart] OFF (no scheduled task; default. enable: -Action enable)" -ForegroundColor Yellow
        }
    }
    "enable" {
        if ($existing) {
            Write-Host "[autostart] already ON, nothing to do." -ForegroundColor Yellow
            return
        }
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
        $taskAction = New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -Root `"$Root`""
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
        Register-ScheduledTask -TaskName $taskName -Trigger $trigger -Action $taskAction `
            -Settings $settings -Description "IMAI backend+gateway silent start at logon" | Out-Null
        Write-Host "[autostart] ON. Task '$taskName' registered (at logon, current user)." -ForegroundColor Green
        Write-Host "[autostart] Note: takes effect at next logon. Start now manually: powershell -File scripts\start-silent.ps1"
    }
    "disable" {
        if (-not $existing) {
            Write-Host "[autostart] already OFF." -ForegroundColor Yellow
            return
        }
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "[autostart] OFF. Task '$taskName' unregistered. Running processes are NOT killed." -ForegroundColor Green
    }
}
