# ADR-0008 — Isolamento de parceiros e organizações

## Status

Aceito e implementado no primeiro grande passo. Validação de integração PostgreSQL e revisão de rastreabilidade ainda pendentes.

## Contexto

Um parceiro pode atuar em várias organizações somente quando houver autorização explícita. A API pública não pode expor dados de outros parceiros, identificadores internos ou informações pessoais desnecessárias.

## Decisão

- `ParceiroOrganizacao` representa a associação N:N e mantém identificador público opaco `gci_...`.
- O cliente envia o identificador em `X-Integration-ID`, não ID interno nem CNPJ.
- A revogação do vínculo é lógica e bloqueia novas operações; uma nova autorização gera identificador público novo.
- Cada lote possui `publicId` GreenCode `gcl_...`, inclusive quando criado internamente.
- `externalId` é resolvido no contexto do parceiro autenticado.
- Escopos efetivos são a interseção dos escopos do parceiro com os da chave.
- Parceiro, chave, associação e organização ativa são verificados no servidor.
- A resposta pública inclui dados operacionais do lote e dados autorizados de equipamento/movimentação, omitindo CNPJ, dados pessoais, nomes internos, IDs do banco e códigos de barras internos.

## Submissão e idempotência

Lote-only e lote com equipamentos são permitidos conforme a política do parceiro. A submissão reutiliza validações de domínio e persiste lote, equipamentos, referência externa, idempotência e auditoria na mesma transação serializável. Não executa triagem ou movimentações.

`RequisicaoIdempotencia` e `ReferenciaExternaParceiro` são tabelas separadas, com constraints únicas por parceiro. Mesmo conteúdo e referência reutilizam o recurso original; conteúdo divergente retorna `409`.

## Consequências

Migrations novas acrescentam modelos e referências públicas sem reescrever migrations antigas. Testes devem cobrir isolamento entre parceiros, chaves e organizações, idempotência, transação e ausência de vazamento de dados.

## Validação necessária

Executar cenários de concorrência e rollback em PostgreSQL. Corrigir também a lista de ações usada pelo `historicoOperacional` para que a submissão inicial seja apresentada quando consultada. O estado das verificações está no relatório técnico.
