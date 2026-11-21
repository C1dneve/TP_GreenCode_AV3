# ADR-0005 — API pública e autenticação por API Key

**Status:** aceito e implementado no código. A validação integrada com PostgreSQL real não foi executada nesta sessão.

O conteúdo canônico, incluindo a correção do rate limiter inicialmente descrito como em memória, está consolidado em [Decisões arquiteturais — GreenCode AV3](../decisoes-arquiteturais.md#adr-0005--api-publica-e-autenticação-por-api-key).

A solução efetivamente injetada pelos módulos é `PrismaRateLimiter`: janela fixa de 60 segundos, buckets separados `partner:{id}` e `key:{id}`, incremento atômico PostgreSQL por `INSERT ... ON CONFLICT`, compartilhamento entre réplicas e resposta HTTP `429` com `Retry-After`. `InMemoryRateLimiter` permanece apenas para testes unitários isolados. A abordagem e o histórico da decisão inicial estão detalhados no documento consolidado.
