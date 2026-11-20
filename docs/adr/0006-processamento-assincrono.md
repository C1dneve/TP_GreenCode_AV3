# ADR-0006 — Processamento assíncrono com BullMQ e Redis

## Status

Proposto para uma fase futura da AV3. Não implementado no primeiro grande passo.

## Contexto

Análises e relatórios podem ser demorados e não devem manter uma requisição HTTP aberta durante todo o processamento. O sistema precisa registrar a solicitação, processá-la em segundo plano e permitir consulta de status e resultado.

## Decisão proposta

Utilizar BullMQ com Redis e um processo worker separado, mantendo ambos no mesmo repositório e no monólito modular. O PostgreSQL será a fonte definitiva do estado de negócio e dos resultados; Redis será infraestrutura de fila, não o histórico oficial.

## Consistência de publicação

Evitar que uma execução fique registrada no PostgreSQL sem que o job correspondente seja publicado no Redis. Avaliar Transactional Outbox ou mecanismo equivalente de reconciliação/republicação. A decisão final deve ser registrada após comparação de complexidade e recuperação de falhas.

## Retry e falhas

Repetir somente falhas transitórias, com backoff exponencial e limite. Erros de validação não devem ser repetidos. Definir estado terminal, DLQ ou mecanismo equivalente para falhas não recuperáveis.

## Validação necessária

Testar reinício do worker, publicação interrompida, recuperação de jobs pendentes, reprocessamento idempotente, retry, falha terminal e concorrência por parceiro. Esta decisão não deve ser considerada aprovada antes do desenho, implementação e testes dessa fase.
