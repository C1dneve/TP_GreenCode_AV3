# Evidências da demonstração automatizada — GreenCode AV3

**Situação desta entrega:** cenários implementados, mas execução bloqueada pelo ambiente desta sessão. Não existem saídas de teste apresentadas como resultados obtidos. O comando `npm run test:demonstracao` substituirá este arquivo por um relatório com entradas e retornos capturados somente depois de executar os cenários.

## Ambiente observado

| Item | Resultado real |
|---|---|
| Node.js | `v22.16.0`; o projeto exige `>=24 <25` (`.nvmrc` = `24`). |
| Instalação de dependências | `npm ci --ignore-scripts --no-audit --no-fund --prefer-offline` excedeu o limite de 120 segundos e emitiu `EBADENGINE` para Node 22. |
| Prisma validate | `npm run prisma:validate` — bloqueado, `prisma: not found` (exit 127). |
| Prisma generate | `npm run prisma:generate` — bloqueado, `prisma: not found` (exit 127). |
| Migrations | `npm run db:deploy` — bloqueado, `prisma: not found` (exit 127). |
| Build TypeScript | `npm run build` — bloqueado na etapa Prisma generate (exit 127). |
| Testes unitários | `npm run test:unit` — bloqueados antes do test runner, na etapa de build (exit 127). Nenhum teste unitário foi executado. |
| Testes de integração | `npm run test:integration` — bloqueados antes do test runner, na etapa de build (exit 127). Nenhum teste de integração foi executado. |
| Demonstração | `npm run test:demonstracao` — bloqueada antes do runner, na etapa de build (exit 127). Nenhum cenário demonstrativo foi executado. |
| API / worker | `npm start` e `npm run start:worker` não iniciaram: os arquivos `dist/src/server.js` e `dist/src/worker.js` não existem porque o build não ocorreu. |
| Docker / PostgreSQL / Redis | Docker CLI ausente (`docker: command not found`, exit 127); PostgreSQL e Redis não foram inicializados. |
| OpenAPI e Swagger | `/docs/json` e `/docs/` não foram consultados por HTTP; a API não iniciou. Não há screenshots reais desta sessão. |

## Verificações estáticas concluídas

| Verificação | Resultado |
|---|---|
| Parser TypeScript | 119 arquivos `src/**/*.ts` analisados com o parser TypeScript global; zero diagnósticos sintáticos. Não substitui type-check/build. |
| Sintaxe da sidebar | `node --check src/docs/greencode-swagger-sidebar.js` — passou. |
| JSON do projeto | `package.json` e `package-lock.json` carregados com `JSON.parse` — ambos válidos. |
| Links Markdown | 8 documentos Markdown percorridos; zero links locais quebrados. |

## Cenários preparados em `src/tests/demonstracao.ts`

Os seguintes cenários contêm entrada controlada, critérios de asserção, captura do retorno e estado individual. A lista representa cobertura codificada, não resultados executados nesta cópia.

| Cenário | O que o teste verifica | Natureza da prova prevista |
|---|---|---|
| Eficiência operacional | União de intervalos, atribuição de sobreposição, médias/medianas, denominadores, lote único e exclusão de AV2 legado. | Serviço real com repositório fixture/mocado. |
| Rentabilidade | Peso, referência por marca/condição, percentual recuperável e valor estimado por equipamento. | Função/serviço real com referência determinística. |
| Vida útil remanescente | Histórico em meses, regressão OLS, inclinação, R², amostra mínima e disponibilidade. | Função estatística e serviço reais com repositório fixture. |
| API pública | Respostas 201, 403, 429 e 401; `Retry-After`; chave ausente, inválida e revogada. | Rota Fastify e `createApiKeyAuthenticator` reais; API Key efêmera gerada e hash validado pelo código real. Prisma, controller e rate limiter são simulados. |
| Relatório assíncrono | HTTP 202, identificador, status inicial e chamadas transacionais esperadas de relatório/Outbox/auditoria. | Rotas/serviço reais com cliente Prisma simulado; não usa Redis/BullMQ. |
| Processamento e download | Processamento do serviço, arquivo CSV local, status final e validação SHA-256 no download. | Serviço real e filesystem temporário; persistência e worker/fila são simulados/ausentes. |
| Retry de relatório | Estado FAILED, geração de novo job, Outbox e auditoria. | Serviço real com Prisma simulado; sem publicação real no Redis. |
| Serialização CSV | Cabeçalho, linhas e conteúdo serializado, comparados byte a byte. | Serializador puro utilizado pelo módulo. |
| HTTP saúde/OpenAPI/Swagger | Inicialização Fastify sem banco e respostas de `/health`, `/docs/json` e `/docs/`. | App e Swagger UI integrados ao Fastify; depende de build e dependências instaladas. |

## Como produzir evidências reais

Em ambiente com Node.js 24 e dependências instaláveis:

```bash
npm ci
npm run test:demonstracao
```

O runner imprime para cada cenário: nome, natureza, entrada, critérios esperados, retorno efetivamente capturado, validações e diferença nos asserts. Ao final grava runtime, data, total aprovado/reprovado e os objetos retornados neste arquivo. Se um cenário falhar, seu estado será `REPROVADO` e o comando termina com código diferente de zero.

Para a suíte de integração, configure PostgreSQL 17 e Redis 7 com banco dedicado cujo nome contenha `test`, siga as salvaguardas do `docs/guia-de-testes-professor.md` e execute:

```bash
npm run test:integration
```

A demonstração não é substituta da integração: os doubles de Prisma, controller, rate limiter e Outbox são indicados na natureza/validações dos cenários. Em particular, o cenário de API Key executa o `createApiKeyAuthenticator` e a verificação de formato/hash reais com registro Prisma simulado; não comprova persistência PostgreSQL, consulta real de revogação, concorrência de rate limit entre instâncias, nem execução real de Redis/BullMQ/worker.
