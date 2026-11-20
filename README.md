# GreenCode AV3

O GreenCode apoia o controle da logística reversa de equipamentos eletrônicos. A AV3 amplia a API operacional com integração de organizações parceiras e prepara a plataforma para análises e relatórios preditivos. O primeiro incremento implementa a gestão de parceiros, API Keys, submissão pública de lotes e consulta de rastreabilidade.

## Como executar

A forma recomendada para avaliação é usar Docker Compose. Assim, não é necessário instalar Node.js ou PostgreSQL diretamente no computador para iniciar a API e executar os testes. No Windows, utilize Docker Desktop; no Ubuntu 24.04 ou superior, utilize Docker Engine com o plugin Docker Compose.

Abra um terminal na raiz do projeto, onde estão `Dockerfile` e `docker-compose.yml`. Os comandos `docker compose` abaixo funcionam no PowerShell e no Bash; somente a criação do `.env`, a geração do segredo JWT e as consultas HTTP variam conforme o terminal.

**A preparação completa, os testes manuais pelo Swagger e os testes automatizados estão no [Guia de execução e testes](docs/guia-de-testes-professor.md).**

### 1. Criar o arquivo `.env`

**Windows (PowerShell):**

```powershell
if (-not (Test-Path .\.env)) { Copy-Item .env.example .env }
notepad .env
```

**Ubuntu (Bash):**

```bash
if [ ! -f .env ]; then cp .env.example .env; fi
nano .env
```

Revise principalmente `POSTGRES_PASSWORD`, `JWT_SECRET`, `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_NAME` e `BOOTSTRAP_ADMIN_PASSWORD`. A senha inicial do administrador deve ter pelo menos 12 caracteres. Para simplificar a URL de conexão criada pelo Compose, use em `POSTGRES_PASSWORD` apenas letras, números e `_`.

Os valores de `.env.example` são destinados somente a uma avaliação local isolada. Não os utilize em produção, não compartilhe o arquivo `.env` e não o versione. O Compose monta a `DATABASE_URL` internamente para os containers; não é necessário adicionar essa variável ao `.env` para o fluxo Docker.

### 2. Gerar um segredo JWT aleatório

Gere um segredo de pelo menos 32 bytes e grave-o na linha `JWT_SECRET` do `.env`.

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

O comando do Ubuntu usa `openssl`. Se não estiver instalado, instale-o pelo gerenciador de pacotes da distribuição. Não copie o segredo para documentação, mensagens ou capturas de tela.

### 3. Validar a configuração e iniciar

Estes comandos são iguais no PowerShell e no Bash, a partir da raiz do projeto:

```shell
docker compose config -q
docker compose --profile tests config -q
docker compose up --build -d
docker compose ps
```

A API depende do PostgreSQL saudável. Aguarde os serviços `postgres` e `api` ficarem `healthy`. Se aparecerem como `starting`, aguarde alguns segundos e execute `docker compose ps` novamente.

**Windows (PowerShell):**

```powershell
Invoke-RestMethod http://localhost:3000/health
```

**Ubuntu (Bash):**

```bash
curl --fail --show-error http://localhost:3000/health
```

A resposta esperada contém `status: ok` e `service: greencode-api`. Abra `http://localhost:3000/docs/` no navegador para acessar o Swagger ou `http://localhost:3000/docs/json` para consultar o contrato OpenAPI.

### 4. Banco de dados, migrations e seed

O container da API executa `npm run db:deploy` e `npm run db:seed` ao iniciar. O primeiro comando aplica as migrations versionadas; o segundo cria o administrador inicial quando ainda não existe e verifica os dados demonstrativos. Os dados demonstrativos incluem organizações, contratos, lotes e equipamentos utilizados também no roteiro manual.

Para acompanhar a inicialização:

```shell
docker compose logs -f api
```

Para conferir manualmente a configuração Prisma e o estado das migrations, execute dentro do container da API:

```shell
docker compose exec api npm run prisma:validate
docker compose exec api npm run prisma:generate
docker compose exec api npm run db:deploy
docker compose exec api npm run db:seed
```

O seed preserva registros existentes e não redefine a senha de um administrador que já tenha sido criado. Se o volume do banco já foi utilizado, alterar `BOOTSTRAP_ADMIN_PASSWORD` no `.env` não troca a senha de uma conta existente.

### Credenciais iniciais

Para acessar `POST /api/v1/auth/login` no Swagger, utilize os valores locais de `BOOTSTRAP_ADMIN_USERNAME` e `BOOTSTRAP_ADMIN_PASSWORD` configurados no `.env`. O administrador é criado pelo seed somente quando ainda não existe. Não publique essas credenciais nem as inclua em evidências compartilhadas.

Para parar os containers sem apagar os dados:

```shell
docker compose down
```

Somente para descartar os dados locais e começar do zero, execute:

```shell
docker compose down -v
```

**Atenção:** `down -v` apaga os volumes PostgreSQL da aplicação e dos testes deste Compose. Não utilize esse comando se precisar preservar os registros locais.

## O que o sistema cobre

A AV3 mantém o fluxo operacional do GreenCode — organizações, contratos, lotes, equipamentos, movimentações, usuários, permissões, parâmetros, auditoria e relatórios básicos — e acrescenta integração externa.

No primeiro incremento, o Administrador gerencia parceiros, associações com organizações e API Keys. O parceiro autorizado pode submeter lote sem equipamentos ou lote acompanhado de equipamentos, além de consultar a rastreabilidade por identificador público GreenCode ou por sua referência externa. As permissões efetivas combinam os escopos do parceiro e da chave, e cada operação verifica o vínculo ativo com a organização.

A camada analítica, a previsão de vida útil, a estimativa de recuperação financeira, Redis/BullMQ, workers e relatórios assíncronos permanecem nas próximas fases; não devem ser considerados funcionalidades concluídas deste incremento.

## API pública inicial

| Operação | Método e rota | Autorização |
|---|---|---|
| Submeter lote e equipamentos opcionais | `POST /api/v1/public/lotes` | `X-API-Key`, `X-Integration-ID`, `Idempotency-Key` e escopo `lotes:write` |
| Consultar rastreabilidade por identificador GreenCode | `GET /api/v1/public/rastreabilidade/lotes/{identificadorPublico}` | `X-API-Key`, escopo `rastreabilidade:read` e vínculo ativo |
| Consultar rastreabilidade por referência do parceiro | `GET /api/v1/public/rastreabilidade/external/{externalId}` | `X-API-Key`, escopo `rastreabilidade:read` e vínculo ativo |
| Gerenciar parceiros, vínculos e chaves | Rotas `/api/v1/parceiros/...` | JWT de usuário interno com papel `ADMINISTRADOR` |

A organização de destino é identificada pelo código público de integração enviado em `X-Integration-ID`; não envie ID interno nem CNPJ como identificador de integração. O Swagger descreve os schemas, headers, exemplos e códigos de resposta.

## Documentação

- [Visão, história e arquitetura do produto](docs/GreenCode-AV3.md)
- [Requisitos e rastreabilidade](docs/requisitos-av3.md)
- [Arquitetura da AV3](docs/arquitetura-av3.md)
- [Modelo de dados](docs/modelo-de-dados-av3.md)
- [Épicos e histórias de usuário](docs/epicos-e-user-stories-av3.md)
- [Plano de implementação](docs/plano-de-implementacao-av3.md)
- [Relatório técnico e evidências da entrega](docs/relatorio-tecnico-av3.md)
- [Estrutura de pastas](docs/estrutura-de-pastas-av3.md)
- [Guia de execução e testes](docs/guia-de-testes-professor.md)
- [Registros de decisões arquiteturais (ADRs)](docs/adr/README.md)

## Testes automatizados

A validação manual pelo Swagger complementa, mas não substitui, os testes automatizados. O projeto possui testes unitários/HTTP e testes de integração com PostgreSQL. O Compose fornece um banco separado chamado `greencode_test`, evitando que a suíte de integração utilize o banco principal da aplicação.

### 1. Testes unitários e HTTP

```shell
docker compose --profile tests run --rm --no-deps test-runner npm test
```

Esse comando executa o build TypeScript e a suíte `src/tests/*.test.ts`. A opção `--no-deps` evita iniciar o PostgreSQL de testes, que não é necessário para essa suíte.

### 2. Testes de integração com PostgreSQL

```shell
docker compose --profile tests run --rm test-runner
```

Esse comando inicia o serviço `postgres-test`, aplica as migrations, executa o seed e roda `npm run test:integration`. O banco usado é `greencode_test`, separado do banco da API. Os testes verificam o nome da base e recusam uma URL que não contenha `test` no nome. Os arquivos de integração são executados sequencialmente (`--test-concurrency=1`) porque compartilham esse banco dedicado e algumas operações usam transações serializáveis.

Não altere a URL dos testes para apontar ao banco principal ou a um banco de produção. Consulte o [Guia de execução e testes](docs/guia-de-testes-professor.md) para o roteiro manual de parceiro, API Key, submissão, idempotência, rastreabilidade e cenários negativos.

Os resultados de uma execução devem ser registrados com os números efetivamente exibidos no terminal. O registro técnico atualmente disponível informa cinco testes unitários focados aprovados, mas ainda não comprova o build completo, validação Prisma, migrations nem a suíte HTTP/PostgreSQL. Consulte [relatório técnico](docs/relatorio-tecnico-av3.md); não considere o incremento homologado até concluir as verificações pendentes.

## Tecnologias principais

Node.js 24, TypeScript, Fastify 5, Prisma 7, PostgreSQL 17, JWT, API Keys e Swagger/OpenAPI. O código mantém o monólito modular e separa rotas/controllers, services, repositories e acesso ao banco nos módulos operacionais. Os módulos novos de integração possuem uma divergência de persistência registrada no relatório técnico para revisão arquitetural.
