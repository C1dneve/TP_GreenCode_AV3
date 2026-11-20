# Arquitetura proposta — GreenCode AV3

## 1. Estilo arquitetural

Manter o **monólito modular** da AV2. O processo HTTP e o worker são dois processos de execução do mesmo código-base, não microserviços de domínio independentes. Os módulos continuam separados por responsabilidade e compartilham os serviços/repositórios necessários.

## 2. Componentes

| Componente | Responsabilidade |
|---|---|
| Fastify API | Rotas internas JWT, rotas públicas API Key, Swagger/OpenAPI |
| PostgreSQL | Dados transacionais AV2, parceiros, chaves (hash), permissões, registros de idempotência, jobs/resultados analíticos e auditoria |
| Redis | Transporte/estado operacional da fila BullMQ |
| Worker | Consome jobs de analytics e relatórios, aplica retry e persiste resultados |
| Scheduler | Dispara indicadores diários e previsões semanais; pode residir no worker com proteção contra duplicidade |
| Docker Compose | Ambiente local reproduzível com API, worker, PostgreSQL e Redis |

## 3. Fronteiras HTTP e autorização

- Rotas internas existentes permanecem protegidas por JWT/RBAC.
- Rotas públicas novas ficam em prefixo separado e versionado, por exemplo `/api/v1/public`.
- Rotas administrativas de parceiros ficam em namespace interno/admin e exigem papel Administrador GreenCode.
- A API pública nunca deve reutilizar automaticamente autorização JWT interna.
- Toda chave deve estar ativa, não expirada e vinculada a parceiro ativo.
- **Permissão efetiva = interseção entre os escopos concedidos ao parceiro e os escopos atribuídos à chave.** A chave não pode conceder uma permissão que o parceiro não possui.
- As permissões da chave devem ser subconjunto dos escopos do parceiro no momento da criação/atualização; além disso, a interseção deve ser recalculada na autorização de cada requisição, para que a redução posterior de permissões do parceiro tenha efeito imediato.
- Toda operação com dados de organização deve verificar a associação ativa parceiro-organização no servidor. Não confiar em `partnerId` ou `organizacaoId` fornecidos pelo cliente sem validar o vínculo.
- Rate limit pode ser aplicado por chave e por parceiro; prevalece o limite mais restritivo configurado. Limites de payload e submissões também são aplicados no servidor.

## 4. Fluxo de submissão externa

1. API recebe API Key e, quando fornecida, `Idempotency-Key`.
2. Resolve hash da chave, parceiro, estado, escopos efetivos e limites.
3. Verifica a organização autorizada e a política de submissão do parceiro.
4. Valida todo o payload com as regras de domínio existentes da AV2.
5. Normaliza o payload e calcula hash estável do conteúdo semântico para comparação de idempotência.
6. Dentro de transação PostgreSQL, verifica os identificadores idempotentes, persiste lote/equipamentos e grava a referência do resultado.
7. Em falha de validação ou persistência, nenhum registro parcial da submissão pode permanecer.
8. Registra auditoria sem incluir segredo, hash de API Key ou payload sensível desnecessário.

### Regras de idempotência

- Mesma `Idempotency-Key` para o mesmo parceiro e mesmo conteúdo normalizado: retornar o resultado originalmente criado, sem duplicar o recurso.
- Mesma `Idempotency-Key` para o mesmo parceiro e conteúdo diferente: responder HTTP `409 Conflict`.
- Mesmo `externalId` para o mesmo parceiro e mesmo conteúdo, mesmo com outra `Idempotency-Key`: retornar o recurso original e registrar a nova chave de idempotência como referência ao mesmo resultado.
- Mesmo `externalId` para o mesmo parceiro e conteúdo diferente: responder HTTP `409 Conflict`.
- `Idempotency-Key` e `externalId`, quando presentes, são isolados por parceiro; um parceiro não pode bloquear nem consultar identificadores de outro.

## 5. Fluxo público de rastreabilidade

1. Cliente envia API Key e identifica o lote usando a referência externa associada à integração do parceiro.
2. API autentica a chave e calcula os escopos efetivos.
3. API resolve o lote no contexto do parceiro, sem expor nem aceitar como confiável um identificador interno arbitrário.
4. API confirma que a organização do lote está associada e ativa para o parceiro.
5. API retorna dados operacionais do lote e, quando autorizado, dados dos equipamentos vinculados: tipo, marca, modelo, estado físico, situação atual e histórico de movimentações.
6. A resposta omite CNPJ, nomes/dados pessoais, identificadores internos não destinados à integração e informações internas desnecessárias. Nunca inclui API Keys, hashes, tokens ou credenciais.
7. Consultas fora do escopo ou de organizações não autorizadas não podem revelar se registros de terceiros existem.

O contrato exato de rota e o formato do identificador externo devem ser definidos na implementação da API, sem expor `codigoBarrasInterno` ou IDs internos da AV2 por conveniência.

## 6. Fluxo assíncrono

1. Cliente solicita relatório/análise.
2. API valida autorização e cria registro persistente de tarefa.
3. Publica job BullMQ/Redis e retorna `202 Accepted` com task ID e rota de status.
4. Worker processa com retry limitado e backoff.
5. Worker persiste estado, resultado e metadados; atualiza status.
6. Cliente consulta status por polling.
7. Download do resultado exige autenticação e autorização no momento do download; respeita expiração.

O estado persistido no PostgreSQL é a referência de negócio. Redis/BullMQ é mecanismo de execução, não a única fonte do histórico. Deve existir mecanismo de reconciliação/publicação para execuções registradas no PostgreSQL cujo job não tenha sido publicado no Redis (por exemplo, Transactional Outbox ou solução equivalente). A escolha e a implementação serão detalhadas na fase de filas.

## 7. Segurança e auditoria

- Segredo de API Key gerado criptograficamente, exibido uma única vez e armazenado somente como hash.
- Identificador/prefixo público não secreto pode localizar a chave; comparação do hash em tempo constante quando aplicável.
- Revogação individual e expiração opcional.
- Rate limit por chave/parceiro, além de limites de payload e concorrência.
- Nunca confiar apenas no `partnerId` enviado pelo cliente.
- Verificar organização autorizada em cada operação.
- Não registrar cabeçalho de autenticação, API Key, hash do segredo, senha, token ou URL com credenciais.
- A auditoria deve ampliar `EventoAuditoria` da AV2, preservando `atorUsuarioId`, `atorNomeSnapshot` e os registros preexistentes. Para eventos externos, acrescentar identificação do tipo de ator, parceiro e chave utilizada; registrar `organizacaoId` quando houver organização afetada.
- Para ações administrativas, manter o usuário interno como ator. Para operações autenticadas por integração, registrar parceiro e chave; para eventos automáticos, identificar o ator como sistema.
- Usar FKs opcionais/restritivas para novos atores, sem exigir parceiro ou chave em eventos legados. Não criar uma tabela paralela de auditoria de parceiro sem ADR aprovado.

## 8. Observabilidade e falhas

- Correlation/request ID em API e jobs.
- Estados de job explícitos: pendente, em execução, concluído, falhou e cancelado (se cancelamento for implementado).
- Retry apenas para falhas transitórias; erros de validação não devem ser repetidos.
- Backoff exponencial com limite de tentativas e fila de falhas/DLQ ou mecanismo equivalente.
- Jobs idempotentes: reprocessar não duplica resultado nem submissão.
- Métricas de fila, duração, tentativas e falhas sem expor dados sensíveis.

## 9. Escalabilidade

Começar com uma instância API e um worker; permitir escalar horizontalmente processos API e workers. Isolar concorrência por parceiro e aplicar limites. Particionar/arquivar resultados históricos apenas quando volume real justificar. Não introduzir microserviços prematuramente.
