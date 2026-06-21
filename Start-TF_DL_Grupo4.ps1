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
Write-Host ''
`$env:OLLAMA_MODEL = '$OllamaModel'
& '$Pnpm' run rag
"@

Start-Sleep -Seconds 3

New-ModuleWindow -Title "TF_DL_Grupo4 - Angular Frontend" -Command @"
Write-Host 'Iniciando Angular en http://127.0.0.1:4200'
Write-Host 'El proxy /api apunta al backend RAG local.'
Write-Host ''
& '$Pnpm' start
"@

Start-Sleep -Seconds 6

if (Test-Path -LiteralPath $NgrokExe) {
  New-ModuleWindow -Title "TF_DL_Grupo4 - ngrok publico" -Command @"
Write-Host 'Abriendo tunel publico con ngrok'
Write-Host 'URL publica: https://$NgrokDomain'
Write-Host ''
& '$NgrokExe' http --url=$NgrokDomain 4200
"@
}

Write-Host ""
Write-Host "Ventanas abiertas." -ForegroundColor Green
Write-Host "Abre localmente:  http://127.0.0.1:4200/"
Write-Host "Comparte:         https://$NgrokDomain"
Write-Host ""
Write-Host "Tip: deja abiertas las ventanas de RAG, Angular y ngrok mientras otras personas prueban la demo."
