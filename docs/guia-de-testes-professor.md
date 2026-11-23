# Guia de execução e testes — GreenCode AV3

Este roteiro permite iniciar o GreenCode, autenticar como administrador, configurar um parceiro de integração, percorrer o ciclo de vida público de lotes e solicitar relatórios. Ao final estão os comandos de testes e o significado das evidências. Os nomes de campos e os caminhos abaixo correspondem aos contratos publicados pelo Swagger.

## 1. Preparar o ambiente

### Requisitos

A execução recomendada para a avaliação usa Docker Desktop no Windows ou Docker Engine com o plugin Docker Compose em Linux. Nesse modo, PostgreSQL 17 e Redis 7 são iniciados em containers e não precisam estar instalados diretamente no host.

Para executar a API e o worker diretamente no host, utilize Node.js 24.x, PostgreSQL 17 e Redis 7 acessíveis pela máquina. Esse segundo modo é o indicado quando a avaliação precisa utilizar um banco PostgreSQL externo ou diferente do banco criado pelo Compose.

### Escolher o modo de execução

O projeto possui dois modos de conexão. É importante não misturar as URLs dos dois modos:

| Modo | Banco usado pela API | Redis usado pelo worker |
|---|---|---|
| Docker Compose | Serviço Compose `postgres`, porta interna `5432` | Serviço Compose `redis`, porta interna `6379` (não publicada no host) |
| API/worker no host | `DATABASE_URL` do `.env` | `REDIS_URL` do `.env`, apontando para um Redis acessível pelo host |

**Atenção ao comportamento atual do `docker-compose.yml`:** quando `api`, `worker` e `test-runner` são executados em containers, o Compose monta as URLs de conexão com base em `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB`. A API usa `postgres:5432`; o worker usa `postgres:5432` e `redis:6379`. O Redis do Compose não publica a porta `6379` no host, pois os serviços se comunicam pela rede interna do Compose. Isso evita conflito com um Redis local ou com outro clone do projeto. Portanto, nesses containers, a variável `DATABASE_URL` do `.env` — que aponta para `127.0.0.1:5433` — não seleciona um banco externo. Ela serve para comandos Prisma executados diretamente no Windows/Linux host. Da mesma forma, o `REDIS_URL` do `.env` é usado somente na execução local do worker; no Compose, o worker recebe `redis://redis:6379`.

Se a avaliação utilizar outro PostgreSQL externo, siga a subseção **Executar usando banco externo** mais abaixo. Não execute `docker compose up` esperando que a API dentro do container utilize automaticamente a `DATABASE_URL` externa: a configuração Compose atual não faz esse redirecionamento.

### Criar o arquivo de ambiente

Na raiz do projeto, copie o modelo apenas quando ainda não existir um `.env`:

**PowerShell**

```powershell
if (-not (Test-Path .\.env)) { Copy-Item .env.example .env }
```

**Bash**

```bash
if [ ! -f .env ]; then cp .env.example .env; fi
```

Não copie o `.env.example` por cima de um `.env` já configurado: isso pode substituir as credenciais locais existentes.

### Isolar esta cópia do projeto no Docker

O Docker Compose usa o nome do diretório como nome do projeto quando nenhum nome é informado. Como os volumes persistem mesmo depois que os containers são removidos, outro clone com o mesmo nome de pasta pode reutilizar um PostgreSQL inicializado anteriormente com outra senha. Para evitar esse conflito, cada cópia local deve receber um `COMPOSE_PROJECT_NAME` exclusivo. O nome é gravado no `.env` e permanece estável nas próximas inicializações.

Se você já executou esta cópia com Compose antes de configurar `COMPOSE_PROJECT_NAME`, pare primeiro os containers do projeto antigo com `docker compose down`. Esse comando remove containers e rede, mas preserva os volumes. Não use `-v`. Em um clone realmente novo, sem containers anteriores, pule esta etapa.

**Windows (PowerShell):**

```powershell
Remove-Item Env:COMPOSE_PROJECT_NAME -ErrorAction SilentlyContinue
$envLines = @(Get-Content .\.env)
$projectLine = $envLines | Where-Object { $_ -match '^COMPOSE_PROJECT_NAME=' } | Select-Object -First 1
if (-not $projectLine) {
    $envLines += 'COMPOSE_PROJECT_NAME=greencode-local'
    $currentProject = 'greencode-local'
} else {
    $currentProject = $projectLine -replace '^COMPOSE_PROJECT_NAME=', ''
    if ([string]::IsNullOrWhiteSpace($currentProject)) {
        $currentProject = 'greencode-local'
        $envLines = $envLines -replace '^COMPOSE_PROJECT_NAME=.*$', 'COMPOSE_PROJECT_NAME=greencode-local'
    }
}

if ($currentProject -eq 'greencode-local') {
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 12)
    $projectName = "greencode-$suffix"
    $envLines = $envLines -replace '^COMPOSE_PROJECT_NAME=.*$', "COMPOSE_PROJECT_NAME=$projectName"
    Set-Content -Path .\.env -Value $envLines -Encoding ascii
    Write-Host "Projeto Docker isolado configurado: $projectName"
} else {
    Write-Host "Projeto Docker já configurado; nome preservado: $currentProject"
}
```

**Ubuntu (Bash):**

```bash
set -eu
unset COMPOSE_PROJECT_NAME
current_project="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env | head -n 1)"
if [ -z "$current_project" ]; then
  if grep -q '^COMPOSE_PROJECT_NAME=' .env; then
    sed -i 's/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME=greencode-local/' .env
  else
    printf '\nCOMPOSE_PROJECT_NAME=greencode-local\n' >> .env
  fi
  current_project='greencode-local'
fi
if [ "$current_project" = 'greencode-local' ]; then
  suffix="$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
  project_name="greencode-$suffix"
  sed -i "s|^COMPOSE_PROJECT_NAME=.*|COMPOSE_PROJECT_NAME=$project_name|" .env
  echo "Projeto Docker isolado configurado: $project_name"
else
  echo "Projeto Docker já configurado; nome preservado: $current_project"
fi
```

O Compose utiliza `COMPOSE_PROJECT_NAME` para nomear e isolar containers, redes e volumes. Assim, dois clones não compartilham automaticamente o mesmo volume PostgreSQL, mesmo que ambos estejam em diretórios chamados `TP_GreenCode_AV3`. Não altere esse nome depois que o volume local for criado, a menos que queira iniciar outro ambiente isolado.

### Configurar o Compose com um PostgreSQL criado pelo próprio Compose

Edite `.env` e defina:

- `POSTGRES_USER`: usuário que será criado no container PostgreSQL na primeira inicialização do volume.
- `POSTGRES_PASSWORD`: senha desse usuário.
- `POSTGRES_DB`: banco criado na primeira inicialização.
- `JWT_SECRET`: segredo aleatório com pelo menos 32 bytes.
- `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_NAME` e `BOOTSTRAP_ADMIN_PASSWORD`: credenciais do administrador inicial. A senha deve ter pelo menos 12 caracteres.

O Compose entrega `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB` ao PostgreSQL e interpola diretamente uma `DATABASE_URL` para API e worker usando exatamente os mesmos valores e o host interno `postgres:5432`. O `test-runner` recebe uma URL equivalente apontando para `postgres-test:5432/greencode_test`. Não há montagem de URL por expansão de shell durante o startup. A `DATABASE_URL` do `.env` fica reservada aos comandos Prisma executados diretamente no host. Para evitar problemas com caracteres reservados de URL (`@`, `:`, `/`, `#`, `%`, `?`), prefira uma senha hexadecimal aleatória, por exemplo, gerada com 32 bytes. Use a mesma senha em `POSTGRES_PASSWORD` e na `DATABASE_URL` do host.

**PowerShell — gerar uma senha hexadecimal somente quando o `.env` ainda contém o placeholder:**

```powershell
$envLines = Get-Content .\.env
$pgPasswordLine = $envLines | Where-Object { $_ -match '^POSTGRES_PASSWORD=' } | Select-Object -First 1
if (-not $pgPasswordLine) { throw 'A linha POSTGRES_PASSWORD não foi encontrada no .env.' }
$currentPassword = $pgPasswordLine -replace '^POSTGRES_PASSWORD=', ''

if ($currentPassword -eq 'replace-with-a-local-database-password') {
    $pgBytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($pgBytes) } finally { $rng.Dispose() }
    $pgPassword = ([BitConverter]::ToString($pgBytes) -replace '-', '').ToLowerInvariant()

    $pgUser = (($envLines | Where-Object { $_ -match '^POSTGRES_USER=' } | Select-Object -First 1) -replace '^POSTGRES_USER=', '').Trim()
    $pgDb = (($envLines | Where-Object { $_ -match '^POSTGRES_DB=' } | Select-Object -First 1) -replace '^POSTGRES_DB=', '').Trim()
    if (-not $pgUser -or -not $pgDb) { throw 'POSTGRES_USER e POSTGRES_DB precisam estar definidos no .env.' }
    if (-not ($envLines | Where-Object { $_ -match '^DATABASE_URL=' })) { throw 'A linha DATABASE_URL não foi encontrada no .env.' }

    $envLines = $envLines -replace '^POSTGRES_PASSWORD=.*$', "POSTGRES_PASSWORD=$pgPassword"
    $envLines = $envLines -replace '^DATABASE_URL=.*$', ("DATABASE_URL=postgresql://{0}:{1}@127.0.0.1:5433/{2}?schema=public" -f $pgUser, $pgPassword, $pgDb)
    Set-Content -Path .\.env -Value $envLines -Encoding ascii
    Remove-Variable pgPassword, pgBytes
    Write-Host 'Senha PostgreSQL gerada e gravada. Guarde o .env e não gere outra senha nas próximas inicializações.'
} else {
    Write-Host 'POSTGRES_PASSWORD já está configurada; valor preservado. Não gere outra senha para um volume existente.'
}
```

**Bash — gerar uma senha hexadecimal somente quando o `.env` ainda contém o placeholder:**

```bash
set -eu
current_password="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env | head -n 1)"
if [ "$current_password" = 'replace-with-a-local-database-password' ]; then
  pg_password="$(openssl rand -hex 32)"
  pg_user="$(sed -n 's/^POSTGRES_USER=//p' .env | head -n 1)"
  pg_db="$(sed -n 's/^POSTGRES_DB=//p' .env | head -n 1)"
  grep -q '^DATABASE_URL=' .env || { echo 'DATABASE_URL ausente.' >&2; exit 1; }
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${pg_password}|" .env
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${pg_user}:${pg_password}@127.0.0.1:5433/${pg_db}?schema=public|" .env
  unset pg_password
  echo 'Senha PostgreSQL gerada e gravada. Preserve o .env nas próximas inicializações.'
else
  echo 'POSTGRES_PASSWORD já está configurada; valor preservado. Não gere outra senha para um volume existente.'
fi
```

O Compose desta versão usa o volume `greencode_pgdata_v3`, com o prefixo do `COMPOSE_PROJECT_NAME` exclusivo desta cópia. O volume é criado automaticamente na primeira inicialização. Clones diferentes recebem nomes de projeto diferentes e, por isso, não reutilizam o mesmo volume por compartilharem apenas o nome do diretório. Volumes anteriores não são apagados: permanecem guardados no Docker, preservando os dados existentes.

**Importante:** mantenha o mesmo `.env` enquanto reutilizar `greencode_pgdata_v3`. Não gere outra `POSTGRES_PASSWORD` a cada inicialização. As variáveis `POSTGRES_*` inicializam o banco somente quando o volume está vazio; elas não redefinem a role de um volume já criado. Se o volume deste projeto já existir, a senha do `.env` precisa continuar sendo a mesma usada quando ele foi inicializado. Remover somente containers não remove volumes. Um clone novo deve gerar um `COMPOSE_PROJECT_NAME` novo antes de executar os comandos Compose; isso cria outro namespace sem apagar os dados anteriores.

### Gerar um segredo JWT aleatório

Gere 32 bytes aleatórios e grave o resultado hexadecimal em `JWT_SECRET`. Use apenas o bloco referente ao seu terminal. O comando PowerShell inclui a atribuição de `$jwtSecret`; execute o bloco completo, inclusive essa linha. Os comandos preservam os demais valores do `.env` e não exibem o segredo gerado.

**Windows (PowerShell):**

```powershell
$envLines = Get-Content .\.env
$jwtLine = $envLines | Where-Object { $_ -match '^JWT_SECRET=' } | Select-Object -First 1
if (-not $jwtLine) { throw 'A linha JWT_SECRET não foi encontrada no .env.' }
$currentJwt = $jwtLine -replace '^JWT_SECRET=', ''

if ($currentJwt -eq 'replace-with-a-random-secret-at-least-32-bytes-long') {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $jwtSecret = ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
    # Replace the line before writing; merely creating $jwtSecret does not update .env.
    $envLines = $envLines -replace '^JWT_SECRET=.*$', "JWT_SECRET=$jwtSecret"
    Set-Content -Path .\.env -Value $envLines -Encoding ascii
    Remove-Variable jwtSecret, bytes
    Write-Host 'JWT_SECRET gerado e gravado; o valor não foi exibido.'
} else {
    Write-Host 'JWT_SECRET já está configurado; valor preservado.'
}
```

**Ubuntu (Bash):**

```bash
set -eu
current_jwt="$(sed -n 's/^JWT_SECRET=//p' .env | head -n 1)"
if [ "$current_jwt" = 'replace-with-a-random-secret-at-least-32-bytes-long' ]; then
  secret="$(openssl rand -hex 32)"
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${secret}|" .env
  unset secret
  echo 'JWT_SECRET gerado e gravado; o valor não foi exibido.'
else
  echo 'JWT_SECRET já está configurado; valor preservado.'
fi
```

No Ubuntu, o comando usa `openssl`. Caso não esteja instalado, instale-o pelo gerenciador de pacotes da distribuição. O segredo é local: não o compartilhe nem o registre em capturas de tela. O arquivo `.env.example` deve conter apenas placeholders, nunca uma chave JWT fixa ou utilizada em ambiente real.

### Validar e iniciar com Docker Compose

Valide a configuração e inicie primeiro a infraestrutura. O primeiro comando cria o volume versionado `greencode_pgdata_v3` caso ainda não exista:

```powershell
docker compose config -q
docker compose --profile tests config -q
docker compose up -d --wait --wait-timeout 120 postgres redis
docker compose ps
```

Confirme que `postgres` e `redis` aparecem como `healthy`. O Redis não mostrará uma porta publicada em `PORTS`; isso é intencional, pois API e worker usam `redis:6379` pela rede interna. O health check do PostgreSQL executa uma consulta autenticada com as mesmas credenciais configuradas para a API; portanto, `healthy` confirma não apenas que o processo está ativo, mas também que a senha do `.env` foi aceita.

Em seguida, construa e inicie API e worker. O Compose inicia a API somente depois do PostgreSQL saudável e inicia o worker somente depois da API, PostgreSQL e Redis estarem saudáveis:

```powershell
docker compose up --build -d --wait --wait-timeout 180 api worker
docker compose ps
docker compose logs --tail=120 api
docker compose logs --tail=80 worker
```

A API e o worker recebem `DATABASE_URL` diretamente em `environment`, interpolada pelo Compose com os mesmos valores de `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB` usados no serviço PostgreSQL. O `test-runner` recebe a URL do banco `greencode_test` com `postgres-test:5432`. A URL `127.0.0.1:5433` do `.env` não é usada por processos dentro dos containers.

A API executa `prisma migrate deploy` e o seed idempotente antes de iniciar o Fastify. O log deve apresentar `GreenCode API iniciada`; no `docker compose ps`, o serviço `api` deve ficar `healthy`. O worker é um processo separado e depende da API saudável, do PostgreSQL e do Redis saudáveis. Essa ordem impede que consulte a tabela Outbox antes de as migrations terminarem.

O nome real do volume é composto pelo `COMPOSE_PROJECT_NAME` e pela chave `greencode_pgdata_v3`. Como o guia gera um nome exclusivo para cada clone, um novo checkout cria um volume próprio, mesmo quando o diretório também se chama `TP_GreenCode_AV3`. Volumes de outros clones permanecem intactos e não são reutilizados. O novo banco começa vazio; os dados de outros volumes não são copiados automaticamente. Preserve o `.env` e, principalmente, o `COMPOSE_PROJECT_NAME` depois da primeira inicialização.

Para acompanhar os logs continuamente, abra terminais separados:

```bash
docker compose logs -f api
```

```bash
docker compose logs -f worker
```

Não considere a imagem construída como prova de que a API está pronta: a inicialização ainda precisa conseguir autenticar no PostgreSQL, aplicar migrations, executar o seed e abrir a porta HTTP.

### Diagnóstico de falhas na inicialização

**Erro Prisma `P1000` — falha de autenticação:** a API alcançou o PostgreSQL, mas usuário/senha não foram aceitos. Confira `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB` no `.env`. No Compose, o destino mostrado no log da API deve ser `postgres:5432`; a `DATABASE_URL` com `127.0.0.1:5433` é reservada para comandos executados no host.

Cada cópia do projeto deve ter seu próprio `COMPOSE_PROJECT_NAME`, gerado na subseção de isolamento antes de qualquer comando Compose. Se você removeu containers ou clonou novamente o repositório, isso não significa que os volumes foram removidos: sem um nome de projeto exclusivo, o Compose pode reutilizar um volume antigo. O nome exclusivo cria um namespace distinto para `greencode_pgdata_v3`; um novo clone não reutiliza o volume de outro clone. Confirme `docker compose ps`: `postgres` precisa ficar `healthy`. O health check valida uma autenticação real usando a senha configurada. Preserve o `.env` e o nome do projeto depois da primeira inicialização. Não gere uma nova senha nem altere `COMPOSE_PROJECT_NAME` enquanto reutilizar o mesmo volume. Não use `docker compose down -v` como procedimento normal de inicialização.

**Erro Prisma `P1001` ou conexão recusada:** confira se o container `postgres` está `healthy`, se a API está usando o host interno `postgres:5432` e se os containers estão na mesma rede Compose. `127.0.0.1` dentro de um container aponta para o próprio container, não para o host Windows nem para o serviço PostgreSQL.

**Erro Docker `ports are not available` na porta `6379`:** o Redis usado pelo Compose não precisa publicar uma porta no Windows/Linux host. A configuração do projeto deixa o Redis acessível apenas pela rede interna, em `redis:6379`, para API e worker. Se você executar a aplicação diretamente no host, configure `REDIS_URL` para uma instância Redis 7 acessível pelo host; não use a instância interna do Compose, cuja porta não é publicada.

Para consultar os estados e logs sem exibir o conteúdo do `.env`:

```bash
docker compose ps -a
docker compose logs --tail=120 postgres
docker compose logs --tail=120 api
```

Não compartilhe a saída de `docker compose config` sem redigir credenciais: esse comando pode imprimir valores interpolados de variáveis de ambiente.

### Executar usando banco PostgreSQL externo

Se a avaliação deve usar um PostgreSQL diferente daquele criado pelo serviço `postgres` do Compose, execute a aplicação diretamente no host. Nesse modo, `DATABASE_URL` e `REDIS_URL` do `.env` são efetivamente utilizados. Configure `DATABASE_URL` com host, porta, usuário, senha e banco externos acessíveis pelo Windows/Linux host. O nome do banco deve ser o banco dedicado à avaliação; não utilize produção. Configure `REDIS_URL` para uma instância Redis 7 acessível pelo host.

Com Node.js 24 instalado e PostgreSQL/Redis já disponíveis:

```bash
npm ci
npm run prisma:validate
npm run prisma:generate
npm run db:deploy
npm run db:seed:generated
```

O `db:seed:generated` utiliza o cliente gerado no passo anterior. Para executar o seed isoladamente, use `npm run db:seed`, que gera o Prisma Client antes de executar o seed.

Abra dois terminais na raiz do projeto. No primeiro, inicie a API:

```bash
npm run dev
```

No segundo, inicie o worker:

```bash
npm run dev:worker
```

Nesse modo, não use `docker compose up` para iniciar a API/worker esperando que eles consumam a `DATABASE_URL` externa: o Compose atual monta as URLs internas apontando para seus próprios serviços `postgres` e `redis`. Para usar uma base externa a partir de containers, a configuração do Compose precisa ser adaptada explicitamente para receber uma URL de banco alcançável pela rede dos containers.

### Endereços

- Swagger UI: `http://localhost:3000/docs/`
- Documento OpenAPI: `http://localhost:3000/docs/json`
- Health check: `http://localhost:3000/health`

Depois de a API ficar `healthy`, consulte o health check com `curl --fail http://localhost:3000/health` ou `Invoke-RestMethod http://localhost:3000/health` no PowerShell. A resposta deve indicar `status: "ok"` e `service: "greencode-api"`. Só então abra o Swagger UI.


## 2. Entrar como administrador

No Swagger, execute `POST /api/v1/auth/login`:

```json
{
  "usuario": "<BOOTSTRAP_ADMIN_USERNAME>",
  "senha": "<BOOTSTRAP_ADMIN_PASSWORD>"
}
```

Use os valores do `.env`. A resposta esperada é HTTP `200` e contém `accessToken`, `tokenType` e informações públicas do usuário. Clique em **Authorize**, escolha `bearerAuth` e informe o token retornado. A administração de parceiros, API Keys e associações exige papel `ADMINISTRADOR`.

O seed cria o usuário inicial quando ele ainda não existe. Alterar `BOOTSTRAP_ADMIN_PASSWORD` depois da primeira inicialização não redefine a senha de uma conta já persistida.

## 3. Criar um parceiro de integração

### 3.1 Encontrar uma organização ativa

Com o JWT do administrador, consulte `GET /api/v1/organizacoes?page=1&pageSize=20&ativo=true`. Escolha uma organização ativa e guarde seu UUID como `<organizacaoId>` para a criação do vínculo administrativo. Esse UUID não será enviado pelo parceiro nas chamadas públicas.

### 3.2 Cadastrar parceiro

Execute `POST /api/v1/parceiros`:

```json
{
  "nome": "Parceiro de Avaliação AV3",
  "descricao": "Integração usada no roteiro de avaliação",
  "escopos": [
    "lotes:read",
    "lotes:write",
    "rastreabilidade:read",
    "reports:read",
    "reports:write"
  ],
  "limiteRequisicoesPorMinuto": 120,
  "maxEquipamentosPorSubmissao": 100,
  "maxPayloadBytes": 1048576,
  "permiteLoteSemEquipamentos": true
}
```

Esperado: HTTP `201`. Guarde o campo `id` como `<parceiroId>`. O conjunto de escopos do parceiro define o teto de permissões que poderá ser concedido às chaves.

### 3.3 Vincular organização

Execute `POST /api/v1/parceiros/{parceiroId}/organizacoes`, substituindo o parâmetro pelo ID anterior:

```json
{
  "organizacaoId": "<organizacaoId>"
}
```

Esperado: HTTP `201`. Guarde `identificadorPublico` como `<integrationId>`. Esse valor opaco, e não o UUID interno da organização, será enviado no header `X-Integration-ID`.

### 3.4 Criar API Key

Execute `POST /api/v1/parceiros/{parceiroId}/chaves`:

```json
{
  "nome": "Chave da avaliação AV3",
  "escopos": [
    "lotes:read",
    "lotes:write",
    "rastreabilidade:read",
    "reports:read",
    "reports:write"
  ],
  "limiteRequisicoesPorMinuto": 60,
  "maxEquipamentosPorSubmissao": 50,
  "maxPayloadBytes": 524288
}
```

Esperado: HTTP `201`, com `apiKey` e `segredo`. Copie o segredo completo uma única vez e guarde `apiKey.id` como `<apiKeyId>`. O GreenCode não permite recuperar o segredo em consultas posteriores; o banco guarda somente o hash. Não inclua o segredo em capturas de tela, relatórios ou evidências.

No Swagger, autorize também o esquema `apiKeyAuth` com o segredo. Nas rotas públicas, use os headers aplicáveis:

- `X-API-Key`: segredo da chave.
- `X-Integration-ID`: `<integrationId>` para operações que exigem associação organizacional.
- `Idempotency-Key`: identificador único da operação de submissão de lote.

## 4. Demonstrar o ciclo de vida público dos lotes

### 4.1 CREATE — Submeter lote

Execute `POST /api/v1/public/lotes`, com os três headers descritos acima:

```json
{
  "externalId": "erp-av3-lote-001",
  "notaFiscal": "NF-AV3-001",
  "transportadora": "Transportadora de Avaliação",
  "observacoes": "Lote de demonstração criado pelo parceiro",
  "equipamentos": [
    {
      "tipo": "NOTEBOOK",
      "marca": "MarcaExemplo",
      "modelo": "Modelo 14",
      "anoFabricacao": 2024,
      "estadoFisico": "BOM_ESTADO",
      "pesoQuilogramas": "2.500",
      "valorAquisicao": "3500.00"
    }
  ]
}
```

Esperado: HTTP `201`, identificador público `gcl_...`, status `RECEBIDO` e quantidade de equipamentos igual a 1. Guarde `identificadorPublico` como `<lotePublico>`. A submissão utiliza transação, referência externa, idempotência e auditoria. Para testar lote sem equipamentos, remova `equipamentos` e use novo externalId e novo `Idempotency-Key`; isso só é permitido quando `permiteLoteSemEquipamentos` estiver habilitado.

### 4.2 READ — Listar lotes próprios

Execute:

```text
GET /api/v1/public/lotes?page=1&pageSize=20&status=RECEBIDO
```

Filtros disponíveis: `status`, `externalId`, `dataEntradaDe`, `dataEntradaAte` e `ativo`, além de `page` e `pageSize`. A resposta contém `data` e `meta` (`page`, `pageSize`, `total`, `totalPages`). Somente lotes pertencentes ao parceiro autenticado e em organizações com vínculo ativo podem aparecer.

### 4.3 READ — Consultar lote

Execute:

```text
GET /api/v1/public/lotes/<lotePublico>
```

Esperado: HTTP `200`, com identificador público, referência externa do parceiro, status, ativação, versão, datas, nota fiscal, transportadora, observações e quantidade de equipamentos. Essa resposta é uma visão de gestão; não contém movimentações ou histórico detalhado.

### 4.4 UPDATE — Alterar campos permitidos

Execute `PATCH /api/v1/public/lotes/{identificadorPublico}`:

```json
{
  "versaoEsperada": 1,
  "notaFiscal": "NF-AV3-001-RETIFICADA",
  "observacoes": "Nota fiscal corrigida antes do início da triagem"
}
```

Esperado: HTTP `200` e versão incrementada para 2. Os únicos campos editáveis são `notaFiscal`, `transportadora` e `observacoes`. O parceiro não pode alterar organização, identificadores, referências externas, estados internos, movimentações ou operadores. A edição só é permitida para lote ativo em `RECEBIDO`, sem triagem ou movimentação iniciada.

Para demonstrar concorrência otimista, repita a atualização usando `versaoEsperada` antiga. Esperado: HTTP `409`. Consulte novamente o lote para obter a versão vigente antes de uma nova alteração.

### 4.5 DELETE — Cancelar logicamente

O cancelamento é uma operação `DELETE`, mas não apaga fisicamente dados. Execute com a versão atual:

```http
DELETE /api/v1/public/lotes/<lotePublico>
Content-Type: application/json
```

```json
{
  "versaoEsperada": 2
}
```

Esperado: HTTP `200`, `ativo: false`, status público `CANCELADO` e versão incrementada. O registro, equipamentos e histórico são preservados. Um lote que já iniciou triagem ou movimentação não pode ser cancelado pelo parceiro; o resultado esperado nesse caso é HTTP `409`. Repetir a mesma operação depois de o cancelamento ter sido concluído retorna o estado cancelado sem excluir o recurso novamente.

## 5. Rastreabilidade, idempotência e autorização

### Rastreabilidade

Com escopo `rastreabilidade:read`, execute:

```text
GET /api/v1/public/rastreabilidade/lotes/<lotePublico>
GET /api/v1/public/rastreabilidade/external/erp-av3-lote-001
```

A resposta detalhada contém `historicoOperacional`, equipamentos e movimentações permitidas. Não deve expor CNPJ, IDs internos de usuário/organização, códigos de barras internos, hashes ou segredos de API Key. A API verifica também a propriedade do lote pelo parceiro; conhecer o identificador público de outro parceiro não concede acesso.

### Idempotência

Repita `POST /api/v1/public/lotes` com o mesmo conteúdo e o mesmo `Idempotency-Key`. Esperado: o mesmo lote original, sem duplicação. Reutilize a chave com conteúdo diferente. Esperado: HTTP `409`. O mesmo princípio de unicidade por parceiro se aplica a `externalId`.

### Escopos e revogação

Crie uma API Key adicional com escopo somente `lotes:write` e tente executar `GET /api/v1/public/lotes`. Esperado: HTTP `403`, por ausência de `lotes:read`. Escopos efetivos são a interseção das permissões do parceiro e da chave.

Para revogar uma chave, execute `POST /api/v1/parceiros/{parceiroId}/chaves/{apiKeyId}/revogacao` com JWT de administrador. Chamadas subsequentes usando aquela chave devem responder `401`; outras chaves ativas não são revogadas automaticamente. Para revogar a associação organizacional, use `DELETE /api/v1/parceiros/{parceiroId}/organizacoes/{associacaoId}`. O identificador de integração deixa de autorizar novas operações.

### Isolamento entre parceiros

Cadastre um segundo parceiro com `lotes:read` e `rastreabilidade:read`, vincule-o à mesma organização e gere uma chave própria. Tente consultar o lote criado pelo primeiro parceiro. Esperado: HTTP `404`. O vínculo à mesma organização não transfere propriedade de recursos submetidos por outro parceiro.

## 6. Demonstrar relatórios assíncronos

Com uma chave que possua `reports:read` e `reports:write`, execute `POST /api/v1/public/relatorios` com `X-API-Key` e `X-Integration-ID`:

```json
{
  "tipo": "equipamentos",
  "formato": "JSON"
}
```

Os tipos disponíveis são `operacional`, `equipamentos`, `triagem`, `rentabilidade` e `vida-util`; os formatos são `CSV` e `JSON`. A organização vem do vínculo ativo, não de um UUID no body. Esperado: HTTP `202 Accepted`, com ID da tarefa e estado inicial `PENDING`.

A solicitação e o evento Outbox são persistidos na mesma transação. O worker publica o job no Redis/BullMQ, processa o conteúdo e grava o arquivo. Consulte o estado com:

```text
GET /api/v1/public/relatorios/<reportId>
```

Repita até o estado `COMPLETED`; enquanto estiver `PENDING` ou `PROCESSING`, o arquivo ainda não está pronto. Baixe com:

```text
GET /api/v1/public/relatorios/<reportId>/download
```

A rota verifica o checksum SHA-256 antes de transmitir o arquivo. Um relatório não concluído não deve ser tratado como disponível para download. O serviço interno também oferece `POST /api/v1/relatorios/async` e rotas administrativas de consulta, reprocessamento e download para `ADMINISTRADOR` e `AUDITOR`.

## 7. Rotas principais por função

| Área | Rotas | Acesso |
|---|---|---|
| Saúde e documentação | `GET /health`, `/docs/`, `/docs/json` | Público |
| Autenticação interna | `POST /api/v1/auth/login` e rotas de sessão | JWT conforme rota |
| Parceiros | `/api/v1/parceiros` e subrotas `organizacoes` e `chaves` | JWT `ADMINISTRADOR` |
| Lotes internos | `/api/v1/lotes` e subrotas | JWT/RBAC |
| Equipamentos | `/api/v1/equipamentos` e subrotas | JWT/RBAC |
| API pública de lotes | `/api/v1/public/lotes` | API Key + escopo correspondente |
| Rastreabilidade pública | `/api/v1/public/rastreabilidade/...` | API Key + `rastreabilidade:read` |
| Relatórios públicos | `/api/v1/public/relatorios` | API Key + `reports:read`/`reports:write` |
| Relatórios internos | `/api/v1/relatorios/async` | JWT `ADMINISTRADOR` ou `AUDITOR` |

O Swagger é a referência para schemas, headers, query parameters, exemplos e códigos HTTP de cada operação.

## 8. Testes negativos recomendados

| Situação | Resultado esperado |
|---|---|
| JWT ou API Key ausente/inválido/revogado | `401` |
| Usuário sem papel administrativo gerencia parceiro | `403` |
| Chave sem escopo necessário | `403` |
| Parceiro consulta lote de outro parceiro, mesmo na mesma organização | `404` |
| Referência externa ou Idempotency-Key reutilizada com conteúdo divergente | `409` |
| Versão esperada antiga em PATCH/DELETE | `409` |
| Lote com triagem iniciada submetido a cancelamento | `409` |
| Limite de requisições excedido | `429` com `Retry-After` |
| Payload acima do limite contratado | `413` |
| Campos não permitidos no PATCH | `400` |

## 9. Testes automatizados

### Unitários

```bash
npm run test:unit
```

O comando gera o Prisma Client, compila TypeScript e executa os arquivos `dist/src/tests/*.test.js`. Inclui cálculos analíticos, validações e fluxos controlados por doubles.

### Demonstração com entradas e saídas

```bash
npm run test:demonstracao
```

O mecanismo apresenta por cenário identificação, tipo de teste, dependências, entrada, resultado esperado, resultado obtido, validações, duração e status. Atualiza `docs/evidencias-testes-av3.md`, preservando execuções anteriores. Valores sensíveis são redigidos antes de irem ao terminal ou arquivo.

A demonstração HTTP utiliza as rotas Fastify reais, mas controladores, repositórios ou rate limiter podem ser doubles. Cada cenário indica suas dependências; isso não deve ser descrito como teste PostgreSQL/Redis real.

### Integração com PostgreSQL e Redis

A suíte de integração usa PostgreSQL 17 e Redis 7 dedicados. Os testes verificam se o banco selecionado é uma base de teste; não use o banco principal nem a base operacional do Compose.

**Caminho recomendado — infraestrutura de teste pelo Compose:**

```bash
docker compose --profile tests config -q
docker compose --profile tests up -d postgres-test redis-test
docker compose --profile tests run --build --rm test-runner
```

O `test-runner` recebe as mesmas variáveis `POSTGRES_USER` e `POSTGRES_PASSWORD` e monta `DATABASE_URL` dentro do container apontando para `postgres-test:5432/greencode_test`; `REDIS_URL` aponta para `redis-test:6379`. Ele aplica migrations, executa o seed e roda `npm run test:integration:dist` dentro do container. As portas dos serviços de teste não são publicadas no host; por isso, não tente usar a `DATABASE_URL` do host para alcançar `postgres-test` diretamente.

**Execução da suíte a partir do host:** use `npm run test:integration` somente quando `DATABASE_URL` apontar para um banco separado cujo nome contenha `test` e `REDIS_URL` apontar para um Redis de teste que esteja acessível pelo host. O comando compila o projeto e inicia a suíte; ele não cria nem isola automaticamente o banco externo. Antes, aplique migrations e seed nesse banco de teste. Nunca reutilize a URL do banco de avaliação principal se ela não for uma base descartável de testes.

### Pipeline completo local

```bash
npm run test:av3
```

O comando executa validação do Prisma, um build, a suíte unitária, a demonstração e a suíte de integração em sequência. A integração ainda precisa dos serviços e variáveis dedicados.

## 10. CI e registro dos resultados

O workflow `.github/workflows/ci.yml` usa Node.js 24, PostgreSQL 17 e Redis 7 como serviços do job. Ele valida o Prisma, aplica migrations e seed uma vez, constrói o projeto, executa unitários e demonstração, roda os testes de integração e publica `docs/evidencias-testes-av3.md` como artifact do GitHub Actions.

Uma execução local ou no CI comprova somente os comandos que chegaram a executar e os cenários que reportaram resultado. Um serviço indisponível ou teste bloqueado deve ser registrado como bloqueado/não executado, nunca como aprovado.

## 11. Encerrar o ambiente

Para parar sem remover dados:

```bash
docker compose down
```

Para descartar os volumes locais e iniciar a aplicação limpa:

```bash
docker compose down -v
docker compose up --build -d
```

`down -v` apaga os volumes nomeados deste projeto Compose, incluindo `greencode_pgdata_v3`, `greencode_test_pgdata_v3`, os dados do Redis e os arquivos de relatórios persistidos no volume compartilhado. O volume antigo `greencode_pgdata` também pode continuar presente no Docker se tiver sido criado por uma versão anterior, mas não é removido por esta configuração quando já não está referenciado. Só execute a remoção de volumes quando todos os dados que serão apagados puderem ser descartados. Esse comando não apaga um banco externo ao Compose.
