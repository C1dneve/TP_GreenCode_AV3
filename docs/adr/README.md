# Architecture Decision Records — GreenCode AV3

Este diretório registra decisões arquiteturais específicas da evolução AV3. O índice lista apenas os ADRs presentes neste repositório; números existentes não são renumerados e não pressupõe documentos históricos que não estejam aqui.

- [ADR-0005 — API pública e autenticação por API Key](0005-api-publica-api-keys.md) — decisão adotada no primeiro incremento; validação automatizada completa ainda pendente.
- [ADR-0006 — Processamento assíncrono com BullMQ e Redis](0006-processamento-assincrono.md) — proposta para fase futura; ainda não implementada.
- [ADR-0008 — Isolamento de parceiros e organizações](0008-isolamento-parceiros.md) — decisão adotada no primeiro incremento; validação PostgreSQL completa ainda pendente.

## Como ler os ADRs

Cada registro apresenta o contexto, a decisão ou proposta, suas consequências e as validações necessárias. Um ADR com status aceito/implementado não significa que todos os testes de integração foram executados; consulte o [relatório técnico](../relatorio-tecnico-av3.md) para distinguir implementação de validação.
