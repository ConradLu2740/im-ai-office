# desktop/src -> web/ 同步监听（由 dev.ps1 以独立进程启动）
param([string]$Root)
if (-not $Root) { $Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$src = Join-Path $Root "desktop\src"
$dst = Join-Path $Root "web"
$files = "app.js", "index.html"
$last = @{}
while ($true) {
    foreach ($f in $files) {
        $p = Join-Path $src $f
        if (Test-Path $p) {
            $sig = (Get-FileHash $p -Algorithm MD5).Hash
            if ($last.ContainsKey($f) -and $sig -ne $last[$f]) {
                Copy-Item $p (Join-Path $dst $f) -Force
                Write-Host "[sync] $f -> web/"
            }
            $last[$f] = $sig
        }
    }
    Start-Sleep -Seconds 2
}
