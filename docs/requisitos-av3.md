# Requisitos da AV3 e rastreabilidade

Este documento organiza os requisitos do enunciado, as decisões de produto aprovadas e as propostas técnicas. A classificação de origem evita confundir o que foi solicitado na atividade com escolhas adotadas para tornar a solução implementável.

- **[ENUNCIADO]** requisito expresso no PDF da AV3.
- **[DECISÃO]** regra de produto aprovada para o GreenCode AV3.
- **[PROPOSTA]** solução técnica a confirmar antes da implementação da respectiva fase.

## Requisitos funcionais e técnicos

| ID | Requisito | Origem | Evidência esperada |
|---|---|---|---|
| ANA-01 | Calcular o tempo médio entre entrada do lote e conclusão da triagem | [ENUNCIADO] | Agregação baseada em timestamps persistidos |
| ANA-02 | Comparar gargalos e variações por operador e período | [ENUNCIADO] | Testes de filtros e agrupamentos |
| ANA-03 | Estimar recuperação por tipo de equipamento considerando estado, marca e modelo | [ENUNCIADO] | Relatório com metodologia e amostra |
| ANA-04 | Prever vida útil remanescente com histórico de depreciação e falhas | [ENUNCIADO] | Testes numéricos e cenário sem histórico suficiente |
| ANA-05 | Persistir previsões para consulta histórica e comparação com resultados posteriores | [ENUNCIADO] | Consulta de resultados anteriores e comparação |
| ANA-06 | Registrar método, amostra, qualidade e motivo de indisponibilidade | [DECISÃO] | Contrato de resposta e testes de dados insuficientes |
| API-01 | Disponibilizar API pública autenticada por API Keys | [ENUNCIADO] | Testes de autenticação válida e inválida |
| API-02 | Limitar requisições por cliente/parceiro | [ENUNCIADO] | Testes de limite e resposta `429` |
| API-03 | Associar permissões específicas a parceiros e chaves | [ENUNCIADO]/[DECISÃO] | Testes de escopos efetivos e negação |
| API-04 | Separar rotas públicas das internas e utilizar versionamento explícito | [ENUNCIADO] | Inspeção de rotas e testes de isolamento |
| API-05 | Documentar API com exemplos, erros e parâmetros | [ENUNCIADO] | Swagger/OpenAPI atualizado |
| API-06 | Permitir consulta pública de rastreabilidade | [ENUNCIADO] | Consulta autorizada e tentativa não autorizada |
| API-07 | Permitir submissão pública de novos lotes | [ENUNCIADO] | Submissão lote-only e lote com equipamentos |
| API-08 | Permitir solicitação/recebimento de relatórios analíticos por integração | [ENUNCIADO] | Solicitação, status e resultado na fase assíncrona |
| API-09 | Minimizar dados expostos na rastreabilidade pública | [DECISÃO] | Teste de contrato sem dados internos/pessoais |
| PAR-01 | Disponibilizar CRUD administrativo de parceiros | [DECISÃO] | Testes de JWT/RBAC e regras de estado |
| PAR-02 | Associar e revogar organizações autorizadas por parceiro | [DECISÃO] | Testes de vínculo e isolamento |
| PAR-03 | Emitir múltiplas API Keys, armazenar hash e permitir revogação individual | [DECISÃO] | Testes de ciclo de vida e segredo exibido uma vez |
| PAR-04 | Configurar limites por parceiro e, opcionalmente, limites mais restritivos por chave | [DECISÃO] | Testes de configuração e aplicação de limites |
| PAR-05 | Calcular permissões efetivas pela interseção parceiro/chave | [DECISÃO] | Testes de permissão concedida e negada |
| INT-01 | Submeter lote sem equipamentos ou lote com equipamentos em uma única transação | [DECISÃO] | Testes de sucesso e rollback |
| INT-02 | Evitar duplicidade por `Idempotency-Key` e `externalId`, por parceiro | [DECISÃO] | Testes de repetição, concorrência e conflito |
| INT-03 | Restringir consulta e escrita às organizações autorizadas e aos escopos efetivos | [DECISÃO] | Testes de isolamento entre parceiros/organizações/chaves |
| JOB-01 | Enfileirar análises e relatórios demorados | [ENUNCIADO] | Teste de publicação e consumo na fase de filas |
| JOB-02 | Retornar task ID e permitir consulta de status | [ENUNCIADO]/[DECISÃO] | Testes de ciclo de vida do job |
| JOB-03 | Disponibilizar resultado após conclusão | [ENUNCIADO] | Teste de autorização e download |
| JOB-04 | Implementar retry seguro e rastreável | [ENUNCIADO] | Testes de falha transitória e reprocessamento |
| REL-01 | Manter histórico de relatórios, status, download autenticado e expiração | [DECISÃO] | Testes de acesso e expiração |
| REL-02 | Definir expiração configurável e regeneração de relatório expirado | [DECISÃO] | Testes de expiração/regeneração |
| AUD-01 | Auditar operações administrativas e externas relevantes | [DECISÃO] | Eventos com ator, parceiro, chave, organização, ação, resultado e request ID quando aplicável |
| OPS-01 | Disponibilizar indicadores diários, previsões semanais e execução manual | [DECISÃO] | Jobs recorrentes e execução administrativa |
| TECH-01 | Justificar biblioteca estatística, persistência, retry e escalabilidade no relatório técnico | [ENUNCIADO] | `relatorio-tecnico-av3.md` atualizado com decisões efetivas |
| COMP-01 | Compatibilidade com Windows 10+ e Ubuntu 24.04.03+ e derivados | [ENUNCIADO] | Guia reproduzível e evidências por plataforma |

## Estado do primeiro grande passo

A tabela abaixo distingue código implementado de validação executada. Uma funcionalidade não deve ser marcada como validada somente porque seus arquivos foram escritos.

| Requisito | Situação no código recebido | Estado da validação |
|---|---|---|
| PAR-01 a PAR-05 | Implementados no primeiro incremento | Pendente de build e testes HTTP/PostgreSQL completos |
| API-01 a API-07 | Implementados para o escopo inicial de lote e rastreabilidade | Pendente de execução da suíte completa |
| INT-01 a INT-03 | Implementados com transação serializável, tabelas separadas e constraints | Pendente de validação de rollback e concorrência no PostgreSQL |
| AUD-01 | Implementado para operações administrativas e externas descritas no relatório | Persistência não homologada em banco neste ambiente |
| ANA-01 a ANA-06 | Fase analítica futura | Não implementados |
| API-08, JOB-01 a JOB-04, REL-01/02 e OPS-01 | Fases de analytics, filas e relatórios | Não implementados |
| TECH-01 | Relatório técnico criado | Conteúdo atualizado; decisões futuras permanecem pendentes |
| COMP-01 | Instruções de execução para Windows e Ubuntu documentadas | Compatibilidade deve ser testada em cada ambiente |

## Evidências e critérios de conclusão

- A validação funcional manual deve seguir o [Guia de execução e testes](guia-de-testes-professor.md).
- A suíte unitária/HTTP deve ser executada por `npm test` ou pelo comando Docker Compose documentado.
- A suíte PostgreSQL deve ser executada por `npm run test:integration` em banco dedicado cujo nome contenha `test`.
- Migrations, constraints, transações, idempotência e isolamento precisam de execução real em PostgreSQL.
- Build, geração/validação Prisma e testes devem ser registrados com o resultado efetivo do terminal.
- Código escrito sem execução é registrado como implementado, mas não validado.

## Limitações conhecidas na revisão documental

A revisão do código recebido identificou que a operação de submissão grava `SUBMISSAO_PUBLICA_LOTE`, mas a lista de ações consultadas para compor `historicoOperacional` ainda não inclui esse evento. Até a correção e novo teste, a presença da submissão inicial no histórico público deve ser tratada como pendente. Também está registrada no relatório técnico a divergência de persistência direta via Prisma nos services novos em relação ao padrão Repository dos módulos operacionais.
