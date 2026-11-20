# ADR-0008 — Isolamento de parceiros e organizações

- **Status:** Aceito para o primeiro grande passo AV3.
- **Contexto:** um parceiro pode operar em mais de uma organização, mas somente nas organizações autorizadas explicitamente. A API pública precisa permitir submissões de lotes e consultas de rastreabilidade sem expor dados de outros parceiros.
- **Decisões aprovadas:** relacionamento N:N parceiro-organização; vínculo ativo exigido em cada operação; escopos do parceiro definem o teto das permissões; escopos da chave restringem ainda mais esse teto.
- **Autorização efetiva:** `escoposEfetivos = escoposParceiro ∩ escoposChave`. A interseção é calculada a cada requisição, para que alterações do parceiro tenham efeito imediato. O `partnerId` e a organização informados pelo cliente nunca substituem a validação no servidor.
- **Submissões:** aceitar lote-only ou lote+equipamentos conforme configuração do parceiro; executar persistência em transação única; aplicar todas as validações de domínio existentes na AV2.
- **Idempotência:** mesma `Idempotency-Key` e mesmo conteúdo normalizado retorna o resultado original; mesma chave com conteúdo divergente gera HTTP 409. Mesmo `externalId` e mesmo conteúdo, ainda que com outra chave de idempotência, reutiliza o recurso original; `externalId` com conteúdo divergente gera HTTP 409. As unicidades são por parceiro.
- **Rastreabilidade:** consultas retornam status e histórico operacional do lote e dados autorizados dos equipamentos (tipo, marca, modelo, estado físico e situação atual), sem expor CNPJ, dados pessoais, nomes de responsáveis, códigos internos ou detalhes internos desnecessários.
- **Consequências:** testes de isolamento entre parceiros, organizações e chaves; auditoria de concessão/revogação; testes de rollback, repetição idempotente e tentativas de acesso cruzado.
- **Validação técnica pendente:** formato final da referência externa usada nas rotas de rastreabilidade e mapeamento de identificadores externos para recursos AV2. Não expor IDs internos ou `codigoBarrasInterno` por conveniência.
