#requires -Version 5.1
# Allow phone access to Solo Trading Charts on the local WiFi only.
# Must run elevated (Administrator).

$rules = @(
    @{ Name = "Solo Trading Charts - Web (3000)"; Port = 3000 },
    @{ Name = "Solo Trading Charts - API (8000)"; Port = 8000 }
)

foreach ($rule in $rules) {
    Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule -ErrorAction SilentlyContinue

    New-NetFirewallRule `
        -DisplayName $rule.Name `
        -Direction Inbound `
        -Protocol TCP `
        -LocalPort $rule.Port `
        -Action Allow `
        -Profile Any `
        -RemoteAddress LocalSubnet `
        -Description "Local WiFi access to Solo Trading Charts" | Out-Null
}

Write-Host ""
Write-Host "Solo Trading Charts is now reachable from your phone on the same WiFi." -ForegroundColor Green
Write-Host "Web: http://10.35.118.52:3000" -ForegroundColor Cyan
Write-Host ""
Start-Sleep -Seconds 4
