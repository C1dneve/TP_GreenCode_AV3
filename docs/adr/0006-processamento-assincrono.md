# ADR-0006 — Processamento assíncrono com BullMQ e Redis

## Status

Implementado no código AV3; homologação integrada com Redis/PostgreSQL pendente.

## Contexto

Análises agendadas e relatórios podem ser demorados e não devem manter uma requisição HTTP aberta durante todo o processamento. O sistema registra a solicitação, processa em segundo plano e permite consulta de status e resultado.

## Decisão adotada

Utilizar BullMQ com Redis e processo worker separado, mantendo API e worker no mesmo repositório e no monólito modular. PostgreSQL é a fonte definitiva do estado de negócio e dos resultados; Redis coordena entrega e agendamento, mas não substitui o histórico oficial.

## Consistência de publicação

A API grava `RelatorioAssincrono` e `OutboxEvento` na mesma transação PostgreSQL. O worker publica eventos pendentes com `jobId` estável e marca a Outbox somente após a aceitação do job. A publicação repetida utiliza identificador estável; o processamento também utiliza estado condicional e lease para evitar que workers antigos sobrescrevam resultados de uma execução retomada.

## Retry, lease e recuperação

Relatórios utilizam cinco tentativas e backoff exponencial com atraso inicial de três segundos. A fila de análises utiliza cinco tentativas e atraso inicial de cinco segundos. O serviço de relatório registra heartbeat e lease; execuções `PROCESSING` sem heartbeat recente podem ser retomadas. O estado de falha é persistido no PostgreSQL. A classificação refinada entre falha transitória e permanente ainda pode ser evoluída para evitar tentativas desnecessárias em erros irrecuperáveis.

## Agendamento

Análises recorrentes são registradas com `upsertJobScheduler` e IDs estáveis no Redis. Intervalos são configuráveis por variáveis de ambiente; o worker separado executa os serviços analíticos e persiste snapshots no PostgreSQL.

## Validação pendente

Executar testes reais com Redis/PostgreSQL para indisponibilidade Redis, interrupção durante processamento, reentrega, recuperação de lease, concorrência, retry, falha terminal, expiração e reinicialização do worker. A implementação existente não deve ser considerada homologada até essas execuções.
