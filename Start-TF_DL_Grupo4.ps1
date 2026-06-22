param(
  [string]$NgrokDomain = "poker-parasitic-pulp.ngrok-free.dev",
  [string]$OllamaModel = "llama3.1:8b"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$CodexNodeBin = "C:\Users\andre\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$CodexNode = Join-Path $CodexNodeBin "node.exe"
$CodexPnpm = "C:\Users\andre\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd"
$NgCmd = Join-Path $ProjectRoot "node_modules\.bin\ng.cmd"
$NgrokExe = Join-Path $ProjectRoot ".tools\ngrok.exe"

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

function Stop-ProjectRuntime {
  $patterns = @(
    'server/rag-server\.mjs',
    'server\\rag-server\.mjs',
    'server/demo-server\.mjs',
    'server\\demo-server\.mjs',
    'ng serve --host 127\.0\.0\.1 --port 4200',
    '@angular\\cli\\bin\\ng\.js',
    '@angular/cli/bin/ng\.js',
    '\\.runtime\\rag-modelos\.ps1',
    '\\.runtime\\frontend-demo\.ps1',
    '\\.runtime\\monitor-general\.ps1',
    '\\.runtime\\ngrok-public\.ps1',
    '\\.tools\\ngrok\.exe',
    '\.tools/ngrok\.exe'
  )

  $processes = Get-CimInstance Win32_Process | Where-Object {
    $commandLine = $_.CommandLine
    if (-not $commandLine) { return $false }
    foreach ($pattern in $patterns) {
      if ($commandLine -match $pattern) { return $true }
    }
    return $false
  }

  foreach ($process in $processes) {
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } catch {
      Write-Host ("No se pudo detener PID {0}: {1}" -f $process.ProcessId, $_.Exception.Message) -ForegroundColor Yellow
    }
  }

  foreach ($port in @(4200, 8787)) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
      try {
        Stop-Process -Id $connection.OwningProcess -Force -ErrorAction Stop
      } catch {
        Write-Host ("No se pudo liberar puerto {0} PID {1}: {2}" -f $port, $connection.OwningProcess, $_.Exception.Message) -ForegroundColor Yellow
      }
    }
  }
}

function Wait-HttpOk {
  param(
    [string]$Name,
    [string]$Url,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 4
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Write-Host ("{0} OK ({1})" -f $Name, $response.StatusCode) -ForegroundColor Green
        return $true
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  Write-Host ("{0} no respondio en {1} segundos: {2}" -f $Name, $TimeoutSeconds, $Url) -ForegroundColor Yellow
  return $false
}

function Write-ModuleScript {
  param(
    [string]$Name,
    [string]$Body
  )

  $path = Join-Path $RuntimeDir $Name
  $prefix = @"
`$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath '$ProjectRoot'
if (Test-Path -LiteralPath '$CodexNodeBin') { `$env:PATH = '$CodexNodeBin;' + `$env:PATH }
`$env:NG_CLI_ANALYTICS = 'false'

"@
  Set-Content -LiteralPath $path -Value ($prefix + $Body) -Encoding UTF8
  return $path
}

function Start-VisibleScript {
  param([string]$Path)
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$Path`"" `
    -WorkingDirectory $ProjectRoot
}

function Start-HiddenScript {
  param([string]$Path)
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$Path`"" `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden
}

$monitorScript = Write-ModuleScript "monitor-general.ps1" @"
`$Host.UI.RawUI.WindowTitle = 'TF_DL_Grupo4 - Monitor General'
while (`$true) {
  Clear-Host
  Write-Host 'TF_DL_Grupo4 - estado en vivo' -ForegroundColor Cyan
  Write-Host ('Hora: {0}' -f (Get-Date -Format 'HH:mm:ss'))
  Write-Host ''

  try {
    `$ollama = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 4
    `$models = ((`$ollama.Content | ConvertFrom-Json).models.name -join ', ')
    Write-Host ('Ollama        OK   modelos: {0}' -f `$models) -ForegroundColor Green
  } catch {
    Write-Host 'Ollama        ERROR no responde en 11434' -ForegroundColor Red
  }

  try {
    `$rag = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 4
    `$payload = `$rag.Content | ConvertFrom-Json
    Write-Host ('RAG API       OK   modelo: {0} | ollamaReachable: {1}' -f `$payload.model, `$payload.ollamaReachable) -ForegroundColor Green
  } catch {
    Write-Host 'RAG API       ERROR no responde en 8787' -ForegroundColor Red
  }

  try {
    `$frontend = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4200/' -TimeoutSec 4
    Write-Host ('Frontend      OK   status {0}' -f `$frontend.StatusCode) -ForegroundColor Green
  } catch {
    Write-Host 'Frontend      ERROR no responde en 4200' -ForegroundColor Red
  }

  try {
    `$public = Invoke-WebRequest -UseBasicParsing -Uri 'https://$NgrokDomain/api/health' -Headers @{ 'ngrok-skip-browser-warning'='true' } -TimeoutSec 8
    Write-Host ('ngrok publico OK   status {0}' -f `$public.StatusCode) -ForegroundColor Green
  } catch {
    Write-Host 'ngrok publico ERROR tunel publico no responde' -ForegroundColor Red
  }

  Write-Host ''
  Write-Host 'Actividad importante: preguntas del chatbot y eventos MLP/CNN/LLM aparecen en RAG y Modelos.'
  Write-Host 'Local:  http://127.0.0.1:4200/'
  Write-Host 'Public: https://$NgrokDomain'
  Write-Host 'Actualiza cada 15 segundos. Ctrl+C para detener solo esta ventana.'
  Start-Sleep -Seconds 15
}
"@

$ragScript = Write-ModuleScript "rag-modelos.ps1" @"
`$Host.UI.RawUI.WindowTitle = 'TF_DL_Grupo4 - RAG y Modelos'
Write-Host 'RAG y Modelos en vivo' -ForegroundColor Cyan
Write-Host 'Backend: http://127.0.0.1:8787'
Write-Host 'Aqui veras preguntas/respuestas del chatbot y eventos MLP/CNN/LLM.'
Write-Host ''
`$env:OLLAMA_MODEL = '$OllamaModel'
& '$CodexNode' server/rag-server.mjs
Write-Host ''
Write-Host 'Proceso terminado. Presiona Enter para cerrar esta ventana...'
Read-Host
"@

$frontendScript = Write-ModuleScript "frontend-demo.ps1" @"
& {
  Write-Host ('[{0}] Angular dev server iniciado en http://127.0.0.1:4200' -f (Get-Date -Format 'HH:mm:ss'))
  if (Test-Path -LiteralPath '$NgCmd') {
    & '$NgCmd' serve --host 127.0.0.1 --port 4200 --proxy-config proxy.conf.json --allowed-hosts=true
  } else {
    & '$CodexPnpm' start
  }
} *> (Join-Path '$ProjectRoot' 'frontend.log')
"@

$ngrokScript = Write-ModuleScript "ngrok-public.ps1" @"
& {
  for (`$i = 0; `$i -lt 45; `$i++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4200/' -TimeoutSec 2 | Out-Null
      break
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  if (Test-Path -LiteralPath '$NgrokExe') {
    & '$NgrokExe' http --url=$NgrokDomain --log=stdout --log-level=info http://127.0.0.1:4200
  } else {
    Write-Host 'No se encontro .tools\ngrok.exe'
  }
} *> (Join-Path '$ProjectRoot' 'ngrok.log')
"@

Write-Host "TF_DL_Grupo4 - lanzador de demo" -ForegroundColor Cyan
Write-Host "Proyecto: $ProjectRoot"
Write-Host "Frontend local: http://127.0.0.1:4200/"
Write-Host "RAG health: http://127.0.0.1:8787/api/health"
Write-Host "URL publica: https://$NgrokDomain"
Write-Host ""
Write-Host "Limpiando procesos previos de Angular/RAG/ngrok..." -ForegroundColor Yellow
Stop-ProjectRuntime
Start-Sleep -Seconds 2
Write-Host "Abriendo 2 ventanas visibles: Monitor General y RAG y Modelos..." -ForegroundColor Green

Start-VisibleScript $ragScript
Start-HiddenScript $frontendScript
Wait-HttpOk -Name "RAG API" -Url "http://127.0.0.1:8787/api/health" -TimeoutSeconds 35 | Out-Null
Wait-HttpOk -Name "Frontend" -Url "http://127.0.0.1:4200/" -TimeoutSeconds 45 | Out-Null
Start-HiddenScript $ngrokScript
Start-VisibleScript $monitorScript

Write-Host ""
Write-Host "Listo." -ForegroundColor Green
Write-Host "Deja abiertas solo las ventanas Monitor General y RAG y Modelos."
Write-Host "El frontend y ngrok corren ocultos. Logs: frontend.log y ngrok.log."
