# Modelo de dados — GreenCode AV3

Este documento descreve as entidades presentes no schema AV3 e as relações adicionadas à base operacional da AV2. O schema executável é `prisma/schema.prisma`; cada evolução do banco é registrada em migration versionada, sem reescrever migrations já existentes.

## 1. Entidades operacionais mantidas

Os modelos `Usuario`, `Organizacao`, `Contrato`, `Lote`, `Equipamento`, `Movimentacao`, `EventoAuditoria`, `ParametroGlobal` e demais estruturas operacionais existentes continuam sendo a base do sistema.

O modelo `Lote` recebeu `publicId` único, com geração no PostgreSQL e prefixo `gcl_`, permitindo que lotes criados internamente também tenham uma referência pública que não seja seu UUID interno. O campo `Equipamento.codigoBarrasInterno` continua reservado ao fluxo interno e não é exposto nas respostas públicas.

## 2. Entidades de integração

| Modelo Prisma | Finalidade | Integridade principal |
|---|---|---|
| `Parceiro` | Cadastro, estado ativo, escopos máximos e limites padrão | Ativação lógica; escopos e limites validados |
| `ParceiroOrganizacao` | Associação N:N entre parceiro e organização | Unicidade do par; identificador público `gci_...`; revogação lógica |
| `ApiKey` | Chave nomeada por parceiro, com prefixo, hash, escopos, limites, validade e revogação | Prefixo único; segredo não persistido em claro |
| `RequisicaoIdempotencia` | Relaciona `Idempotency-Key` e hash do conteúdo ao lote | Unique `(parceiroId, chave)` |
| `ReferenciaExternaParceiro` | Relaciona `externalId` ao lote e ao hash do conteúdo | Unique `(parceiroId, externalId)` e `(parceiroId, loteId)` |

## 3. Entidades analíticas e assíncronas

| Modelo Prisma | Finalidade | Observação |
|---|---|---|
| `HistoricoTriagem` | Sessões, etapas, responsáveis, timestamps e origem mensurável/legada | Permite calcular ciclo total e tempo efetivo sem inferir duração |
| `FalhaEquipamento` / `ManutencaoEquipamento` | Eventos técnicos de falha e manutenção | Alimentam contexto da previsão de vida útil |
| `HistoricoDepreciacao` | Série histórica de valor estimado por idade/tempo | Base do modelo OLS |
| `ReferenciaRecuperacao` | Preço por kg, percentual recuperável, condição e vigência | Referências podem ser reais ou demonstrativas |
| `AvaliacaoRecuperacao` | Estimativa e valor realizado | Preserva snapshot do preço/kg, percentual, fonte, metodologia e ID da referência usada |
| `ExecucaoAnalise` | Histórico de análises e backtesting | Guarda método, versão, filtros, resultado, observações e qualidade |
| `RelatorioAssincrono` | Estado de tarefas e metadados de arquivos | Inclui parceiro, organização, status, lease, checksum e expiração |
| `OutboxEvento` | Publicação confiável de jobs | PostgreSQL permanece fonte de verdade |
| `RateLimitBucket` | Contador de rate limit por parceiro/chave/janela | Atualização atômica compartilhada entre instâncias |

O enum `TipoAnalise` inclui as três categorias principais e `BACKTESTING_VIDA_UTIL`. O backtesting consulta snapshots de previsões anteriores e transições auditadas para `INSERVIVEL`, persistindo métricas agregadas na mesma estrutura histórica.

## 4. Relações principais

```text
Parceiro 1 ─── N ApiKey
    │
    └──── N ParceiroOrganizacao N ─── 1 Organizacao
                    │
                    └──── autoriza operações sobre Lotes
                                      │
                                      └──── 1 Lote N ─── N Equipamentos

Equipamento 1 ─── N HistoricoTriagem
Equipamento 1 ─── N FalhaEquipamento / ManutencaoEquipamento
Equipamento 1 ─── N HistoricoDepreciacao / AvaliacaoRecuperacao
ReferenciaRecuperacao 1 ─── N AvaliacaoRecuperacao (opcional)

Parceiro 1 ─── N RequisicaoIdempotencia ─── 1 Lote
Parceiro 1 ─── N ReferenciaExternaParceiro ─ 1 Lote
EventoAuditoria ─── atorUsuarioId/parceiroId/apiKeyId/organizacaoId (opcionais)
```

## 5. Auditoria e integridade

`EventoAuditoria` preserva os campos usados pelo fluxo interno e acrescenta `atorTipo`, `parceiroId`, `apiKeyId` e `organizacaoId` opcionais. Eventos de alteração de estado físico guardam os estados anterior e novo; a transição auditada para `INSERVIVEL` é a referência observável do backtesting.

- Um parceiro somente opera em organização com associação ativa e organização ativa.
- O autenticador verifica parceiro ativo, chave não revogada, validade e escopos em cada requisição.
- `escoposEfetivos = escoposParceiro ∩ escoposApiKey`.
- Constraints únicas protegem referências externas e chaves de idempotência por parceiro.
- Submissão grava lote, equipamentos, referência externa, idempotência e auditoria na mesma transação.
- Avaliações de recuperação guardam snapshot de sua referência, preservando explicabilidade mesmo quando referências vigentes mudam.
- Parceiros, chaves e associações são desativados/revogados logicamente; registros históricos são preservados.

## 6. Minimização dos dados públicos

A rastreabilidade apresenta identificador GreenCode, status e datas do lote, quantidade de equipamentos, histórico operacional permitido e dados autorizados dos equipamentos. Analytics e relatórios públicos usam DTOs/projeções próprias.

Não são expostos CNPJ, dados pessoais, nomes de usuários/responsáveis, UUIDs técnicos de equipamentos/lotes, códigos de barras internos, segredos, hashes, tokens ou IDs internos de referência financeira.

## 7. Migrations

As três migrations iniciais AV2 permanecem com conteúdo equivalente na AV3. As evoluções AV3 são aditivas e incluem, entre outras, as tabelas de integração, histórico analítico, Outbox e rate limit. As migrations `20261121120000_useful_life_backtesting` e `20261121130000_recovery_estimation_snapshot` acrescentam, respectivamente, o tipo de análise de backtesting e os campos de snapshot da avaliação financeira.

A aplicação dessas migrations ainda precisa ser validada em banco descartável limpo e em banco reconstruído a partir das migrations/seeds da AV2.
