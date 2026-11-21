# Homologação — GreenCode AV3 revisado

Este roteiro corresponde aos scripts e serviços definidos no projeto. Execute primeiro em ambiente descartável, sem apontar para o banco original de desenvolvimento.

## 1. Pré-requisitos

- Node.js 24.x (`>=24 <25`) e npm compatível.
- Docker Desktop/WSL2 no Windows 10+ ou Docker Engine + Docker Compose no Ubuntu 24.04.03+.
- Git não é necessário para executar a aplicação.
- Portas host: PostgreSQL `5433`, Redis `6379`, API `3000`.

## 2. Configuração

PowerShell:

```powershell
Copy-Item .env.example .env
notepad .env
```

Ubuntu/Bash:

```bash
cp .env.example .env
nano .env
```

Configure valores fortes para `POSTGRES_PASSWORD`, `JWT_SECRET` (mínimo 32 bytes), `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_NAME` e `BOOTSTRAP_ADMIN_PASSWORD`. Não compartilhe nem versione `.env`.

## 3. Subir infraestrutura com Docker Compose

```bash
docker compose config -q
docker compose --profile tests config -q
docker compose up --build -d
docker compose ps
docker compose logs -f api worker
```

O container `api` executa `npm run db:deploy` e `npm run db:seed` antes de iniciar o servidor. O container `worker` consome as filas BullMQ. Não execute `docker compose down -v` em ambiente que contenha dados que devam ser preservados.

Verifique:

```bash
curl --fail --show-error http://localhost:3000/health
```

PowerShell equivalente:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Swagger: `http://localhost:3000/docs/`
OpenAPI JSON: `http://localhost:3000/docs/json`

## 4. Execução local fora dos containers

Com PostgreSQL e Redis disponíveis, configure `.env` com `DATABASE_URL` na porta host `5433` e `REDIS_URL=redis://127.0.0.1:6379`.

```bash
npm ci
npm run prisma:validate
npm run prisma:generate
npm run db:deploy
npm run db:seed
npm run build
```

Em terminais separados:

```bash
npm run dev
npm run dev:worker
```

## 5. Testes

```bash
npm test
npm run test:integration
```

Para executar os testes integrados no Compose, o projeto possui os serviços `postgres-test`, `redis-test` e `test-runner` no perfil `tests`:

```bash
docker compose --profile tests run --rm test-runner
```

O test-runner utiliza `greencode_test`, banco isolado. Não altere `DATABASE_URL` para apontar para o banco principal.

## 6. Reconstrução AV2 → AV3 e instalação limpa

Realize esses cenários em dois bancos descartáveis independentes.

### Cenário A — AV2 → AV3

1. Suba PostgreSQL isolado.
2. Use a pasta AV2 recebida, com suas migrations e seed.
3. Aplique migrations AV2 e execute o seed AV2.
4. Registre contagens de organizações, contratos, lotes, equipamentos e usuários.
5. Aplique migrations AV3 em sequência e gere o Prisma Client AV3.
6. Verifique as contagens e FKs anteriores; execute seed AV3 e confira idempotência.
7. Execute build, testes unitários e integração AV3.

### Cenário B — instalação limpa AV3

1. Crie banco vazio separado.
2. Configure `DATABASE_URL` para esse banco.
3. Execute `npm run db:deploy` desde a primeira migration.
4. Execute `npm run db:seed`.
5. Execute `npm run prisma:validate`, `npm run prisma:generate`, `npm run build`, `npm test` e `npm run test:integration`.
6. Inicie API e worker e valide os fluxos públicos e assíncronos.

Não execute `migrate reset` em banco que não seja explicitamente descartável. Não remova volumes Docker de ambientes com dados a preservar.

## 7. Fluxos principais para validar manualmente

- Login JWT e RBAC interno.
- CRUD de organizações, lotes e equipamentos.
- Triagem: início, ocorrência, conclusão e histórico.
- Analytics: eficiência total/efetiva/espera, rentabilidade com snapshot e vida útil.
- Backtesting de previsões amadurecidas contra transições auditadas `INSERVIVEL`.
- Parceiros, associações, API Keys, escopos, expiração e revogação.
- Submissão pública com `X-API-Key`, `X-Integration-ID` e `Idempotency-Key`.
- Cadastro e atualização de parceiro com os seis escopos (`lotes:write`, `rastreabilidade:read`, `analytics:read`, `analytics:write`, `reports:read`, `reports:write`).
- Cadastro e atualização de API Key com os seis escopos e validação das duas CHECK constraints no PostgreSQL.
- Isolamento entre parceiros e organizações.
- Rate limit e HTTP 429.
- Relatórios: solicitação, status, processamento, download, checksum e expiração.
- Reinicialização do worker, recuperação por lease/heartbeat, retry e Outbox.
- Swagger/OpenAPI e respostas de erro.

## 8. Registro da homologação

Para cada comando, registre data, versão de Node, ambiente, saída e classificação `PASSOU`, `FALHOU`, `NÃO EXECUTADO` ou `BLOQUEADO POR AMBIENTE`. Não transforme teste unitário mockado em evidência de integração real.
