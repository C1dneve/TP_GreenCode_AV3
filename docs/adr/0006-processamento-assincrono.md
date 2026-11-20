# ADR-0006 — Processamento assíncrono com BullMQ e Redis

- **Status:** Proposto para AV3; validar na fase de filas.
- **Contexto:** análises e relatórios podem ser demorados e não devem bloquear requisições HTTP.
- **Decisão proposta:** usar BullMQ com Redis e um processo worker separado no mesmo repositório/monólito modular. Persistir estado e resultados de negócio no PostgreSQL; Redis é infraestrutura de fila, não a fonte definitiva do histórico.
- **Consequências:** adicionar serviço Redis e worker ao Compose, task ID, polling, retry e observabilidade.
- **Consistência de publicação:** evitar que uma execução fique registrada no PostgreSQL sem que seu job seja publicado no Redis. Avaliar Transactional Outbox ou mecanismo equivalente de reconciliação/republicação; registrar a decisão final e testar falhas entre persistência e publicação.
- **Retry proposto:** repetir somente falhas transitórias, com backoff exponencial e limite; erros de validação não são repetidos. Definir DLQ ou estado de falha terminal.
- **Validação necessária:** reinício do worker, recuperação de jobs não publicados, reprocessamento idempotente, retry, falha terminal e concorrência por parceiro.
