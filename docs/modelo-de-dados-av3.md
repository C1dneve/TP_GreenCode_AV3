# Modelo de dados — GreenCode AV3

Este documento descreve as entidades utilizadas na primeira etapa da AV3 e as relações planejadas para as próximas fases. O schema executável é `prisma/schema.prisma`; as alterações de banco são registradas em migrations versionadas. A migration AV3 foi adicionada ao histórico, sem editar as migrations anteriores.

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

A unicidade das referências é contextual ao parceiro. As tabelas de idempotência e de referência externa são separadas para permitir que várias `Idempotency-Key` apontem para o mesmo lote quando a mesma referência externa e o mesmo conteúdo forem reenviados.

## 3. Relações principais

```text
Parceiro 1 ─── N ApiKey
    │
    └──── N ParceiroOrganizacao N ─── 1 Organizacao
                    │
                    └──── autoriza operações sobre Lotes
                                      │
                                      └──── 1 Lote N ─── 1 Equipamento(s)

Parceiro 1 ─── N RequisicaoIdempotencia ─── 1 Lote
Parceiro 1 ─── N ReferenciaExternaParceiro ─ 1 Lote

EventoAuditoria ─── atorUsuarioId (opcional)
       │
       ├──── parceiroId (opcional)
       ├──── apiKeyId (opcional)
       └──── organizacaoId (opcional)
```

## 4. Auditoria ampliada

`EventoAuditoria` preserva os campos usados pelo fluxo interno, como `atorUsuarioId`, `atorNomeSnapshot`, `acao`, `entidade`, `entidadeId`, `instante`, `resultado`, `requestId` e `detalhes`. A AV3 acrescenta `atorTipo`, `parceiroId`, `apiKeyId` e `organizacaoId` opcionais.

Os eventos administrativos identificam o usuário interno. As operações autenticadas por API Key identificam parceiro e chave; quando uma organização é afetada, registram também a organização. Os eventos antigos recebem valor compatível para o tipo de ator, sem serem apagados.

## 5. Regras de integridade

- Um parceiro somente opera em organização com associação ativa e organização ativa.
- O autenticador verifica parceiro ativo, chave não revogada, validade e escopos em cada requisição.
- `escoposEfetivos = escoposParceiro ∩ escoposApiKey`.
- Constraints únicas protegem as referências externas e chaves de idempotência por parceiro.
- A submissão grava lote, equipamentos, referência externa, idempotência e auditoria na mesma transação serializável.
- Se uma escrita falhar, a transação deve ser revertida integralmente.
- Parceiros, chaves e associações são desativados/revogados logicamente; seus registros históricos são preservados.

## 6. Dados expostos pela rastreabilidade

A resposta pública apresenta identificador GreenCode, status e datas do lote, quantidade de equipamentos, histórico operacional permitido e dados autorizados dos equipamentos: tipo, marca, modelo, estado físico, situação atual e movimentações relevantes.

Não são expostos CNPJ, dados pessoais, nomes de usuários/responsáveis, UUIDs internos, códigos de barras internos, segredos, hashes, tokens ou referências externas pertencentes a outros parceiros.

**Ponto de revisão:** o código atual grava o evento `SUBMISSAO_PUBLICA_LOTE`, mas a lista de ações consultadas para montar `historicoOperacional` ainda não o inclui. A submissão inicial deve ser considerada pendente de aparecer no histórico público até a correção desse filtro e a execução de um teste de integração correspondente.

## 7. Conceitos reservados às fases futuras

Não há tabelas/endpoints implementados neste incremento para amostras de recuperação, histórico estruturado de falhas/depreciação, execuções analíticas, resultados preditivos, artefatos de relatórios, jobs ou retry de filas. Esses modelos serão definidos quando as regras de negócio, fontes de dados e casos de uso forem fechados.
