# Relatório de alterações — revisão GreenCode AV3

## Resumo executivo

A revisão foi realizada sobre uma cópia do ZIP AV3. A estrutura monolítica modular, a stack e as funcionalidades existentes foram preservadas. O ZIP AV2 foi utilizado para comparar a base e as migrations iniciais; o PDF oficial e `greencode.txt` foram usados como referência de requisitos e contexto.

A primeira rodada concentrou-se nos problemas diretamente identificados no prompt mestre: semântica de eficiência operacional, explicabilidade da rentabilidade, qualidade da projeção de vida útil, backtesting, minimização de dados públicos, coerência de configuração e documentação.

## Problemas identificados e correções

1. **Eficiência operacional media apenas a sessão de triagem.** O serviço agora calcula o ciclo total desde `Lote.dataEntrada` até a conclusão válida, separa tempo efetivo e espera, filtra o período pela conclusão, usa o último evento de conclusão por lote, agrega todas as sessões AV3 válidas por união de intervalos (sem dupla contagem em sobreposições) e não conta um lote mais de uma vez. Lotes com cronologia inválida e lotes sem conclusão válida não produzem duração.
2. **Rentabilidade não preservava a referência histórica usada.** Foram adicionados campos de snapshot em `AvaliacaoRecuperacao`: preço/kg, percentual recuperável, fonte, observação metodológica e referência utilizada. O resultado analítico passa a expor detalhes por equipamento, além de médias e agregações. Avaliações históricas sem snapshot são identificadas como tal, sem atribuir a elas a referência vigente atual.
3. **Vida útil aceitava projeções de qualidade insuficiente.** A análise agora desconsidera avaliações futuras/inválidas, exige três pontos distintos, tendência negativa e R² mínimo de 0,35; não projeta equipamento já INSERVIVEL nem horizonte cujo limite matemático já tenha sido ultrapassado.
4. **Backtesting estava ausente.** Foi adicionado `UsefulLifeBacktestingService`, que compara previsões amadurecidas com a primeira transição auditada posterior para INSERVIVEL. Calcula erro médio assinado, erro absoluto médio e MAPE; previsões ainda não maduras e maduras sem evento observado são separadas. O resultado é persistido como `BACKTESTING_VIDA_UTIL`.
5. **Respostas públicas de analytics e relatórios podiam reaproveitar projeções internas.** Foram criadas projeções próprias para analytics e sanitização dos relatórios públicos. São removidos IDs internos de equipamentos e referências, códigos de barras, nomes de operadores, dados administrativos e campos internos desnecessários. Status público de relatórios não retorna o `organizacaoId`. As requisições públicas de analytics e relatórios também passaram a resolver a organização por `X-Integration-ID`, sem exigir UUID interno no corpo ou na query.
6. **Porta local PostgreSQL divergente.** O Compose publica `5433:5432`; `.env.example`, README e guia de testes agora usam `127.0.0.1:5433`. A porta interna `postgres:5432` dos containers foi preservada.
7. **Escopos de integração divergiam entre aplicação e banco.** A migration aditiva `20261121140000_expand_partner_api_key_scopes` recria as constraints `parceiros_escopos_check` e `api_keys_escopos_check` para aceitar exatamente os seis valores de `INTEGRATION_SCOPES`, sem editar migrations anteriores. Foram ampliados os testes unitários e de integração para cadastro/atualização de parceiros e API Keys com todos os seis escopos.
8. **Documentação desatualizada.** Foram atualizados overview, requisitos, arquitetura, modelo de dados, plano, ADRs, histórias, README e relatório técnico para refletir que analytics, API pública e workers já existem no código, sem declarar homologação.

## Arquivos criados

- `prisma/migrations/20261121120000_useful_life_backtesting/migration.sql`
- `prisma/migrations/20261121130000_recovery_estimation_snapshot/migration.sql`
- `src/modules/analytics/backtesting.service.ts`
- `src/modules/analytics/public-analytics.dto.ts`
- `docs/relatorio-alteracoes-revisao.md`
- `docs/relatorio-testes-revisao.md`
- `docs/homologacao-revisao.md`

## Arquivos modificados

- `prisma/schema.prisma`
- `src/modules/analytics/analytics.repository.ts`
- `src/modules/analytics/operational-efficiency.service.ts`
- `src/modules/analytics/profitability.service.ts`
- `src/modules/analytics/useful-life.service.ts`
- `src/modules/analytics/analytics.controller.ts`
- `src/modules/analytics/routes.ts`
- `src/modules/historico-equipamentos/historico.service.ts`
- `src/modules/relatorios-async/report-format.ts`
- `src/modules/relatorios-async/relatorios-async.service.ts`
- `src/modules/relatorios-async/relatorios-async.controller.ts`
- `src/modules/relatorios-async/routes.ts`
- `src/tests/av3-analytics.test.ts`
- `src/tests/integracoes.test.ts`
- `src/tests/integration/public-api.integration.test.ts`
- `src/tests/av3-reports.test.ts`
- `.env.example`
- `README.md`
- `docs/GreenCode-AV3.md`
- `docs/adr/README.md`
- `docs/adr/0006-processamento-assincrono.md`
- `docs/arquitetura-av3.md`
- `docs/epicos-e-user-stories-av3.md`
- `docs/estrutura-de-pastas-av3.md`
- `docs/modelo-de-dados-av3.md`
- `docs/plano-de-implementacao-av3.md`
- `docs/requisitos-av3.md`
- `docs/relatorio-tecnico-av3.md`
- `docs/guia-de-testes-professor.md`

## Arquivos removidos

Nenhum arquivo do projeto foi removido.

## Migrations

- `20261121120000_useful_life_backtesting`: adiciona `BACKTESTING_VIDA_UTIL` ao enum `TipoAnalise`.
- `20261121130000_recovery_estimation_snapshot`: adiciona colunas opcionais de snapshot à tabela `avaliacoes_recuperacao` e FK opcional para `referencias_recuperacao`.
- `20261121140000_expand_partner_api_key_scopes`: substitui as duas CHECK constraints por versões que aceitam os seis escopos da aplicação. Nenhuma migration anterior foi modificada.

As migrations AV2-base não foram alteradas. O conteúdo das três migrations iniciais AV2/AV3 foi comparado após normalização de CRLF/LF e é equivalente. Nesta segunda rodada, as nove migrations SQL já existentes no ZIP revisado foram comparadas byte a byte com a cópia de trabalho; nenhuma foi alterada ou removida.

## Dependências

Nenhuma dependência foi adicionada, removida ou atualizada. `package.json` e `package-lock.json` foram preservados. A instalação npm não concluiu neste ambiente; não foi gerado lockfile parcial.

## Decisões e riscos remanescentes

- O backtesting considera como resultado real a primeira transição auditada posterior para `INSERVIVEL`. Ausência de evento não comprova vida útil: pode representar censura ou ausência de registro.
- A previsão OLS continua sendo estimativa heurística, não probabilidade calibrada.
- Os dados legados de avaliação de recuperação que não possuem snapshot são marcados como históricos sem proveniência original completa.
- Alguns módulos novos ainda acessam Prisma diretamente e usam `any`; refatoração ampla foi evitada para não introduzir risco sem typecheck e testes de integração.
- A documentação Swagger ainda precisa de uma revisão endpoint a endpoint com a aplicação executando e contrato gerado.
- A homologação real de migrations, seed, PostgreSQL, Redis, worker e Windows/Ubuntu permanece pendente.
