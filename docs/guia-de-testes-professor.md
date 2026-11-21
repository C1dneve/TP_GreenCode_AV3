# Guia de execução e testes — GreenCode AV3

Este guia descreve como preparar o ambiente, iniciar a API, executar testes automatizados e demonstrar a integração pública. A sequência foi escrita para Windows 10 ou superior e Ubuntu 24.04 ou superior. Os comandos Docker Compose funcionam no PowerShell e no Bash; os comandos específicos do terminal estão identificados.

## 1. Preparar e iniciar o projeto

### Pré-requisitos

- Windows 10+ com Docker Desktop iniciado; ou Ubuntu 24.04+ com Docker Engine e plugin Docker Compose.
- Acesso à pasta raiz do projeto, onde estão `Dockerfile`, `docker-compose.yml` e `.env.example`.
- Conexão à internet na primeira construção para baixar as imagens Docker e dependências npm.

A execução recomendada usa Docker Compose, portanto não exige instalação local de Node.js ou PostgreSQL. Para executar comandos npm diretamente na máquina, é necessário Node.js 24.x e PostgreSQL 17.

### 1.1 Criar o arquivo `.env`

**Windows (PowerShell):**

```powershell
if (-not (Test-Path .\.env)) { Copy-Item .env.example .env }
```

**Ubuntu (Bash):**

```bash
if [ ! -f .env ]; then cp .env.example .env; fi
nano .env
```

Configure os valores locais de `POSTGRES_PASSWORD`, `JWT_SECRET`, `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_NAME` e `BOOTSTRAP_ADMIN_PASSWORD`. A senha do administrador deve ter pelo menos 12 caracteres. Para evitar problemas ao montar a URL PostgreSQL pelo Compose, prefira letras, números e `_` em `POSTGRES_PASSWORD`.

Os valores de `.env.example` são somente para avaliação local. Não use essas credenciais em produção, não compartilhe o `.env` e não o versione. O Compose fornece `DATABASE_URL` aos containers; não é necessário colocá-la no `.env` para o fluxo Docker.

### 1.2 Gerar um segredo JWT aleatório

**Windows (PowerShell):**

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$jwtSecret = ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
$envLines = Get-Content .\.env
if (-not ($envLines | Where-Object { $_ -match '^JWT_SECRET=' })) { throw 'A linha JWT_SECRET não foi encontrada no .env.' }
$envLines = $envLines -replace '^JWT_SECRET=.*$', "JWT_SECRET=$jwtSecret"
Set-Content -Path .\.env -Value $envLines -Encoding ascii
Write-Host 'JWT_SECRET gerado e gravado no .env; o valor não foi exibido.'
```

**Ubuntu (Bash):**

```bash
set -eu
secret="$(openssl rand -hex 32)"
grep -q '^JWT_SECRET=' .env || { echo 'A linha JWT_SECRET não foi encontrada no .env.' >&2; exit 1; }
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=${secret}/" .env
unset secret
echo 'JWT_SECRET gerado e gravado no .env; o valor não foi exibido.'
```

Não envie nem publique o segredo JWT. Ele é usado para assinar os tokens dos usuários internos.

### 1.3 Validar a configuração

Na raiz do projeto:

```shell
docker compose config -q
docker compose --profile tests config -q
```

Se os comandos terminarem sem mensagem de erro, a configuração do Compose foi interpretada. Se aparecer variável obrigatória ausente, confira o `.env` e execute novamente.

### 1.4 Construir e iniciar a aplicação

```shell
docker compose up --build -d
docker compose ps
```

O Compose inicia `postgres` e depois `api`. O container da API aplica migrations (`npm run db:deploy`) e executa o seed (`npm run db:seed`) antes de iniciar o servidor.

Aguarde `postgres` e `api` ficarem `healthy`. Se estiverem `starting`, aguarde alguns segundos e consulte `docker compose ps` novamente.

### 1.5 Verificar a API

**Windows (PowerShell):**

```powershell
Invoke-RestMethod http://localhost:3000/health
```

**Ubuntu (Bash):**

```bash
curl --fail --show-error http://localhost:3000/health
```

Esperado: JSON com `status: ok` e `service: greencode-api`.

Abra no navegador:

- Swagger UI: `http://localhost:3000/docs/`
- OpenAPI JSON: `http://localhost:3000/docs/json`
- Health check: `http://localhost:3000/health`

### 1.6 Login inicial no Swagger

No Swagger, abra `POST /api/v1/auth/login`, clique em **Try it out** e envie:

```json
{
  "usuario": "<BOOTSTRAP_ADMIN_USERNAME>",
  "senha": "<BOOTSTRAP_ADMIN_PASSWORD>"
}
```

Substitua os valores pelos configurados no `.env`. Esperado: HTTP `200`, com `accessToken`, `tokenType: Bearer`, `expiresIn: 1800` e dados públicos do usuário.

Clique em **Authorize** e informe o token no esquema `bearerAuth` conforme solicitado pelo Swagger. A partir daí, as rotas administrativas e internas autorizadas podem ser testadas.

O seed cria o administrador somente quando o usuário ainda não existe. Se o volume já foi utilizado, mudar a senha no `.env` não redefine a senha da conta existente. Para recriar o ambiente do zero, veja a seção 1.7.

### 1.7 Logs, parada e reinicialização

Acompanhar logs da API:

```shell
docker compose logs -f api
```

Parar sem apagar os dados:

```shell
docker compose down
```

Reiniciar:

```shell
docker compose up -d
```

**Somente para descartar os dados locais e começar do zero:**

```shell
docker compose down -v
docker compose up --build -d
```

O comando `down -v` apaga os volumes `greencode_pgdata` e `greencode_test_pgdata` associados ao projeto Compose. Não o execute se precisar preservar os dados locais.

## 2. Como testar pelo Swagger

A API possui dois mecanismos de autenticação:

- **JWT (`bearerAuth`):** usuários internos. A administração de parceiros e API Keys exige o papel `ADMINISTRADOR`.
- **API Key (`apiKeyAuth`):** sistemas parceiros. A chave é enviada no header `X-API-Key`; submissões também exigem `X-Integration-ID` e `Idempotency-Key`.

O Swagger permite autorizar os dois mecanismos. Para operações administrativas, use `bearerAuth`. Para endpoints públicos, clique em **Authorize** e informe o segredo da API Key no campo `apiKeyAuth`. Não use o token JWT no lugar da API Key.

## 3. Jornada principal de demonstração da API pública

A seed prepara organizações demonstrativas ativas. Primeiro, autentique como Administrador e consulte `GET /api/v1/organizacoes?page=1&pageSize=20&ativo=true`. Escolha uma organização ativa e copie seu `id` para `<organizacaoId>`. Não use o CNPJ como identificador de integração.

### A. Cadastrar um parceiro

Execute `POST /api/v1/parceiros` com `bearerAuth`:

```json
{
  "nome": "Parceiro de Avaliação AV3",
  "descricao": "Parceiro criado para demonstrar a integração pública",
  "escopos": ["lotes:write", "rastreabilidade:read"],
  "limiteRequisicoesPorMinuto": 60,
  "maxEquipamentosPorSubmissao": 100,
  "maxPayloadBytes": 1048576,
  "permiteLoteSemEquipamentos": true
}
```

Esperado: HTTP `201`. Guarde o campo `id` como `<parceiroId>`. A listagem e a consulta ficam disponíveis em `GET /api/v1/parceiros` e `GET /api/v1/parceiros/{parceiroId}`. Atualizações usam `PATCH /api/v1/parceiros/{parceiroId}`; ativação e desativação usam os sufixos `/ativacao` e `/desativacao`.

### B. Autorizar uma organização

Execute `POST /api/v1/parceiros/{parceiroId}/organizacoes`:

```json
{
  "organizacaoId": "<organizacaoId>"
}
```

Esperado: HTTP `201`. Guarde `identificadorPublico` como `<integrationId>` e `id` da associação como `<associacaoId>`. O identificador público deverá ser enviado no header `X-Integration-ID`. Consulte os vínculos em `GET /api/v1/parceiros/{parceiroId}/organizacoes`.

A revogação do vínculo utiliza `DELETE /api/v1/parceiros/{parceiroId}/organizacoes/{associacaoId}`. Após revogar, novas submissões e consultas daquele parceiro para a organização devem ser bloqueadas.

### C. Criar uma API Key

Execute `POST /api/v1/parceiros/{parceiroId}/chaves`:

```json
{
  "nome": "Chave de avaliação AV3",
  "escopos": ["lotes:write", "rastreabilidade:read"]
}
```

Esperado: HTTP `201`, com `apiKey` (metadados) e `segredo` (valor completo). **Copie o campo `segredo` imediatamente:** ele é exibido uma única vez e não poderá ser recuperado em consultas posteriores. Guarde também `apiKey.id` como `<apiKeyId>`.

As rotas `GET /api/v1/parceiros/{parceiroId}/chaves` e `GET /api/v1/parceiros/{parceiroId}/chaves/{apiKeyId}` retornam metadados, não o segredo. A atualização usa `PATCH .../chaves/{apiKeyId}` e a revogação usa `POST .../chaves/{apiKeyId}/revogacao`.

### D. Submeter um lote com equipamentos

No Swagger, autorize `apiKeyAuth` com o segredo copiado. Execute `POST /api/v1/public/lotes` e informe os três headers:

- `X-API-Key`: segredo da API Key;
- `X-Integration-ID`: `<integrationId>` obtido na associação;
- `Idempotency-Key`: valor único para esta operação, por exemplo `avaliacao-av3-lote-001`.

Corpo de exemplo:

```json
{
  "externalId": "erp-av3-lote-001",
  "notaFiscal": "NF-AV3-001",
  "transportadora": "Transportadora de Avaliação",
  "observacoes": "Lote criado durante a avaliação da API pública",
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

Esperado: HTTP `201`, identificador público `gcl_...`, status `RECEBIDO`, quantidade de equipamentos e dados públicos básicos. Guarde `identificadorPublico` como `<identificadorPublico>`.

O campo `equipamentos` é opcional. Para testar lote sem equipamentos, envie outro `POST` com novo `Idempotency-Key` e remova o campo `equipamentos`; isso é permitido porque o parceiro do exemplo foi criado com `permiteLoteSemEquipamentos: true`.

### E. Consultar rastreabilidade

Com a mesma API Key que possui `rastreabilidade:read`, execute:

```text
GET /api/v1/public/rastreabilidade/lotes/{identificadorPublico}
```

Use `<identificadorPublico>` retornado na submissão. A resposta esperada contém identificador público, status, datas, quantidade de equipamentos, histórico operacional e os campos autorizados dos equipamentos.

Também é possível consultar pela referência externa contextualizada ao parceiro:

```text
GET /api/v1/public/rastreabilidade/external/erp-av3-lote-001
```

A resposta não deve conter CNPJ, dados pessoais, nomes de usuários internos, IDs internos do banco, código de barras interno, segredo/hash de API Key ou referências externas de outros parceiros.

**Ponto pendente identificado na revisão do código atual:** a submissão grava `SUBMISSAO_PUBLICA_LOTE`, mas a lista de ações usada para compor `historicoOperacional` não inclui esse evento. Até essa correção, o evento inicial da submissão pode não aparecer no array de histórico; não marque esse detalhe específico como aprovado.

### F. Verificar idempotência

Use novamente o mesmo `POST /api/v1/public/lotes` com o mesmo `Idempotency-Key` e o mesmo conteúdo. Esperado: a resposta aponta para o mesmo `identificadorPublico`; não deve ser criado um segundo lote.

Depois, altere um campo do corpo e reutilize a mesma `Idempotency-Key`. Esperado: HTTP `409 Conflict`.

Para testar `externalId`, envie o mesmo conteúdo e mesmo `externalId`, mas com uma nova `Idempotency-Key`. Esperado: o mesmo identificador público original. Reutilize o `externalId` com conteúdo diferente: esperado `409 Conflict`.

### G. Verificar permissões e revogação

Crie uma segunda API Key para o mesmo parceiro com escopo somente `lotes:write`:

```json
{
  "nome": "Chave somente escrita",
  "escopos": ["lotes:write"]
}
```

Use essa chave para consultar rastreabilidade. Esperado: HTTP `403`, pois falta `rastreabilidade:read`.

Revogue a chave principal com `POST /api/v1/parceiros/{parceiroId}/chaves/{apiKeyId}/revogacao` e tente consultar novamente com ela. Esperado: HTTP `401`. Uma outra chave ativa do mesmo parceiro não deve ser revogada automaticamente.

### H. Testar isolamento entre parceiros

Crie um segundo parceiro e uma API Key com `rastreabilidade:read`, mas não associe a organização do lote ao segundo parceiro. Tente consultar o `<identificadorPublico>` criado pelo primeiro parceiro. Esperado: HTTP `404`, sem revelar a existência do recurso de terceiro.

## 4. Lista de rotas por função

| Área | Rotas principais | Autorização |
|---|---|---|
| Saúde/documentação | `GET /health`, `GET /docs/`, `GET /docs/json` | Público |
| Sessão interna | `POST /api/v1/auth/login`; `GET /api/v1/auth/me`; `POST /api/v1/auth/logout`; `POST /api/v1/auth/change-password` | Login público; demais com JWT |
| Usuários | `GET/POST /api/v1/usuarios`; `GET/PATCH /api/v1/usuarios/{usuarioId}` e ações de ciclo de vida | JWT/RBAC |
| Organizações | `GET/POST /api/v1/organizacoes`; `GET/PATCH /api/v1/organizacoes/{organizacaoId}` e ações de ciclo de vida | JWT/RBAC |
| Contratos | `/api/v1/contratos` e rotas aninhadas em `/api/v1/organizacoes/{organizacaoId}/contratos` | JWT/RBAC |
| Lotes | `/api/v1/lotes`, `/api/v1/lotes/{loteId}` e ações operacionais | JWT/RBAC |
| Equipamentos | `/api/v1/equipamentos`, `/api/v1/equipamentos/{equipamentoId}` e movimentações | JWT/RBAC |
| Auditoria/relatórios | `/api/v1/auditorias`, `/api/v1/relatorios/...` | JWT/RBAC conforme papel |
| Parceiros | `GET/POST /api/v1/parceiros`; `GET/PATCH /api/v1/parceiros/{parceiroId}`; `/ativacao`, `/desativacao`; `/organizacoes` | JWT `ADMINISTRADOR` |
| API Keys | `/api/v1/parceiros/{parceiroId}/chaves` e ações de atualização/revogação | JWT `ADMINISTRADOR` |
| Submissão pública | `POST /api/v1/public/lotes` | API Key + `lotes:write` + headers de integração |
| Rastreabilidade pública | `GET /api/v1/public/rastreabilidade/lotes/{identificadorPublico}`; `GET /api/v1/public/rastreabilidade/external/{externalId}` | API Key + `rastreabilidade:read` + vínculo ativo |

O Swagger apresenta todos os schemas, parâmetros e códigos de resposta das rotas atualmente registradas.

## 5. Testes negativos que demonstram as regras

| Cenário | Resultado esperado |
|---|---|
| Rota interna protegida sem JWT ou com JWT inválido/revogado | `401` |
| Usuário autenticado sem papel Administrador tenta gerir parceiro/chave | `403` |
| Rota pública sem API Key, chave inválida, expirada ou revogada | `401` |
| Chave sem o escopo necessário | `403` |
| Parceiro desativado | `401` nas operações públicas |
| `X-Integration-ID` ausente ou inválido na submissão | `400` |
| Vínculo parceiro-organização revogado | Operação pública bloqueada; consulta não revela o recurso |
| Mesmo `Idempotency-Key` com conteúdo diferente | `409` |
| Mesmo `externalId` com conteúdo diferente | `409` |
| Excesso de requisições | `429` com `Retry-After` |
| Payload acima do limite | `413` |
| Tipo de equipamento ou estado inválido | `400` |
| Parceiro diferente tenta consultar lote sem vínculo | `404` |

As respostas de erro utilizam JSON no campo `error`, com código, mensagem e request ID quando disponível. Confira também se a resposta não revela credenciais, SQL, IDs internos ou dados de terceiros.

## 6. Testes automatizados e validação

### 6.1 Testes unitários e HTTP

```shell
docker compose --profile tests run --rm --no-deps test-runner npm test
```

O comando executa `npm test`, que primeiro roda `npm run build` e depois `node --test dist/src/tests/*.test.js`. O parâmetro `--no-deps` evita iniciar o PostgreSQL de integração, não necessário para esta suíte.

### 6.2 Testes de integração com PostgreSQL

```shell
docker compose --profile tests run --rm test-runner
```

O serviço `postgres-test` usa banco isolado `greencode_test`. O `test-runner` aplica migrations, executa o seed e chama `npm run test:integration`, que compila o projeto e roda `dist/src/tests/integration/*.integration.test.js`.

Os testes de integração verificam o nome da base e recusam uma URL que não contenha `test` no nome. Não altere `DATABASE_URL` para apontar ao banco principal ou a um ambiente de produção.

### 6.3 Validação Prisma, migrations e build na API

A imagem da API já foi construída com Node 24 e o comando de inicialização aplica migrations e seed. Para executar verificações manualmente dentro do container:

```shell
docker compose exec api npm run prisma:validate
docker compose exec api npm run prisma:generate
docker compose exec api npm run db:deploy
```

A migration em banco limpo deve ser verificada também usando um ambiente descartável. Não teste migrations destrutivas sobre uma base com dados que precisam ser preservados.

### 6.4 Execução diretamente na máquina (opcional)

Se não utilizar Docker, instale Node.js 24.x e PostgreSQL 17. Crie um banco dedicado para a aplicação e configure `DATABASE_URL` no `.env`, por exemplo:

```text
DATABASE_URL=postgresql://greencode:SENHA_LOCAL@127.0.0.1:5433/greencode?schema=public
```

Na raiz do projeto:

```shell
npm ci
npm run prisma:validate
npm run prisma:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Para executar os testes unitários/HTTP:

```shell
npm test
```

Para integração, crie outro banco exclusivo cujo nome contenha `test`, configure temporariamente `DATABASE_URL` para ele e execute:

```shell
npm run test:integration
```

Não aponte a suíte de integração para o banco principal. Os testes verificam o nome do banco como proteção adicional.

### 6.5 Resultados e evidências

Nesta cópia, não há uma execução completa da suíte aprovada. Consulte a seção 6.7 e `docs/evidencias-testes-av3.md` para os comandos tentados, bloqueios observados e verificações estáticas que foram possíveis. Registre a data, o comando completo, o número de testes aprovados/falhos e qualquer erro após executar no ambiente Node.js 24. Não marque uma etapa como aprovada se o comando não chegou a executar os testes.



### 6.6 Demonstração detalhada de entradas e saídas

O comando abaixo executa cenários controlados com asserts e apresenta no terminal a entrada, resultado esperado, resultado obtido e status individual. O relatório Markdown é atualizado no final da execução:

```shell
npm run test:demonstracao
```

Arquivo gerado: `docs/evidencias-testes-av3.md`.

A demonstração cobre as operações de domínio para eficiência, rentabilidade, regressão de vida útil e serialização CSV, além de requisições Fastify para rotas públicas, relatórios e endpoints de saúde/OpenAPI. No cenário de API Key, a rota e o `createApiKeyAuthenticator` de produção são executados; uma chave efêmera é gerada e seu formato/hash é validado pelo código real. O registro retornado pelo Prisma, o controller e o rate limiter são doubles determinísticos, portanto esse cenário não comprova persistência PostgreSQL, revogação consultada no banco nem rate limiting concorrente entre instâncias. Os cenários assíncronos também simulam o cliente Prisma; o processamento/arquivo local é executado pelo serviço, mas não publica em Redis/BullMQ nem inicializa o worker real. Consulte a seção 6.7 e o próprio relatório de evidências para distinguir cada natureza de execução.

### 6.7 Estado de execução desta entrega

A documentação e o código de demonstração foram preparados, mas não foi possível executar `npm run test:demonstracao` nesta sessão porque o ambiente disponibilizou Node.js 22.16.0, enquanto o projeto requer Node.js 24, e a instalação npm expirou sem disponibilizar dependências locais. Docker, PostgreSQL e Redis também não estavam disponíveis. Por isso, não há saída de teste marcada como aprovada nesta entrega; o arquivo de evidências registra esse bloqueio. Execute os comandos acima em ambiente Node 24/Docker antes de apresentar os resultados como homologados.

## 7. Como registrar a avaliação

Ao concluir, registre:

- Sistema operacional e versão.
- Versão do Docker/Compose ou Node/PostgreSQL utilizados.
- Resultado de `docker compose config -q` e `docker compose ps`.
- Resposta de `GET /health`.
- Resultado de `npm test`.
- Resultado de `npm run test:integration`.
- Resultado de `prisma:validate`, geração do client e migrations.
- Testes manuais executados no Swagger, incluindo os cenários negativos.
- Problemas conhecidos que permaneceram sem correção.

Uma execução bem-sucedida demonstra apenas os cenários executados naquele ambiente. Não representa homologação automática de todas as User Stories.
