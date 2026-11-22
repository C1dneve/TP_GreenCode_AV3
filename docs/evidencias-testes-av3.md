# Evidências da demonstração automatizada — GreenCode AV3

**Registro histórico do ambiente local anterior (Node.js 22):** naquela sessão, os cenários estavam implementados, mas a execução foi bloqueada por incompatibilidade do runtime e ausência de dependências. Esse registro histórico é separado da execução do GitHub Actions em Node.js 24 descrita abaixo; não representa o resultado da execução de CI.

## Ambiente local observado na sessão anterior (Node.js 22)

| Item | Resultado real |
|---|---|
| Node.js local anterior | `v22.16.0`; o projeto exige `>=24 <25` (`.nvmrc` = `24`). |
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

## Verificações estáticas e comandos tentados nesta cópia

| Verificação | Resultado observado |
|---|---|
| Runtime | Node.js `v22.16.0`; o projeto requer Node.js 24 (`>=24 <25`). |
| `npm ci --ignore-scripts --no-audit --no-fund --prefer-offline` | Não concluiu; expirou durante a instalação e emitiu `EBADENGINE` para o runtime Node 22. |
| `npm run prisma:validate` | Exit 127 — `prisma: not found`. |
| `npm run build` | Exit 127 — interrompido em `prisma generate`; `prisma: not found`. |
| `npm test` | Exit 127 durante o build preliminar; o runner de testes unitários não iniciou. |
| `npm run test:demonstracao` | Exit 127 durante o build preliminar; nenhum cenário demonstrativo iniciou. |
| Testes estáticos de navegação, schema e temas | `node --experimental-strip-types --test src/tests/swagger-navigation.test.ts` — 3 aprovados, 0 reprovados. Esses testes verificam a ordem declarada, presença dos schemas e paletas CSS; não substituem o Swagger renderizado. |
| Sintaxe do JavaScript da sidebar | `node --check src/docs/greencode-swagger-sidebar.js` — passou. |
| Parser TypeScript | 120 arquivos em `src/**/*.ts`, 0 diagnósticos sintáticos. É análise de parsing, não type-check. |
| Configuração | `package.json` e `package-lock.json` são JSON válidos; `.github/workflows/ci.yml` foi carregado pelo parser YAML e a ordem demonstração→upload foi verificada. |
| Contraste de tokens CSS | Pares medidos (texto/superfície, secundário/superfície, link/fundo, texto/acento, código/fundo): Light `16,25 / 6,29 / 6,08 / 5,38 / 13,32`; Dark `14,42 / 9,23 / 12,10 / 9,89 / 14,74`. Isso é uma verificação dos pares de variáveis indicados, não uma auditoria integral WCAG da interface renderizada. |
| Swagger HTTP / screenshots | Não realizados: API não pôde ser construída/iniciada. Não existem screenshots reais de Light, Dark, operações expandidas ou modal de autorização nesta execução. |

A correção da fixture e as novas verificações estáticas estão no código, mas build, Prisma Generate, testes unitários de domínio e demonstração precisam ser reexecutados sob Node.js 24 com `npm ci` concluído. Não foi possível confirmar a nova contagem de testes após a correção nesta cópia.

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

O runner imprime para cada cenário: nome, natureza, entrada, critérios esperados, retorno efetivamente capturado, validações e diferença nos asserts. Ao final grava runtime, data, total aprovado/reprovado e os objetos retornados na seção da execução mais recente, sem apagar o histórico anterior deste arquivo. Se um cenário falhar, seu estado será `REPROVADO` e o comando termina com código diferente de zero.

Para a suíte de integração, configure PostgreSQL 17 e Redis 7 com banco dedicado cujo nome contenha `test`, siga as salvaguardas do `docs/guia-de-testes-professor.md` e execute:

```bash
npm run test:integration
```

A demonstração não é substituta da integração: os doubles de Prisma, controller, rate limiter e Outbox são indicados na natureza/validações dos cenários. Em particular, o cenário de API Key executa o `createApiKeyAuthenticator` e a verificação de formato/hash reais com registro Prisma simulado; não comprova persistência PostgreSQL, consulta real de revogação, concorrência de rate limit entre instâncias, nem execução real de Redis/BullMQ/worker.


## Histórico da execução anterior do GitHub Actions (Node.js 24)

Conforme o resultado da última execução do workflow informado para esta entrega, antes da correção da fixture:

| Etapa | Resultado registrado |
|---|---|
| Build TypeScript e Prisma Generate | Concluídos. |
| Testes unitários | 63 aprovados e 1 reprovado, em 64 testes. |
| Falha | `comparativo por operador distribui sobreposições, explicita amostras e exclui sessões legadas`: sessão `LEGADO_AV2` concluída antes da entrada do lote e, portanto, corretamente descartada pelo serviço. |

A fixture unitária foi corrigida para iniciar a sessão legada em `2026-11-20T13:00:00Z` e concluí-la em `2026-11-20T13:15:00Z`, alinhada ao cenário já utilizado em `src/tests/demonstracao.ts`. A origem `LEGADO_AV2`, `mensuravel = false` e os asserts do teste foram preservados. A regra de cronologia do serviço não foi flexibilizada.

**Reexecução após a correção:** não foi possível executar build, Prisma, testes unitários ou demonstração neste ambiente de trabalho, que disponibiliza Node.js `v22.16.0` enquanto o projeto exige Node.js 24; também não há dependências locais instaladas nem Docker disponível. Portanto, o resultado posterior da correção permanece **não verificado localmente** e deve ser confirmado pela nova execução do GitHub Actions. Não se reutiliza o resultado 63/1 como se fosse resultado após a correção.

> O registro de bloqueio do ambiente Node.js 22 nas seções anteriores permanece como histórico e não deve ser confundido com a execução do GitHub Actions em Node.js 24.

<!-- EXECUCOES_DEMONSTRATIVAS_ATUAIS -->
