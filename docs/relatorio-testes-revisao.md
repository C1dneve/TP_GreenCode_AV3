# Relatório de testes — revisão GreenCode AV3

## Ambiente disponível

- Node.js: `v22.16.0` (incompatível com a exigência `>=24 <25` do projeto).
- npm: `10.9.2`.
- Docker: não instalado.
- PostgreSQL CLI/serviço: não disponível.
- Redis: não disponível.
- Runtime instalado continua em Node.js 22; o projeto exige Node.js 24.x.
- Prisma CLI local: não instalado, pois `npm ci` não concluiu.
- A pasta `node_modules` parcial não será incluída no ZIP.

## Resultados reais

| Nome | Objetivo | Comando/ação | Resultado | Execução real |
|---|---|---|---|---|
| Build após correção | Reexecutar `npm run build` | BLOQUEADO — `prisma: not found` (exit 127) | Sim; compilação não iniciou |
| Comando de testes unitários após correção | Reexecutar `npm test` | BLOQUEADO — etapa de build falhou antes de iniciar Node Test Runner (`prisma: not found`, exit 127) | Sim; casos unitários não executados |
| Comando de integração após correção | Reexecutar `npm run test:integration` | BLOQUEADO — etapa de build falhou antes de iniciar testes (`prisma: not found`, exit 127) | Sim; integração não executada |
| Revisão estática da migration de escopos | Conferir se as duas CHECK constraints novas listam os seis valores esperados e se a migration é aditiva | PASSOU — arquivo novo com DROP/ADD das duas constraints; migration anterior preservada | Sim; inspeção estática, sem PostgreSQL |
| Preservação das migrations anteriores | Comparar todas as migrations já existentes no ZIP revisado original com a cópia atual | PASSOU — 9 migrations SQL preexistentes comparadas byte a byte; nenhuma alterada | Sim; comparação de bytes |
| Inventário AV2/AV3 | Confirmar estrutura e módulos | Inspeção dos ZIPs recebidos | PASSOU | Sim |
| Equivalência das migrations AV2-base | Verificar preservação da base | Comparação textual das três migrations após normalizar CRLF/LF | PASSOU | Sim |
| Sintaxe TypeScript | Detectar erros sintáticos em arquivos TS | `typescript.transpileModule` sobre 119 arquivos em `src/` e `prisma/` | PASSOU — 0 diagnósticos sintáticos | Sim; não equivale a typecheck |
| JSON de manifests | Verificar estrutura dos manifests | `JSON.parse` em `package.json` e `package-lock.json` | PASSOU | Sim |
| Instalação npm | Instalar dependências para build/testes | `npm ci --ignore-scripts --no-audit --no-fund` (duas tentativas) | BLOQUEADO POR AMBIENTE — excedeu o limite de execução | Sim |
| Build TypeScript/Prisma | Gerar Prisma Client e compilar | `npm run build` | FALHOU/BLOQUEADO — comando encerrou com `prisma: not found` porque instalação não foi concluída | Sim, mas build não iniciou |
| Typecheck | Verificar tipos TypeScript | `tsc --noEmit -p tsconfig.json` | BLOQUEADO POR AMBIENTE — definições ausentes (`@types/node`, `@types/pg` e tipos transitivos) | Sim, typecheck não ocorreu |
| Prisma validate | Validar schema Prisma | `npm run prisma:validate` | NÃO EXECUTADO — Prisma CLI ausente | Não |
| Prisma generate | Gerar client | `npm run prisma:generate` | NÃO EXECUTADO — Prisma CLI ausente | Não |
| Migrations AV2→AV3 | Verificar evolução de dados | Banco descartável + Prisma migrate | BLOQUEADO POR AMBIENTE — Docker/PostgreSQL ausentes | Não |
| Instalação limpa AV3 | Aplicar todas as migrations | Banco vazio + Prisma migrate | BLOQUEADO POR AMBIENTE — Docker/PostgreSQL ausentes | Não |
| Seed | Verificar idempotência e integridade | `npm run db:seed` | NÃO EXECUTADO — Prisma CLI/DB ausentes | Não |
| Testes unitários | Executar testes existentes e novos | `npm test` | NÃO EXECUTADO — dependências/build ausentes | Não |
| Testes de integração | API, PostgreSQL, isolamento e concorrência | `npm run test:integration` | BLOQUEADO POR AMBIENTE — Node 24, PostgreSQL e Prisma ausentes | Não |
| Redis/BullMQ | Retry, Outbox, lease, worker e scheduler | Docker Compose / worker | BLOQUEADO POR AMBIENTE — Docker/Redis ausentes | Não |
| Compatibilidade Windows/Ubuntu | Validar comandos nos dois sistemas | Execução nativa | NÃO EXECUTADO | Não |

## Testes adicionados/atualizados no código, ainda não executados

- Eficiência: entrada do lote até conclusão; separação entre duração total, efetiva e espera.
- Eficiência: sessão incompleta e legado.
- Eficiência: múltiplas sessões para um lote, seleção da última sessão e rejeição de cronologia inválida.
- Backtesting: previsões maduras, não maduras e maduras sem evento real.
- Projeção pública de analytics: remoção de IDs de equipamentos/referências e dados de operadores.
- Relatório público: remoção de código de barras, IDs e valor de aquisição interno.
- Analytics e relatórios públicos: resolução da organização pelo identificador `X-Integration-ID`, sem exigir UUID interno no corpo/query.
- Rentabilidade: uso de snapshot histórico de preço/kg e percentual recuperável.
- Escopos: validação unitária de cada um dos seis escopos de `INTEGRATION_SCOPES`.
- API pública: cadastro e atualização de parceiro com os seis escopos; cadastro e atualização de API Key com os seis escopos. Estes testes estão no código, mas não foram executados por falta de Node 24, dependências e PostgreSQL.

## Conclusão

Não há aprovação de build, typecheck, migrations, seed, testes unitários ou integração. A verificação sintática TypeScript e a inspeção estática passaram, mas são evidências limitadas. A migration de escopos e os testes correspondentes foram acrescentados. A migration foi verificada estaticamente, mas não aplicada em banco; os testes unitários e de integração foram tentados via npm, porém o build interrompeu os comandos antes da execução dos casos. A homologação deve ocorrer em Node 24 com dependências instaladas e serviços PostgreSQL/Redis reais, seguindo `homologacao-revisao.md`.
