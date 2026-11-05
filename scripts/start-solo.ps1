#requires -Version 5.1
# Solo Trading Charts - one-click launcher
# Starts the API and the web app, then opens the browser.

$ErrorActionPreference = "Stop"

$root    = Split-Path -Parent $PSScriptRoot
$apiDir  = Join-Path $root "solo\services\api"
$webDir  = Join-Path $root "solo\apps\web"
$python  = Join-Path $apiDir ".venv\Scripts\python.exe"

function Test-Listening([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-Until([scriptblock]$Condition, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (& $Condition) { return $true }
        Start-Sleep -Milliseconds 750
    }
    return $false
}

function Get-NodePath {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        "C:\Users\Patel Hardik\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.20.0-win-x64\node.exe",
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

function Get-LanAddress {
    $address = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
        Sort-Object { $_.IPAddress -like "192.168.*" } -Descending |
        Select-Object -First 1 -ExpandProperty IPAddress
    return $address
}

Write-Host ""
Write-Host "  SOLO TRADING CHARTS" -ForegroundColor Cyan
Write-Host "  ===================" -ForegroundColor DarkGray
Write-Host ""

# ---------------------------------------------------------------- API server
if (Test-Listening 8000) {
    Write-Host "  [OK] API already running  (port 8000)" -ForegroundColor Green
}
else {
    if (-not (Test-Path $python)) {
        Write-Host "  [X]  Python environment not found:" -ForegroundColor Red
        Write-Host "      $python" -ForegroundColor DarkGray
        Read-Host "Press Enter to close"
        exit 1
    }

    Write-Host "  [..] Starting API server..." -NoNewline
    Start-Process -FilePath $python `
        -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000" `
        -WorkingDirectory $apiDir -WindowStyle Minimized

    if (Wait-Until { Test-Listening 8000 } 45) {
        Write-Host "`r  [OK] API started          (port 8000)" -ForegroundColor Green
    }
    else {
        Write-Host "`r  [X]  API did not start. Check that port 8000 is free." -ForegroundColor Red
    }
}

# ---------------------------------------------------------------- Web server
if (Test-Listening 3000) {
    Write-Host "  [OK] Website already running  (port 3000)" -ForegroundColor Green
}
else {
    $node = Get-NodePath
    if (-not $node) {
        Write-Host "  [X]  Node.js not found. Install it from https://nodejs.org" -ForegroundColor Red
        Read-Host "Press Enter to close"
        exit 1
    }

    $nodeDir = Split-Path -Parent $node
    $env:PATH = "$nodeDir;$env:PATH"
    $npm = Join-Path $nodeDir "npm.cmd"

    if (-not (Test-Path (Join-Path $webDir ".next\BUILD_ID"))) {
        Write-Host "  [..] First run: building website (this can take a few minutes)..." -ForegroundColor Yellow
        $build = Start-Process -FilePath $npm -ArgumentList "run", "build" `
            -WorkingDirectory $webDir -WindowStyle Maximized -Wait -PassThru
        if ($build.ExitCode -ne 0) {
            Write-Host "  [X]  Build failed. Run 'npm run build' in solo\apps\web to see the error." -ForegroundColor Red
            Read-Host "Press Enter to close"
            exit 1
        }
    }

    Write-Host "  [..] Starting website..." -NoNewline
    Start-Process -FilePath $npm -ArgumentList "run", "start" `
        -WorkingDirectory $webDir -WindowStyle Minimized

    $ready = Wait-Until {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:3000/" -UseBasicParsing -TimeoutSec 5
            $response.StatusCode -eq 200
        }
        catch { $false }
    } 75

    if ($ready) {
        Write-Host "`r  [OK] Website started        (port 3000)" -ForegroundColor Green
    }
    else {
        Write-Host "`r  [X]  Website did not start. Check the minimized Node window for errors." -ForegroundColor Red
    }
}

# ---------------------------------------------------------------- Open browser
$lan = Get-LanAddress

Write-Host ""
Write-Host "  Open in your browser:" -ForegroundColor White
Write-Host "    http://127.0.0.1:3000" -ForegroundColor Cyan
if ($lan) {
    Write-Host "    http://${lan}:3000   (phone, same WiFi)" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "  Keep this window open. Press Enter to close it" -ForegroundColor DarkGray
Write-Host "  (the servers keep running in the background)." -ForegroundColor DarkGray
Write-Host ""

Start-Process "http://127.0.0.1:3000"
Read-Host
