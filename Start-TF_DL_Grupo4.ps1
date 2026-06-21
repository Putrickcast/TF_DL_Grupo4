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
$NgrokExe = Join-Path $ProjectRoot ".tools\ngrok.exe"

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

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
  Write-Host ('[{0}] Build frontend iniciado' -f (Get-Date -Format 'HH:mm:ss'))
  & '$CodexPnpm' run build
  if (`$LASTEXITCODE -ne 0) { throw 'Build de Angular fallo.' }
  Write-Host ('[{0}] Frontend demo en http://127.0.0.1:4200' -f (Get-Date -Format 'HH:mm:ss'))
  & '$CodexNode' server/demo-server.mjs
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
Write-Host "Abriendo 2 ventanas visibles: Monitor General y RAG y Modelos..." -ForegroundColor Green

Start-VisibleScript $monitorScript
Start-VisibleScript $ragScript
Start-HiddenScript $frontendScript
Start-HiddenScript $ngrokScript

Write-Host ""
Write-Host "Listo." -ForegroundColor Green
Write-Host "Deja abiertas solo las ventanas Monitor General y RAG y Modelos."
Write-Host "El frontend y ngrok corren ocultos. Logs: frontend.log y ngrok.log."
