# Plano de implementação — GreenCode AV3

## Estratégia de desenvolvimento

A AV3 é implementada em grandes incrementos verificáveis. Cada incremento segue o ciclo combinado: implementação ampla, revisão independente, validação, correções e aprovação antes de iniciar o próximo passo. A documentação descreve o comportamento real; código ainda não executado é registrado como implementado, mas não validado.

## Fase 0 — Preparação do repositório

- Criar repositório próprio para AV3 a partir da base aprovada.
- Manter a história e o repositório da AV2 separados.
- Atualizar nome, README, documentação AV3 e metadados do produto na nova cópia.
- Preservar stack, dependências existentes, estrutura modular e migrations anteriores.
- Conferir instalação, build, testes e CI antes de ampliar o sistema.

**Saída:** repositório AV3 identificável, com documentação própria e base operacional preservada.

## Fase 1 — Descoberta de dados e desenho

- Identificar timestamps confiáveis para eficiência operacional e conclusão de triagem.
- Mapear a origem e a qualidade dos dados para recuperação, depreciação e falhas.
- Definir parceiro, organizações autorizadas, API Keys, escopos e limites.
- Definir referências públicas, contratos HTTP, códigos de erro e idempotência.
- Ampliar a auditoria existente sem apagar eventos anteriores.
- Atualizar ADRs antes de decisões irreversíveis.

**Saída:** modelo de dados e contratos de integração aprovados.

## Fase 2 — Fundação e API pública inicial (primeiro grande passo)

Este incremento concentra as funcionalidades necessárias para que um sistema parceiro seja cadastrado, autorizado e consiga integrar-se ao GreenCode.

### Escopo

1. Gestão administrativa de parceiros por JWT e RBAC.
2. Associação/revogação de organizações com identificador público de integração.
3. Criação, consulta, atualização e revogação individual de API Keys.
4. Autorização por escopos efetivos, calculados pela interseção parceiro/chave.
5. Rate limiting e limites de payload/equipamentos por parceiro e chave.
6. Submissão pública de lote-only e lote com equipamentos.
7. Idempotência por `Idempotency-Key` e `externalId`, contextualizada por parceiro.
8. Consulta de rastreabilidade por identificador GreenCode ou referência externa.
9. Extensão de auditoria para atores internos e externos.
10. OpenAPI, documentação de execução e testes.

### Fora deste incremento

- Analytics e modelos preditivos.
- Redis, BullMQ, workers e scheduler.
- Relatórios assíncronos, artefatos, download, expiração e regeneração.
- Webhooks.

### Condições de aprovação

- Migrations aplicam em banco limpo e em banco que já contém o histórico anterior.
- Build, validação Prisma, testes unitários/HTTP e testes PostgreSQL são executados.
- Testes cobrem transação, rollback, constraints, isolamento, idempotência e concorrência.
- Rotas públicas não alcançam operações internas/administrativas.
- Nenhum segredo aparece em resposta posterior, log ou auditoria.
- Limitações de execução ficam registradas; testes não executados não são declarados aprovados.

### Registro desta entrega — 20/11/2026

O código recebido contém módulos `parceiros`, `integracoes` e `api-publica`, uma migration AV3, escopos iniciais, rate limiting local, submissão de lotes, idempotência, consulta de rastreabilidade, auditoria ampliada e OpenAPI.

O registro da execução informa transpilation sintática de 22 arquivos TypeScript sem diagnósticos, cinco testes unitários focados aprovados e `git diff --check` aprovado. Não foi possível executar `npm ci` por falha DNS (`EAI_AGAIN`); o ambiente utilizado possuía Node 22.16.0, enquanto o projeto exige Node 24. Não foram executados build oficial, validação Prisma, migration PostgreSQL ou testes HTTP/integração completos. **O incremento permanece não aprovado até essas validações e as correções registradas no relatório técnico.**

## Fase 3 — Dados e indicadores analíticos

- Instrumentar eventos de início/fim de triagem se os registros existentes forem insuficientes.
- Definir modelo de recuperação estimada e valor realizado.
- Registrar observações históricas necessárias para falhas e depreciação.
- Calcular eficiência por período e operador.
- Estimar recuperação por tipo, estado, marca e modelo.
- Prever vida útil com método e amostra mínimos; informar indisponibilidade quando os dados forem insuficientes.
- Persistir método, versão, amostra, qualidade, data e referência dos dados usados.

**Saída:** indicadores e previsões persistidos, reproduzíveis e consultáveis.

## Fase 4 — Filas e workers

- Adicionar Redis e BullMQ.
- Criar processo worker separado, compartilhando o monólito modular.
- Persistir execução e estado de negócio no PostgreSQL.
- Definir Outbox ou mecanismo equivalente de reconciliação entre PostgreSQL e Redis.
- Implementar retry com backoff, idempotência e falha terminal.
- Implementar consulta de status por polling.
- Testar reinício do worker, recuperação de jobs e reprocessamento.

**Saída:** processamento assíncrono resiliente e demonstrável.

## Fase 5 — Relatórios e entrega final

- Enfileirar geração de relatórios CSV/JSON.
- Manter histórico de solicitações, estado, solicitante e datas.
- Proteger consulta e download por autenticação/autorização.
- Implementar expiração configurável e regeneração.
- Revisar auditoria, rate limit, isolamento e vazamento de segredos.
- Testar Docker Compose em Windows 10+ e Ubuntu 24.04.03+ ou registrar limitações.
- Executar suíte completa e CI.
- Atualizar relatório técnico com decisões e evidências efetivas.

**Saída:** ciclo completo de solicitação, execução, consulta e download, com documentação de homologação.

## Ordem de prioridade

Concluir e aprovar a fundação/API pública; depois garantir qualidade dos dados e analytics; em seguida implementar filas/workers e relatórios; por fim realizar endurecimento, homologação e documentação final. Não iniciar previsões antes de garantir que os dados de entrada existem e são confiáveis.
