# Decisões arquiteturais — GreenCode AV3

Este documento reúne as decisões dos ADRs mantidos durante a evolução da AV3. O histórico de alternativas e as mudanças de implementação foram preservados para que o professor consiga distinguir decisão inicial, estado efetivo e pontos ainda sujeitos a validação operacional.

## ADR-0005 — API pública e autenticação por API Key

**Status:** implementado no código; validação integrada não executada nesta sessão.

### Contexto

Sistemas parceiros precisam integrar sem reutilizar a sessão JWT de usuários internos. O acesso deve ficar restrito a parceiro, API Key, escopos e associação explícita com organização, com trilha de auditoria e proteção contra abuso.

### Decisão e implementação atual

- Rotas administrativas continuam usando JWT e RBAC; gestão de parceiros e credenciais exige papel `ADMINISTRADOR`.
- Rotas externas são versionadas em `/api/v1/public` e usam `X-API-Key`.
- API Keys usam prefixo `gc_live_` e segredo aleatório gerado com `randomBytes(32)` e base64url. O valor integral é mostrado uma única vez; o banco persiste SHA-256 hexadecimal, verificado com `timingSafeEqual`.
- Escopos efetivos são a interseção dos escopos do parceiro com os da própria API Key, recalculada a cada requisição.
- O rate limiter efetivo é `PrismaRateLimiter`, injetado pelos módulos da API pública e analytics/relatórios. Ele usa janela fixa de 60.000 ms, alinhada ao início do minuto relativo ao relógio recebido (`floor(now/windowMs) * windowMs`).
- Cada consumo incrementa atomicamente `rate_limit_buckets` com `INSERT ... ON CONFLICT (chave, janelaInicio) DO UPDATE ... + 1 RETURNING quantidade`. O campo `chave` recebe identificadores distintos `partner:{id}` e `key:{id}`, portanto existe bucket por parceiro e por API Key. A chave composta `chave + janelaInicio` separa as janelas; registros expirados são limpos periodicamente (a cada 100 consumos). Como o contador está no PostgreSQL compartilhado, réplicas da API usam o mesmo estado.
- A aplicação calcula o menor limite aplicável entre parceiro e chave. Ao exceder, responde HTTP `429`, inclui `Retry-After` em segundos e headers `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset`. O próximo bucket começa na janela seguinte.

### Histórico da decisão

A decisão original considerava rate limiting em memória para reduzir dependências no estágio inicial. Essa abordagem permanece apenas como `InMemoryRateLimiter` usado por testes unitários isolados; não é a implementação injetada pelos módulos em produção. O estado do ADR foi atualizado quando o contador foi movido para PostgreSQL. A implementação compartilhada evita que cada instância tenha sua própria cota independente e dispensa Redis exclusivamente para esse recurso.

### Alternativas, vantagens e limitações

A opção em memória foi rejeitada para operação com mais de uma instância, pois os contadores divergem e reinicializações zeram as cotas. Redis pode ser uma alternativa futura se as escritas do limitador se tornarem gargalo demonstrado; não é necessária para o comportamento atual. PostgreSQL oferece atomicidade e compartilha estado com a infraestrutura já indispensável, mas cada requisição elegível adiciona uma escrita ao banco. A estratégia de janela fixa pode permitir rajadas na fronteira entre minutos e não é um algoritmo de janela deslizante. A limpeza eventual pode manter linhas expiradas até o ciclo seguinte.

### Validação

Os testes unitários incluem o algoritmo em memória e um teste determinístico da composição SQL/contadores do adaptador Prisma com cliente simulado. Isso valida contrato local e janela, mas não substitui teste concorrente contra PostgreSQL real. Integração com múltiplas instâncias e corrida real precisa de PostgreSQL de teste.

## ADR-0006 — Processamento assíncrono com BullMQ e Redis

**Status:** implementado no código; validação de falha/recuperação com Redis/PostgreSQL real não executada nesta sessão.

### Contexto e decisão

Análises e relatórios podem ultrapassar o tempo adequado de uma requisição HTTP. A API persiste a solicitação e o evento Outbox na mesma transação PostgreSQL; o worker separado publica o evento no BullMQ/Redis com identificador estável e processa fora do ciclo HTTP. PostgreSQL permanece fonte de verdade de status e resultados; Redis coordena entrega e agendamento, não substitui o histórico.

### Retry e recuperação

Relatórios utilizam cinco tentativas com backoff exponencial inicial de 3 segundos; análises, cinco tentativas com atraso inicial de 5 segundos. O serviço de relatórios usa estado condicional e heartbeat/lease: heartbeat a cada 20 segundos; uma execução `PROCESSING` sem heartbeat recente pode ser recuperada depois de 90 segundos. A Outbox marca publicação após a aceitação do job, IDs estáveis apoiam idempotência e o estado persistido evita refazer exportação concluída. Schedulers analíticos usam `upsertJobScheduler` com IDs estáveis.

### Consequências e evolução

A API pode persistir solicitação mesmo quando Redis está temporariamente indisponível; publicação permanece pendente até recuperação do worker/Redis. A fila, workers e armazenamento precisam de métricas e testes de concorrência em escala. O refinamento futuro pode classificar erros transitórios/permanentes para evitar tentativas sem utilidade. Testes de interrupção, reentrega, recuperação de lease e falha terminal exigem infraestrutura real.

## ADR-0008 — Isolamento de parceiros e organizações

**Status:** implementado no código; validação integrada completa não executada nesta sessão.

### Contexto e decisão

O parceiro só pode atuar em organizações autorizadas. `ParceiroOrganizacao` representa relação N:N, com identificador opaco `gci_...` enviado por `X-Integration-ID`; o cliente não envia UUID interno nem CNPJ para selecionar o tenant. Revogação é lógica e bloqueia novas operações; nova autorização gera identificador público novo. Lotes possuem `publicId` GreenCode `gcl_...`; `externalId` é resolvido no escopo do parceiro autenticado.

As respostas públicas usam projeções próprias e omitem IDs internos, CNPJ, dados pessoais, nomes internos e códigos de barras. Associação ativa, parceiro, chave e escopos efetivos são verificados no servidor. Submissão valida domínio e persiste lote/equipamentos/referência externa/idempotência/auditoria numa transação, sem executar triagem ou movimentação.

### Idempotência e consequências

A referência externa e a chave de idempotência têm restrições únicas por parceiro. Repetir conteúdo e referência reutiliza recurso original; conteúdo divergente retorna `409`. As migrations acrescentam modelos/índices sem alterar histórico anterior. Testes de concorrência e rollback devem continuar sendo executados em base PostgreSQL isolada.

## Princípios comuns

- Preservar monólito modular até que métricas demonstrem necessidade de separação.
- Manter PostgreSQL como estado persistente de negócio e fonte de auditoria.
- Nunca tratar exemplos simulados como integração real.
- Evoluir migrations de forma aditiva e manter compatibilidade operacional com a AV2.
