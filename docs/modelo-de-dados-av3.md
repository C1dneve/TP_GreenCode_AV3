# Modelo de dados proposto — AV3

> Documento conceitual. Não é schema Prisma nem migração pronta. Os nomes finais devem seguir convenções já usadas no projeto e ser validados contra os módulos existentes antes de criar migrations.

## 1. Preservar modelos AV2

Manter os modelos transacionais existentes (usuários, organizações, contratos, lotes, equipamentos, movimentações, parâmetros e auditoria). Estender apenas quando houver necessidade comprovada para capturar eventos e dados analíticos ausentes.

Na AV2, `EventoAuditoria` já possui `atorUsuarioId`, `atorNomeSnapshot`, `acao`, `entidade`, `entidadeId`, `instante`, `resultado`, `requestId` e `detalhes`. A AV3 deve ampliar esse modelo, sem substituir nem apagar seus relacionamentos ou registros.

## 2. Novos conceitos

| Conceito | Campos conceituais | Observações |
|---|---|---|
| Parceiro | id, nome, identificador externo, status, configuração de submissão, escopos concedidos, limites | CRUD exclusivo de Administrador GreenCode; escopos representam o teto de permissões do parceiro |
| ParceiroOrganizacao | parceiroId, organizacaoId, status, criadoEm, revogadoEm | N:N explícito; somente organizações com associação ativa podem ser acessadas |
| ChaveAPI | id, parceiroId, nome, prefixo/identificador, hash, scopes, criadaEm, expiraEm, ultimoUsoEm, revogadaEm | Nunca persistir segredo em claro; escopos da chave não podem ampliar escopos do parceiro |
| IdempotenciaAPI | parceiroId, chaveIdempotencia, requestHash, recurso/resultId, status, resposta/status original quando necessário | Registro por `Idempotency-Key`, com unicidade por parceiro + chave; diferentes chaves podem apontar para o mesmo recurso |
| ReferenciaExternaAPI | parceiroId, externalId, tipoRecurso, recursoId, requestHash, criadoEm | Mapeamento independente com unicidade por parceiro + `externalId`; permite várias chaves de idempotência apontarem para o mesmo recurso sem duplicar o `externalId` |
| EventoAuditoria (extensão) | campos AV2 preservados + tipoAtor, atorParceiroId opcional, atorChaveApiId opcional, organizacaoId opcional | Extensão do modelo existente; ator interno continua em `atorUsuarioId`; eventos externos identificam parceiro/chave; eventos de sistema podem não ter ator humano |
| EventoOperacional | loteId, tipoEvento, ocorridoEm, operadorId, metadados | Apenas eventos necessários para calcular início/fim e gargalos; reutilizar eventos AV2 quando representarem semanticamente o evento necessário |
| AmostraRecuperacao | equipamento/tipo, marca/modelo, condição, valor estimado, valor realizado, data e origem | Separar estimativa de valor efetivamente realizado |
| HistoricoFalha/ObservacaoEquipamento | equipamento/tipo, observadoEm, estado, falha/depreciação, origem | Base histórica para predição; evitar inventar dados passados |
| ExecucaoAnalitica | tipo, filtros, status, solicitadoPor, parceiroId opcional, solicitadoEm, iniciadoEm, concluidoEm, erro | Registro durável da execução |
| ResultadoAnalitico | execucaoId, tipoMetrica/previsao, periodo, dimensões, valor, unidade, método, versãoModelo, amostra, qualidade, calculadoEm, datasetRef | Resultados históricos reproduzíveis |
| ArtefatoRelatorio | execucaoId, formato, storageKey/caminho, tamanho, criadoEm, expiraEm | Download sempre autorizado |

## 3. Regras de autorização e integridade

- FKs para parceiro, organização, chave, usuário e execução, conforme aplicável.
- Índices para filtros temporais, parceiro, organização, status de job e consulta de histórico.
- Escopos efetivos da chave são a interseção entre escopos concedidos ao parceiro e escopos da chave. Reduções posteriores no parceiro devem valer imediatamente, sem depender de atualizar todas as chaves.
- A associação parceiro-organização deve estar ativa e ser consultada em cada operação pública.
- Chaves de API revogadas, expiradas ou pertencentes a parceiro inativo não autenticam.
- Unicidade de `Idempotency-Key` por parceiro na tabela `IdempotenciaAPI`.
- Unicidade de `externalId` por parceiro na tabela `ReferenciaExternaAPI`; essa referência aponta para o recurso criado e não precisa ser duplicada quando uma nova chave de idempotência é usada.
- A operação de submissão, o registro de idempotência e a criação/consulta da referência externa devem ter consistência transacional, evitando lotes/equipamentos parciais.
- Resultados analíticos devem guardar versão do método/modelo e referência dos dados utilizados.
- Não misturar valor estimado de recuperação com valor financeiro efetivamente realizado.
- Retenção/expiração do arquivo não deve apagar o registro histórico da execução.

## 4. Regras de idempotência

- O hash deve ser calculado sobre uma representação normalizada/canônica do conteúdo semântico do pedido, não sobre bytes arbitrários da requisição.
- Mesma `Idempotency-Key` e mesmo `requestHash`, para o mesmo parceiro: reutilizar o resultado original.
- Mesma `Idempotency-Key` com `requestHash` diferente: conflito HTTP `409`.
- Mesmo `externalId` e mesmo conteúdo normalizado, ainda que com outra `Idempotency-Key`: reutilizar o recurso original, criar o registro da nova chave de idempotência apontando para esse recurso e manter uma única referência externa.
- Mesmo `externalId` com conteúdo divergente: conflito HTTP `409`.
- As chaves de idempotência e `externalId` são sempre isolados por parceiro.

## 5. Auditoria externa

A extensão de `EventoAuditoria` deve permitir:

- `tipoAtor`: por exemplo `USUARIO_INTERNO`, `PARCEIRO_API` ou `SISTEMA`.
- `atorUsuarioId`: manter o campo e a relação existentes para operações internas.
- `atorParceiroId` e `atorChaveApiId`: campos opcionais para identificar integração autenticada.
- `organizacaoId`: campo opcional quando uma operação afetar uma organização específica.
- Preservar ação, entidade, entidadeId, instante, resultado, requestId e detalhes.

Os novos relacionamentos devem ser opcionais para não invalidar eventos AV2. A migration não deve reescrever nem remover registros antigos. Recomenda-se comportamento `RESTRICT` para evitar excluir referências de auditoria; desativação/revogação deve ser preferida à exclusão física. O tipo de ator dos registros antigos deve ser tratado como `USUARIO_INTERNO` por default/backfill compatível, após validação do comportamento de migração.

Para falhas de autenticação em que não seja possível identificar um parceiro/chave válida, registrar evento de segurança sem associar indevidamente uma identidade. Nunca persistir o segredo recebido nem seu hash nos detalhes.

## 6. Dados expostos na rastreabilidade

A consulta pública deve resolver recursos no contexto do parceiro e das organizações autorizadas. O contrato pode retornar dados operacionais do lote e, para equipamentos associados:

- Tipo, marca e modelo.
- Estado físico e situação atual de rastreamento.
- Datas e eventos de movimentação relevantes.

Não expor CNPJ, nomes de responsáveis, dados pessoais, `codigoBarrasInterno`, IDs internos não destinados à integração ou informações administrativas internas. O contrato final deve usar referência externa apropriada para localizar o lote no contexto daquele parceiro; não aceitar identificadores internos enviados pelo cliente como prova de acesso.

## 7. Dados de eficiência operacional

O cálculo de duração requer timestamps de entrada do lote e conclusão da triagem. Na AV2, `Lote.dataEntrada` registra a entrada e `EventoAuditoria` registra a ação `TRIAGEM_LOTE` com instante e ator. Antes de adicionar colunas/eventos duplicados, confirmar nos serviços AV2 se esses dados cobrem os casos necessários e se o registro é confiável. Se houver lacunas (ex.: triagem cancelada ou reiniciada), introduzir eventos de domínio explícitos e imutáveis; não inferir duração a partir de logs técnicos genéricos.

## 8. Dados de predição

A predição de vida útil precisa de histórico de depreciação/falhas com observações datadas. Se a amostra mínima não existir, responder `PREVISAO_INDISPONIVEL` com motivo, em vez de produzir estimativa sem suporte. Registrar tamanho da amostra, método, versão, intervalo do dataset e qualidade/confiança.

## 9. Migrações

Toda alteração deve ser feita por migration Prisma versionada. Validar em banco isolado, testar FKs/uniques e preservar dados. Não usar `prisma db push` para substituir o histórico.
