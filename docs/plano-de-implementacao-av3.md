# Plano de implementação — GreenCode AV3

## Estratégia

Implementar em grandes incrementos verificáveis sobre a AV2, mantendo o sistema funcional. Criar o repositório AV3 como cópia derivada da AV2 aprovada; não modificar a história da AV2. Cada incremento segue o ciclo: implementação ampla, revisão, validação, correções e aprovação antes do próximo incremento.

## Fase 0 — Preparação do repositório

- Criar novo repositório GitHub AV3.
- Copiar a base AV2 aprovada para o novo repositório.
- Preservar estrutura, CI, testes, migrations, ADRs e documentação existente.
- Atualizar nome, versão, README, documentação e metadados do projeto na cópia AV3.
- Confirmar branch, status Git, `npm ci`, build, testes e CI antes de começar features.
- Aplicar o pacote de documentação AV3 revisado.

**Saída:** repositório AV3 inicial idêntico funcionalmente à AV2, com documentação de evolução.

## Fase 1 — Descoberta de dados e desenho

- Inspecionar serviços e migrations AV2 para identificar timestamps reais de triagem.
- Mapear origem e qualidade de dados para recuperação, depreciação e falhas.
- Fechar modelo de parceiro, organizações, API Keys, escopos e limites.
- Definir contratos HTTP, referências externas e códigos de erro.
- Fechar as regras de idempotência e a extensão da auditoria existente.
- Elaborar/atualizar ADRs antes de decisões irreversíveis.

**Saída:** modelo de dados detalhado, contratos e critérios de aceite aprovados.

## Primeiro grande passo aprovado — Fundação e API pública inicial

Este incremento reúne a fundação de parceiros e o primeiro conjunto de operações públicas. Deve ser implementado como uma entrega funcional coesa, sem avançar ainda para analytics ou filas.

### Escopo obrigatório

1. **Parceiros:** CRUD administrativo, ativação/desativação e auditoria.
2. **Organizações:** associação e remoção de organizações autorizadas por parceiro.
3. **API Keys:** criação de múltiplas chaves, identificador/prefixo, segredo exibido uma única vez, hash, validade e revogação individual.
4. **Autorização:** escopos máximos por parceiro; escopos por chave; permissão efetiva calculada pela interseção; autorização por organização.
5. **Limites:** rate limiting por chave/parceiro e limites de payload/submissão configurados.
6. **Submissão pública:** receber lote-only e lote+equipamentos, aplicar as regras de domínio AV2 e persistir tudo atomicamente.
7. **Idempotência:** tratar `Idempotency-Key` e `externalId` conforme as regras deste pacote, com conflitos HTTP 409 e sem duplicação.
8. **Rastreabilidade pública:** consultar lotes e equipamentos das organizações autorizadas, retornando dados operacionais e campos aprovados de equipamento, sem expor dados pessoais/internos.
9. **Auditoria:** ampliar `EventoAuditoria` para atores internos, parceiros, chaves e organizações, sem apagar nem quebrar eventos antigos.
10. **Documentação e testes:** atualizar Swagger/OpenAPI, criar testes unitários/HTTP/integração e atualizar guia/documentos afetados.

### Fora deste incremento

- Indicadores analíticos e modelos preditivos.
- Redis, BullMQ, workers e scheduler.
- Relatórios assíncronos, armazenamento de artefatos, expiração e regeneração.
- Webhooks.

### Condições de aprovação

- Migrations aplicam em banco limpo e preservam os dados/esquemas AV2 existentes.
- Build, lint (se configurado), testes AV2 e testes novos são executados; resultados e limitações ficam explícitos.
- Testes PostgreSQL cobrem transação, constraints, isolamento e idempotência.
- Testes HTTP cobrem autenticação, escopos, rate limit, CRUD administrativo, submissão e rastreabilidade.
- Nenhuma rota pública permite alcançar operações internas/admin.
- Nenhum segredo é persistido em claro ou incluído em logs/auditoria/respostas posteriores.
- Se um problema AV2 não bloquear diretamente o incremento, documentar; não fazer correção incidental fora do escopo.
- Entregar somente os arquivos alterados/adicionados no ZIP de implementação, mantendo caminhos relativos ao repositório AV3, acompanhado de resumo dos testes e limitações.

## Fase 2 — Dados analíticos

- Instrumentar eventos de início/fim da triagem se os dados existentes forem insuficientes.
- Definir modelo de dados de recuperação estimada e realizada.
- Persistir observações históricas de falhas/depreciação necessárias.
- Implementar métricas operacionais.
- Implementar estimativa de recuperação.
- Implementar previsão de vida útil com limiar mínimo de amostra e indisponibilidade explícita.
- Persistir versões, métodos, amostras e dataset de cada cálculo.

**Saída:** indicadores e previsões calculados, persistidos e consultáveis, com testes numéricos.

## Fase 3 — Filas e worker

- Adicionar Redis e BullMQ.
- Criar processo worker e container próprio.
- Persistir execução/job no PostgreSQL.
- Definir mecanismo de reconciliação/publicação de jobs (Transactional Outbox ou equivalente) para evitar execução persistida sem mensagem publicada.
- Implementar retry, backoff, idempotência e tratamento de falhas definitivas.
- Criar polling de status.
- Adicionar jobs diários e semanais e execução manual.
- Testar recuperação após reinício e reprocessamento.

**Saída:** processamento assíncrono resiliente e demonstrável.

## Fase 4 — Relatórios

- Enfileirar geração de relatórios CSV/JSON (outros formatos somente se aprovados).
- Implementar histórico, status, solicitante, criação e expiração.
- Proteger download por autenticação/autorização.
- Implementar expiração configurável (default 7 dias) e regeneração.
- Testar acesso indevido, expiração e reprocessamento.

**Saída:** ciclo completo de solicitação, execução, consulta e download.

## Fase 5 — Endurecimento e entrega

- Revisar auditoria, rate limit, isolamento e vazamento de segredos.
- Testar API, worker, Redis e Postgres em Docker Compose.
- Testar em Windows 10+ e Ubuntu 24.04.03+ ou registrar limitações reais.
- Executar suíte completa e CI.
- Completar relatório técnico com decisões efetivamente adotadas e evidências.
- Atualizar guia de instalação, testes e operação.

**Saída:** pacote final AV3 validado e documentado.

## Ordem de prioridade

Primeiro, concluir e aprovar a fundação/API pública inicial. Depois garantir qualidade dos dados e implementar analytics; em seguida, filas/workers e relatórios; por fim, endurecimento e documentação final. Evitar implementar predições antes de garantir que os dados de entrada existem e são confiáveis.
