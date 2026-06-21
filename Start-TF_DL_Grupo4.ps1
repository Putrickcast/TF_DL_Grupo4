param(
  [string]$NgrokDomain = "poker-parasitic-pulp.ngrok-free.dev",
  [string]$OllamaModel = "llama3.1:8b"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$CodexNodeBin = "C:\Users\andre\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$CodexPnpm = "C:\Users\andre\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd"
$NgrokExe = Join-Path $ProjectRoot ".tools\ngrok.exe"

function Test-CommandExists {
  param([string]$Command)
  $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Resolve-Pnpm {
  if (Test-CommandExists "pnpm") {
    return "pnpm"
  }
  if (Test-Path -LiteralPath $CodexPnpm) {
    return $CodexPnpm
  }
  throw "No se encontro pnpm. Instala pnpm o revisa la ruta empaquetada de Codex."
}

function New-ModuleWindow {
  param(
    [string]$Title,
    [string]$Command
  )

  $wrapped = @"
`$Host.UI.RawUI.WindowTitle = '$Title'
Set-Location -LiteralPath '$ProjectRoot'
if (Test-Path -LiteralPath '$CodexNodeBin') { `$env:PATH = '$CodexNodeBin;' + `$env:PATH }
$Command
Write-Host ''
Write-Host 'Proceso terminado. Presiona Enter para cerrar esta ventana...'
Read-Host
"@

  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $wrapped
  ) -WorkingDirectory $ProjectRoot
}

$Pnpm = Resolve-Pnpm

Write-Host "TF_DL_Grupo4 - lanzador de demo" -ForegroundColor Cyan
Write-Host "Proyecto: $ProjectRoot"
Write-Host "Frontend local: http://127.0.0.1:4200/"
Write-Host "RAG health: http://127.0.0.1:8787/api/health"
Write-Host "URL publica: https://$NgrokDomain"
Write-Host ""

if (-not (Test-Path -LiteralPath $NgrokExe)) {
  Write-Warning "No se encontro .tools\ngrok.exe. Descarga ngrok o ejecuta el setup previo antes de abrir el tunel publico."
}

Write-Host "Abriendo ventanas de monitoreo..." -ForegroundColor Green

New-ModuleWindow -Title "TF_DL_Grupo4 - Monitor General" -Command @"
Write-Host 'Monitor general en vivo'
Write-Host 'Local:  http://127.0.0.1:4200/'
Write-Host 'Public: https://$NgrokDomain'
Write-Host ''
while (`$true) {
  Clear-Host
  Write-Host 'TF_DL_Grupo4 - estado en vivo' -ForegroundColor Cyan
  Write-Host ('Hora: {0}' -f (Get-Date -Format 'HH:mm:ss'))
  Write-Host ''

  try {
    `$ollama = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 4
    `$models = ((`$ollama.Content | ConvertFrom-Json).models.name -join ', ')
    Write-Host ('Ollama     OK   modelos: {0}' -f `$models) -ForegroundColor Green
  } catch {
    Write-Host 'Ollama     ERROR no responde en 11434' -ForegroundColor Red
  }

  try {
    `$rag = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 4
    `$payload = `$rag.Content | ConvertFrom-Json
    Write-Host ('RAG API    OK   modelo: {0} | ollamaReachable: {1}' -f `$payload.model, `$payload.ollamaReachable) -ForegroundColor Green
  } catch {
    Write-Host 'RAG API    ERROR no responde en 8787' -ForegroundColor Red
  }

  try {
    `$angular = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4200/' -TimeoutSec 4
    Write-Host ('Angular    OK   http://127.0.0.1:4200/ status {0}' -f `$angular.StatusCode) -ForegroundColor Green
  } catch {
    Write-Host 'Angular    ERROR no responde en 4200' -ForegroundColor Red
  }

  try {
    `$public = Invoke-WebRequest -UseBasicParsing -Uri 'https://$NgrokDomain/api/health' -Headers @{ 'ngrok-skip-browser-warning'='true' } -TimeoutSec 8
    Write-Host ('ngrok      OK   https://$NgrokDomain status {0}' -f `$public.StatusCode) -ForegroundColor Green
  } catch {
    Write-Host 'ngrok      ERROR tunel publico no responde' -ForegroundColor Red
  }

  Write-Host ''
  Write-Host 'Este monitor se actualiza cada 8 segundos. Ctrl+C para detener solo esta ventana.'
  Start-Sleep -Seconds 8
}
"@

New-ModuleWindow -Title "TF_DL_Grupo4 - Ollama Monitor" -Command @"
Write-Host 'Monitoreando Ollama en http://127.0.0.1:11434'
Write-Host 'Modelo esperado: $OllamaModel'
Write-Host ''
while (`$true) {
  try {
    `$response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
    `$models = (`$response.Content | ConvertFrom-Json).models.name -join ', '
    Write-Host ('[{0}] Ollama OK. Modelos: {1}' -f (Get-Date -Format 'HH:mm:ss'), `$models) -ForegroundColor Green
  } catch {
    Write-Host ('[{0}] Ollama no responde. Abre Ollama Desktop o ejecuta: ollama serve' -f (Get-Date -Format 'HH:mm:ss')) -ForegroundColor Yellow
  }
  Start-Sleep -Seconds 10
}
"@

New-ModuleWindow -Title "TF_DL_Grupo4 - Backend RAG API" -Command @"
Write-Host 'Iniciando backend RAG en http://127.0.0.1:8787'
Write-Host 'Health: http://127.0.0.1:8787/api/health'
Write-Host 'Aqui veras cada request al RAG y cada pregunta del chatbot.'
Write-Host ''
`$env:OLLAMA_MODEL = '$OllamaModel'
& '$Pnpm' exec node server/rag-server.mjs
"@

Start-Sleep -Seconds 3

New-ModuleWindow -Title "TF_DL_Grupo4 - Angular Frontend" -Command @"
Write-Host 'Iniciando Angular en http://127.0.0.1:4200'
Write-Host 'Modo demo estable: compila Angular y sirve dist/TF_DL_Grupo4 con proxy /api.'
Write-Host ''
& '$Pnpm' run build
if (`$LASTEXITCODE -ne 0) { throw 'Build de Angular falló.' }
& node server/demo-server.mjs
"@

Start-Sleep -Seconds 6

if (Test-Path -LiteralPath $NgrokExe) {
  $ngrokCommand = "Set-Location -LiteralPath '$ProjectRoot'; & '$NgrokExe' http --url=$NgrokDomain --log=stdout --log-level=info http://127.0.0.1:4200 *> ngrok.log"
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $ngrokCommand
  ) -WorkingDirectory $ProjectRoot -WindowStyle Hidden
}

Write-Host ""
Write-Host "Ventanas abiertas." -ForegroundColor Green
Write-Host "Abre localmente:  http://127.0.0.1:4200/"
Write-Host "Comparte:         https://$NgrokDomain"
Write-Host ""
Write-Host "Tip: deja abiertas las ventanas de Monitor General, RAG, Angular y Ollama mientras otras personas prueban la demo."
