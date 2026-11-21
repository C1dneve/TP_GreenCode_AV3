# GreenCode AV3 - E2E real de relatorios publicos usando API + PostgreSQL + Redis/BullMQ + worker.
# Execute na raiz do projeto, com docker compose ja em execucao.
# Nao le nem imprime o .env, nao remove volumes e nao apaga registros.

$ErrorActionPreference = 'Stop'
$ApiBase = 'http://localhost:3000'

function Invoke-GreenCodeApi {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('GET','POST','PATCH','DELETE')][string]$Method,
        [Parameter(Mandatory = $true)][string]$Path,
        [hashtable]$Headers = @{},
        [object]$Body = $null
    )

    $params = @{
        Method      = $Method
        Uri         = "$ApiBase$Path"
        Headers     = $Headers
        TimeoutSec  = 40
        ErrorAction = 'Stop'
    }
    if ($null -ne $Body) {
        $params.ContentType = 'application/json; charset=utf-8'
        $params.Body = ConvertTo-Json -InputObject $Body -Depth 20 -Compress
    }

    try {
        return Invoke-RestMethod @params
    }
    catch {
        $details = $_.ErrorDetails.Message
        if (-not $details -and $_.Exception.Response) {
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                if ($stream) {
                    $reader = [System.IO.StreamReader]::new($stream)
                    $details = $reader.ReadToEnd()
                    $reader.Dispose()
                }
            } catch { }
        }
        if ($details) {
            throw "HTTP $Method $Path falhou: $details"
        }
        throw "HTTP $Method $Path falhou: $($_.Exception.Message)"
    }
}

function Wait-GreenCodeReport {
    param(
        [Parameter(Mandatory = $true)][string]$ReportId,
        [Parameter(Mandatory = $true)][hashtable]$Headers,
        [int]$TimeoutSeconds = 180
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $current = Invoke-GreenCodeApi -Method GET -Path "/api/v1/public/relatorios/$ReportId" -Headers $Headers
        $progress = if ($null -eq $current.progresso) { 0 } else { $current.progresso }
        Write-Host ("Relatorio {0}: status={1}; progresso={2}%" -f $ReportId, $current.status, $progress)

        if ($current.status -eq 'COMPLETED') {
            if (-not $current.downloadDisponivel) {
                throw "Relatorio $ReportId marcou COMPLETED, mas downloadDisponivel nao esta true."
            }
            return $current
        }
        if ($current.status -eq 'FAILED' -or $current.status -eq 'EXPIRED') {
            throw "Relatorio $ReportId terminou em $($current.status). Mensagem: $($current.mensagemErro)"
        }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)

    throw "Tempo limite de $TimeoutSeconds segundos aguardando o relatorio $ReportId. Consulte docker compose logs worker."
}

function Save-And-VerifyReport {
    param(
        [Parameter(Mandatory = $true)]$Report,
        [Parameter(Mandatory = $true)][hashtable]$Headers
    )

    $extension = $Report.formato.ToLowerInvariant()
    $target = Join-Path $env:TEMP ("greencode-e2e-{0}.{1}" -f $Report.id, $extension)
    $uri = "$ApiBase/api/v1/public/relatorios/$($Report.id)/download"

    try {
        $download = Invoke-WebRequest -Method GET -Uri $uri -Headers $Headers -OutFile $target -PassThru -TimeoutSec 60 -ErrorAction Stop
    }
    catch {
        throw "Download do relatorio $($Report.id) falhou: $($_.Exception.Message)"
    }

    if (-not (Test-Path $target)) { throw "O endpoint respondeu, mas o arquivo nao foi criado: $target" }
    $file = Get-Item $target
    if ($file.Length -le 0) { throw "O arquivo baixado esta vazio: $target" }

    if ($Report.formato -eq 'JSON') {
        try {
            $content = Get-Content -LiteralPath $target -Raw -Encoding UTF8
            $null = ConvertFrom-Json -InputObject $content -ErrorAction Stop
        }
        catch {
            throw "O arquivo JSON foi baixado, mas nao e um JSON valido: $($_.Exception.Message)"
        }
    }
    elseif ($Report.formato -eq 'CSV') {
        $content = Get-Content -LiteralPath $target -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($content)) { throw 'O arquivo CSV esta vazio.' }
    }

    Write-Host ("Download OK: HTTP {0}; {1} bytes; {2}" -f $download.StatusCode, $file.Length, $target) -ForegroundColor Green
    return $target
}

Write-Host 'GreenCode AV3 - E2E de relatorios publicos' -ForegroundColor Cyan
Write-Host 'Pre-requisito: API, PostgreSQL, Redis e worker devem estar em execucao.'

$health = Invoke-RestMethod -Method GET -Uri "$ApiBase/health" -TimeoutSec 10
if ($health.status -ne 'ok') { throw 'Healthcheck da API nao retornou status=ok.' }
Write-Host 'API health: OK' -ForegroundColor Green

$adminUser = Read-Host 'Usuario administrador configurado no .env'
if ([string]::IsNullOrWhiteSpace($adminUser)) { throw 'Usuario administrador nao informado.' }
$securePassword = Read-Host 'Senha do administrador (entrada oculta)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

$login = Invoke-GreenCodeApi -Method POST -Path '/api/v1/auth/login' -Body @{ usuario = $adminUser; senha = $adminPassword }
$adminPassword = $null
if (-not $login.accessToken) { throw 'Login nao retornou accessToken.' }
$adminHeaders = @{ Authorization = "Bearer $($login.accessToken)" }
Write-Host 'Login administrativo: OK' -ForegroundColor Green

# Utiliza uma organizacao ativa ja existente, criada pelo seed ou cadastrada anteriormente.
$orgPage = Invoke-GreenCodeApi -Method GET -Path '/api/v1/organizacoes?ativo=true&page=1&pageSize=100' -Headers $adminHeaders
$organizations = @($orgPage.data | Where-Object { $_.ativo -eq $true })
if ($organizations.Count -eq 0) {
    throw 'Nao existe organizacao ativa. Cadastre uma organizacao pelo sistema e execute novamente.'
}
$organization = $organizations[0]
Write-Host ("Organizacao ativa selecionada: {0} (ID omitido)" -f $organization.razaoSocial)

$suffix = [Guid]::NewGuid().ToString('N').Substring(0, 10)
$scopes = @('reports:read', 'reports:write')
$partnerBody = @{
    nome = "Homologacao E2E Relatorios $suffix"
    descricao = 'Parceiro tecnico temporario para homologacao do fluxo de relatorios AV3.'
    escopos = $scopes
    limiteRequisicoesPorMinuto = 300
    maxEquipamentosPorSubmissao = 100
    maxPayloadBytes = 1048576
    permiteLoteSemEquipamentos = $true
}
$partner = Invoke-GreenCodeApi -Method POST -Path '/api/v1/parceiros' -Headers $adminHeaders -Body $partnerBody
Write-Host ("Parceiro de homologacao criado: {0}" -f $partner.nome) -ForegroundColor Green

$association = Invoke-GreenCodeApi -Method POST -Path "/api/v1/parceiros/$($partner.id)/organizacoes" -Headers $adminHeaders -Body @{ organizacaoId = $organization.id }
if (-not $association.identificadorPublico) { throw 'Associacao criada sem identificador publico.' }
Write-Host 'Vinculo parceiro-organizacao: OK' -ForegroundColor Green

$keyBody = @{
    nome = "Chave E2E Relatorios $suffix"
    escopos = $scopes
    limiteRequisicoesPorMinuto = 300
    maxPayloadBytes = 1048576
}
$keyResult = Invoke-GreenCodeApi -Method POST -Path "/api/v1/parceiros/$($partner.id)/chaves" -Headers $adminHeaders -Body $keyBody
$apiSecret = $keyResult.segredo
if ([string]::IsNullOrWhiteSpace($apiSecret)) { throw 'Criacao da API Key nao retornou o segredo de uso unico.' }
$publicHeaders = @{ 'X-API-Key' = $apiSecret; 'X-Integration-ID' = $association.identificadorPublico }
Write-Host 'API Key criada com reports:read e reports:write. O segredo nao sera exibido.' -ForegroundColor Green

# Dois relatorios provam os formatos JSON e CSV atraves do caminho publico/Outbox/BullMQ/worker.
$requests = @(
    @{ tipo = 'operacional'; formato = 'JSON' },
    @{ tipo = 'rentabilidade'; formato = 'CSV' }
)
$createdReports = @()
foreach ($request in $requests) {
    $created = Invoke-GreenCodeApi -Method POST -Path '/api/v1/public/relatorios' -Headers $publicHeaders -Body $request
    if (-not $created.id) { throw "Solicitacao $($request.tipo)/$($request.formato) nao retornou ID." }
    $createdReports += $created
    Write-Host ("Solicitado: tipo={0}; formato={1}; status={2}; id={3}" -f $created.tipo, $created.formato, $created.status, $created.id) -ForegroundColor Green
}

$verifiedFiles = @()
foreach ($created in $createdReports) {
    $completed = Wait-GreenCodeReport -ReportId $created.id -Headers $publicHeaders
    $verifiedFiles += Save-And-VerifyReport -Report $completed -Headers $publicHeaders
}

# Confirma que ambos aparecem no historico visivel ao parceiro.
$history = Invoke-GreenCodeApi -Method GET -Path '/api/v1/public/relatorios?page=1&pageSize=100' -Headers $publicHeaders
foreach ($created in $createdReports) {
    $found = @($history.data | Where-Object { $_.id -eq $created.id }).Count -gt 0
    if (-not $found) { throw "Relatorio $($created.id) nao apareceu no historico do parceiro." }
}

Write-Host ''
Write-Host 'E2E APROVADO: solicitacao publica, Outbox, Redis/BullMQ, worker, status, historico e downloads JSON/CSV.' -ForegroundColor Green
Write-Host ("Parceiro criado: {0}" -f $partner.nome)
Write-Host ("Organizacao vinculada: {0}" -f $organization.razaoSocial)
Write-Host 'Arquivos baixados:'
$verifiedFiles | ForEach-Object { Write-Host " - $_" }
Write-Host ''
Write-Host 'Os registros do parceiro, vinculo, API Key e relatorios foram mantidos no banco para auditoria.' -ForegroundColor Yellow
Write-Host 'A API Key secreta nao foi impressa. Guarde-a apenas se precisar repetir chamadas deste parceiro; ela nao pode ser recuperada integralmente depois.'
