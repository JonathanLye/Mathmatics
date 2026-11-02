# Proof Coach - Full-stack Demo launcher (PowerShell)
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not $env:PORT) { $env:PORT = "8787" }
$port = $env:PORT
$url = "http://127.0.0.1:$port/"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "[ERROR] Node.js not found. Install Node.js 18+." -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

Write-Host "============================================================"
Write-Host " Proof Coach - Full-stack Demo (frontend + backend)"
Write-Host "------------------------------------------------------------"
Write-Host " Frontend : $url"
Write-Host (" API      : " + $url + "api/health")
Write-Host " Docs     : README.md / docs/API.md"
Write-Host " Stop     : Ctrl + C"
Write-Host "============================================================"

$job = Start-Job -ScriptBlock {
  param($u)
  Start-Sleep -Seconds 2
  Start-Process $u
} -ArgumentList $url

node server\server.mjs
