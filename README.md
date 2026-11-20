# GreenCode AV3

Plataforma de logística reversa de equipamentos eletrônicos. A AV3 preserva o monólito modular da AV2 e acrescenta integração pública por API Key, indicadores analíticos persistidos, histórico operacional dos equipamentos, triagem com timestamps explícitos e geração assíncrona de relatórios CSV/JSON.

## Stack e pré-requisitos

- Node.js 24.x (o `package.json` restringe a versão a `>=24 <25`).
- TypeScript, Fastify 5, Prisma ORM 7 e PostgreSQL 17.
- Redis 7 e BullMQ 5 para filas e worker assíncrono.
- Docker Desktop no Windows 10+ ou Docker Engine + Docker Compose no Ubuntu 24.04.03+.

As bibliotecas são gratuitas e de código aberto. O projeto mantém Fastify como servidor HTTP e não utiliza um segundo framework de backend.

## Subida recomendada com Docker Compose

Na raiz do projeto, copie `.env.example` para `.env` e configure credenciais próprias para o ambiente local. Nunca versione `.env` nem use os valores locais de exemplo em produção.

**PowerShell:**

```powershell
if (-not (Test-Path .\.env)) { Copy-Item .env.example .env }
notepad .env
```

**Bash (Ubuntu):**

```bash
if [ ! -f .env ]; then cp .env.example .env; fi
nano .env
```

Configure no mínimo `POSTGRES_PASSWORD`, `JWT_SECRET` (32 bytes aleatórios ou mais), `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_NAME` e `BOOTSTRAP_ADMIN_PASSWORD` (12 caracteres ou mais). Para simplificar a URL de conexão montada pelo Compose, use letras, números e `_` em `POSTGRES_PASSWORD`.

Valide e inicie todos os serviços, incluindo PostgreSQL, Redis, API e worker:

```shell
docker compose config -q
docker compose --profile tests config -q
docker compose up --build -d
docker compose ps
```

O container da API aplica migrations (`npm run db:deploy`) e executa o seed idempotente na inicialização. O worker é um processo separado e consome as filas Redis. A API não depende da disponibilidade imediata do Redis para iniciar: solicitações são gravadas no PostgreSQL pela Outbox e ficam pendentes para publicação quando o worker/Redis voltar.

A API fica disponível em `http://localhost:3000`; o Swagger em `http://localhost:3000/docs/` e o OpenAPI JSON em `http://localhost:3000/docs/json`.

**PowerShell:**

```powershell
Invoke-RestMethod http://localhost:3000/health
```

**Bash:**

```bash
curl --fail --show-error http://localhost:3000/health
```

Para acompanhar os processos:

```shell
docker compose logs -f api worker
```

## Execução local sem Docker

Para executar os comandos Prisma diretamente no Windows/Ubuntu host, o serviço PostgreSQL do Compose publica a porta `5432` somente em `127.0.0.1`. O `.env.example` já contém uma `DATABASE_URL` de exemplo compatível com essa publicação. Copie o arquivo para `.env` e mantenha a senha da URL igual a `POSTGRES_PASSWORD`:

```dotenv
POSTGRES_USER=greencode
POSTGRES_PASSWORD=replace-with-a-local-database-password
POSTGRES_DB=greencode
DATABASE_URL=postgresql://greencode:replace-with-a-local-database-password@127.0.0.1:5432/greencode?schema=public
REDIS_URL=redis://127.0.0.1:6379
```

O `prisma.config.ts` carrega `.env` automaticamente por `dotenv/config`. Assim, `npm run prisma:validate`, `npm run prisma:generate`, `npm run db:deploy` e `npm run db:seed` executados no host conectam à porta local publicada. Dentro dos containers, API e worker continuam usando o hostname interno `postgres:5432` definido explicitamente no Compose; não substitua esse hostname por `127.0.0.1` nos containers.

A porta Redis `6379` também é publicada apenas em `127.0.0.1` para o worker quando executado fora do Docker. Com os serviços PostgreSQL/Redis iniciados e as variáveis `JWT_SECRET` e de bootstrap definidas no `.env`, execute:

```shell
# Primeira instalação após atualizar as dependências da AV3:
npm install
# Nas instalações seguintes, com package-lock.json já atualizado:
# npm ci
npm run prisma:validate
npm run prisma:generate
npm run db:deploy
npm run db:seed
```

Em dois terminais separados, inicie a API e o worker:

```shell
npm run dev
npm run dev:worker
```

Para build/execução de produção:

```shell
npm run build
npm run start
npm run start:worker
```

O worker lê `REDIS_URL` (padrão `redis://127.0.0.1:6379`), `REPORTS_DIR` (padrão `./storage/reports`), `REPORT_EXPIRATION_DAYS` (1 a 30 dias; padrão 7) e `WORKER_CONCURRENCY` (1 a 10; padrão 3). As análises recorrentes são configuradas por `ANALYTICS_EFFICIENCY_INTERVAL_MS` (padrão 3.600.000 ms), `ANALYTICS_PROFITABILITY_INTERVAL_MS` (padrão 21.600.000 ms) e `ANALYTICS_USEFUL_LIFE_INTERVAL_MS` (padrão 86.400.000 ms); cada intervalo deve ser inteiro de no mínimo 60.000 ms. Configure essas variáveis no `.env` local; o Compose injeta valores próprios para os containers. O worker aplica limpeza de arquivos expirados periodicamente e registra os três agendamentos com IDs estáveis por meio de `upsertJobScheduler` do BullMQ.

## Funcionalidades AV3

### API pública e parceiros

O administrador gerencia parceiros, vínculos com organizações e o ciclo de vida das API Keys. O segredo completo da API Key é mostrado apenas na criação; o banco armazena somente o hash. As permissões efetivas de cada chave são a interseção entre os escopos do parceiro e os da própria chave. Todas as operações públicas verificam a chave ativa e o vínculo ativo com a organização.

| Operação | Método e rota | Escopo/controle |
|---|---|---|
| Submeter lote | `POST /api/v1/public/lotes` | `lotes:write`, `X-API-Key`, `X-Integration-ID`, `Idempotency-Key` |
| Rastrear por identificador GreenCode | `GET /api/v1/public/rastreabilidade/lotes/{identificadorPublico}` | `rastreabilidade:read` e vínculo ativo |
| Rastrear por referência do parceiro | `GET /api/v1/public/rastreabilidade/external/{externalId}` | `rastreabilidade:read` e vínculo ativo |
| Executar análise | `POST /api/v1/public/analytics/{tipo}` | `analytics:write` e vínculo ativo |
| Consultar análises | `GET /api/v1/public/analytics/{tipo}/historico` | `analytics:read` e vínculo ativo |
| Solicitar relatório | `POST /api/v1/public/relatorios` | `reports:write` e vínculo ativo |
| Listar/consultar relatório | `GET /api/v1/public/relatorios[/{id}]` | `reports:read` e vínculo ativo |
| Baixar relatório | `GET /api/v1/public/relatorios/{id}/download` | `reports:read`, proprietário parceiro e vínculo ativo |

Escopos disponíveis: `lotes:write`, `rastreabilidade:read`, `analytics:read`, `analytics:write`, `reports:read` e `reports:write`.

### Indicadores analíticos

Os endpoints internos, protegidos por JWT e papel administrativo/auditor, são:

- `POST /api/v1/analytics/eficiencia-operacional`
- `POST /api/v1/analytics/rentabilidade`
- `POST /api/v1/analytics/vida-util`
- `GET /api/v1/analytics/{tipo}/historico`

As análises persistem método, versão, filtros, resultado, quantidade de observações, confiabilidade quando aplicável e sinalização de dados demonstrativos em `execucoes_analise`. O histórico público filtra registros demonstrativos.

**Eficiência operacional:** usa os eventos persistidos `TRIAGEM_INICIADA` e `TRIAGEM_CONCLUIDA` da mesma sessão para calcular duração real. Apresenta média, mediana, percentis, mínimos/máximos, agregação por operador e organização, lotes pendentes e sessões incompletas.

**Rentabilidade/recuperação:** a estimativa é `peso em kg × valor de referência por kg × percentual recuperável / 100`. A referência ativa por tipo, marca e condição física tem precedência; uma tabela-base conservadora é usada quando não há referência cadastrada. O valor efetivamente recuperado é armazenado separadamente e não é inferido.

**Vida útil remanescente:** regressão linear OLS relaciona valor depreciado e idade em meses. Exige valor de aquisição positivo e, no mínimo, três avaliações em datas distintas. Falhas e manutenções ajustam a projeção; sem evidência suficiente, a previsão fica indisponível com motivo explícito. O R² e o índice de confiabilidade são medidas indicativas de aderência, não probabilidades de sobrevivência.

### Triagem e histórico técnico

- `POST /api/v1/lotes/{loteId}/triagem/iniciar`
- `POST /api/v1/lotes/{loteId}/triagem/{sessaoId}/ocorrencias`
- `POST /api/v1/lotes/{loteId}/triagem/{sessaoId}/concluir`
- `GET /api/v1/lotes/{loteId}/triagem/historico`
- Compatibilidade AV2 preservada: `POST /api/v1/lotes/{loteId}/triagem` executa a triagem síncrona e grava `TRIAGEM_INICIADA` e `TRIAGEM_CONCLUIDA` na mesma sessão histórica.

Ambos os fluxos usam transações, controle de versão e rejeitam repetição ou transições inválidas. Cada etapa registra responsável e timestamp; a duração é derivada dos eventos persistidos. Para equipamentos também existem rotas de falhas, manutenções, avaliações periódicas de depreciação, estimativa/realização de recuperação e consulta agregada do histórico em `/api/v1/equipamentos/{equipamentoId}/historico-analitico`.

Dados criados pelo seed para demonstrar esses indicadores são identificados por `demonstracao=true`. Os endpoints operacionais não permitem ao cliente ocultar dados reais marcando-os como demonstrativos.

### Relatórios assíncronos

Rotas internas (JWT + Administrador/Auditor):

- `POST /api/v1/relatorios/async` — responde `202` com o identificador da solicitação.
- `GET /api/v1/relatorios/async` e `GET /api/v1/relatorios/async/{id}` — histórico e estado.
- `POST /api/v1/relatorios/async/{id}/reprocessar` — reprocessa uma execução com falha ainda dentro do prazo.
- `GET /api/v1/relatorios/async/{id}/download` — download protegido.

Tipos aceitos: `operacional`, `equipamentos`, `triagem`, `rentabilidade` e `vida-util`. Formatos: `CSV` e `JSON`. Os estados são `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` e `EXPIRED`.

A solicitação e o evento de Outbox são gravados na mesma transação PostgreSQL. Um worker separado publica o job no BullMQ, com `jobId` estável, cinco tentativas e backoff exponencial inicial de 3 segundos. O heartbeat persistido permite recuperar execuções interrompidas. Os arquivos ficam em volume persistente; metadados e hash SHA-256 ficam no banco. A expiração e a limpeza são controladas por `REPORT_EXPIRATION_DAYS`. O CSV escapa campos e neutraliza prefixos de fórmula de planilha.

## Validação e testes

```shell
npm run prisma:validate
npm run prisma:generate
npm run build
npm test
npm run test:integration
```

A suíte de integração deve utilizar exclusivamente o banco separado `greencode_test` definido no Compose. Para executá-la pelo Compose:

```shell
docker compose --profile tests run --rm test-runner
```

O perfil `tests` inicia PostgreSQL e Redis de teste separados. Não altere `DATABASE_URL` dos testes para apontar ao banco principal.

## Compatibilidade e operação

- **Windows 10 ou superior:** Docker Desktop com integração WSL2 é o caminho recomendado. Os exemplos de criação `.env` e health-check usam PowerShell.
- **Ubuntu 24.04.03 ou superior:** Docker Engine e plugin Compose; os exemplos equivalentes usam Bash.
- Os comandos `docker compose` e os scripts npm são os mesmos nos dois sistemas. Ao executar localmente sem Docker, use Node 24.x e Redis/PostgreSQL acessíveis; caminhos de `REPORTS_DIR` devem ser válidos no sistema operacional.
- O armazenamento padrão dos relatórios é relativo ao diretório de execução. Em produção, configure um volume persistente e permissões restritas.

## Nota sobre a mensuração de triagem e consultas analíticas

O endpoint compatível da AV2 continua disponível, mas suas sessões são persistidas como `LEGADO_AV2`/não mensuráveis. Elas permanecem nas contagens operacionais, mas não entram no tempo médio/mediano. O fluxo AV3 explícito é mensurável com os timestamps de início e conclusão. Análises e relatórios recusam conjuntos acima de 20.000 registros com erro explícito, sem gerar saída parcial.

As análises que incluem massa demonstrativa mantêm referências financeiras e históricos vinculados à mesma origem (`demonstracao`) do equipamento.

## Documentação técnica

- [Relatório técnico da AV3](docs/relatorio-tecnico-av3.md)
- [Guia de execução e testes](docs/guia-de-testes-professor.md)
- [Arquitetura da AV3](docs/arquitetura-av3.md)
- [Modelo de dados](docs/modelo-de-dados-av3.md)
- [Requisitos da AV3](docs/requisitos-av3.md)
- [ADRs](docs/adr/README.md)
