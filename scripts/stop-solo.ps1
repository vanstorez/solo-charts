#requires -Version 5.1
# Solo Trading Charts - stop both servers.

$ports = @(8000, 3000)
$stopped = @()

foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
        try {
            Stop-Process -Id $connection.OwningProcess -Force -ErrorAction Stop
            $stopped += $port
        }
        catch { }
    }
}

if ($stopped.Count -gt 0) {
    Write-Host "Solo Trading Charts stopped (ports: $($stopped -join ', '))." -ForegroundColor Green
}
else {
    Write-Host "Solo Trading Charts was not running." -ForegroundColor Yellow
}

Start-Sleep -Seconds 2
