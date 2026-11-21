$ErrorActionPreference = 'Stop'

function Invoke-DockerCompose {
    param(
        [Parameter(Mandatory = $true)][string]$Description,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    Write-Host "`n=== $Description ===" -ForegroundColor Cyan
    & docker compose @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Description falhou (exit code $LASTEXITCODE)."
    }
}

function Wait-ComposeHealth {
    param([string]$Service, [int]$TimeoutSeconds = 180)
    Write-Host "Aguardando $Service ficar healthy..." -ForegroundColor Yellow
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $id = (& docker compose ps --all --quiet $Service 2>$null | Select-Object -First 1)
        if ($id) {
            $state = (& docker inspect --format '{{.State.Status}}' $id 2>$null | Select-Object -First 1)
            $health = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $id 2>$null | Select-Object -First 1)
            if ($state -eq 'exited' -or $health -eq 'unhealthy') {
                & docker compose logs --no-color --tail=100 $Service
                throw "$Service encerrou ou ficou unhealthy (state=$state, health=$health)."
            }
            if ($health -eq 'healthy') {
                Write-Host "${Service}: healthy" -ForegroundColor Green
                return
            }
        }
        Start-Sleep -Seconds 2
    }
    & docker compose ps -a
    & docker compose logs --no-color --tail=100 $Service
    throw "Tempo limite aguardando $Service ficar healthy."
}

function Wait-ComposeRunning {
    param([string]$Service, [int]$TimeoutSeconds = 90)
    Write-Host "Aguardando $Service permanecer em execução..." -ForegroundColor Yellow
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $id = (& docker compose ps --all --quiet $Service 2>$null | Select-Object -First 1)
        if ($id) {
            $state = (& docker inspect --format '{{.State.Status}}' $id 2>$null | Select-Object -First 1)
            if ($state -eq 'exited' -or $state -eq 'dead') {
                & docker compose logs --no-color --tail=100 $Service
                throw "$Service encerrou inesperadamente (state=$state)."
            }
            if ($state -eq 'running') {
                Start-Sleep -Seconds 5
                $stateAgain = (& docker inspect --format '{{.State.Status}}' $id 2>$null | Select-Object -First 1)
                if ($stateAgain -eq 'running') {
                    Write-Host "${Service}: running" -ForegroundColor Green
                    return
                }
            }
        }
        Start-Sleep -Seconds 2
    }
    & docker compose ps -a
    & docker compose logs --no-color --tail=100 $Service
    throw "Tempo limite aguardando $Service iniciar."
}

try {
    Write-Host 'GreenCode AV3 — homologacao automatizada via Docker Compose' -ForegroundColor Green
    Write-Host 'Nenhum volume sera removido. O banco principal e o banco de testes permanecem separados.' -ForegroundColor Yellow

    Invoke-DockerCompose 'Validar Compose principal' @('config', '-q')
    Invoke-DockerCompose 'Validar Compose com perfil de testes' @('--profile', 'tests', 'config', '-q')

    Invoke-DockerCompose 'Construir imagens da API e do worker' @('build', 'api', 'worker')

    Invoke-DockerCompose 'Iniciar PostgreSQL e Redis principais' @('up', '-d', 'postgres', 'redis')
    Wait-ComposeHealth 'postgres'
    Wait-ComposeHealth 'redis'

    Invoke-DockerCompose 'Iniciar API e worker' @('up', '-d', 'api', 'worker')
    Wait-ComposeHealth 'api'
    Wait-ComposeRunning 'worker'

    Write-Host "`n=== Smoke tests HTTP ===" -ForegroundColor Cyan
    $health = Invoke-RestMethod -Uri 'http://localhost:3000/health' -Method Get -TimeoutSec 15
    if ($health.status -ne 'ok' -or $health.service -ne 'greencode-api') {
        throw "GET /health respondeu, mas o payload nao corresponde ao esperado: $($health | ConvertTo-Json -Compress)"
    }
    Write-Host 'GET /health: OK' -ForegroundColor Green

    $swagger = Invoke-WebRequest -Uri 'http://localhost:3000/docs/' -Method Get -TimeoutSec 20 -UseBasicParsing
    if ($swagger.StatusCode -ne 200) { throw "Swagger UI retornou HTTP $($swagger.StatusCode)." }
    Write-Host 'GET /docs/: HTTP 200' -ForegroundColor Green

    $openApi = Invoke-WebRequest -Uri 'http://localhost:3000/docs/json' -Method Get -TimeoutSec 20 -UseBasicParsing
    if ($openApi.StatusCode -ne 200) { throw "OpenAPI JSON retornou HTTP $($openApi.StatusCode)." }
    Write-Host 'GET /docs/json: HTTP 200' -ForegroundColor Green

    Invoke-DockerCompose 'Construir imagem isolada do test-runner' @('--profile', 'tests', 'build', 'test-runner')

    $testCommand = 'npm run prisma:validate && npm run build && npm run db:deploy && npm run db:seed && node --test dist/src/tests/*.test.js && node --test --test-concurrency=1 dist/src/tests/integration/*.integration.test.js'
    Invoke-DockerCompose 'Executar bateria unitária + integração no PostgreSQL/Redis de testes' @('--profile', 'tests', 'run', '--rm', 'test-runner', 'sh', '-c', $testCommand)

    Write-Host "`n=== Estado final dos containers ===" -ForegroundColor Cyan
    & docker compose ps -a
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel consultar o estado final dos containers.' }

    Write-Host "`nHOMOLOGACAO AUTOMATIZADA CONCLUIDA: build, healthchecks, Swagger, validacao Prisma, migrations, seed, testes unitarios e testes de integracao passaram." -ForegroundColor Green
    Write-Host 'Observacao: o fluxo real de geracao de relatorio pelo worker/Redis deve ser exercitado tambem pelo roteiro manual da API, se nao existir um teste E2E dedicado.' -ForegroundColor Yellow
}
catch {
    Write-Host "`nHOMOLOGACAO INTERROMPIDA: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "`nDiagnostico dos containers principais:" -ForegroundColor Yellow
    & docker compose ps -a
    & docker compose logs --no-color --tail=120 api worker postgres redis
    Write-Host "`nDiagnostico dos servicos de teste (quando iniciados):" -ForegroundColor Yellow
    & docker compose --profile tests ps -a
    & docker compose --profile tests logs --no-color --tail=100 test-runner postgres-test redis-test
    exit 1
}
