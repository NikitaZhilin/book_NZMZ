$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskLocal = Join-Path $taskRoot '.local'
New-Item -ItemType Directory -Path $taskLocal -Force | Out-Null
$taskStop = Join-Path $taskLocal 'stop-publish'
if (Test-Path -LiteralPath $taskStop) { Remove-Item -LiteralPath $taskStop }
$taskPython = Join-Path $taskRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { throw 'Project Python environment is missing.' }
$taskScript = Join-Path $PSScriptRoot 'auto_publish.py'
Start-Process -FilePath $taskPython -ArgumentList @('"' + $taskScript + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden
