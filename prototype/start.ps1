$ErrorActionPreference = 'Stop'
$taskUrl = 'http://127.0.0.1:8768'
try {
    $taskHealth = Invoke-RestMethod -Uri "$taskUrl/api/health" -TimeoutSec 2
    if ($taskHealth.app -eq 'misha-library') { Start-Process $taskUrl; exit 0 }
    throw 'Port 8768 is occupied by another application.'
} catch {
    if ($_.Exception.Message -eq 'Port 8768 is occupied by another application.') { throw }
}
$taskPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    $taskPython = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
    if (-not $taskPython) { $taskPython = (Get-Command py.exe -ErrorAction Stop).Source }
}
$taskServer = Join-Path $PSScriptRoot 'server.py'
$taskProcess = Start-Process -FilePath $taskPython -ArgumentList @('"' + $taskServer + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
$taskReady = $false
for ($taskAttempt = 0; $taskAttempt -lt 20; $taskAttempt++) {
    Start-Sleep -Milliseconds 250
    try {
        $taskHealth = Invoke-RestMethod -Uri "$taskUrl/api/health" -TimeoutSec 1
        if ($taskHealth.app -eq 'misha-library') { $taskReady = $true; break }
    } catch {}
    if ($taskProcess.HasExited) { break }
}
if (-not $taskReady) { throw 'Cannot start the library. Check Python and port 8768.' }
Start-Process $taskUrl
