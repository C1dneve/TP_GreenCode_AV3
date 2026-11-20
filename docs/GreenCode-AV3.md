# GreenCode AV3 — visão do projeto

## 1. Propósito

Evoluir o GreenCode AV2, um monólito modular de logística reversa, para uma plataforma analítica e integrada. A AV3 não é um segundo sistema independente: é a continuação do produto, preservando o domínio, os módulos e a fundação técnica aprovados na AV2.

## 2. Escopo explicitado no enunciado AV3

### 2.1 Camada analítica

A camada deve produzir métricas agregadas e relatórios preditivos, incluindo no mínimo:

- Eficiência operacional: tempo médio entre entrada do lote e conclusão da triagem, com análise de gargalos e variações por operador e período.
- Rentabilidade por tipo de equipamento: estimativa do valor médio de recuperação de materiais considerando estado físico, marca e modelo.
- Vida útil remanescente: regressão simples ou suavização exponencial com base em histórico de depreciação e falhas; resultados devem ser persistidos para consulta histórica e comparação com realizações futuras.

O enunciado cita `simple-statistics` e `mathjs` como opções estatísticas e `node-cron` ou jobs recorrentes em worker como opções de agendamento. A escolha final precisa ser justificada tecnicamente.

### 2.2 API pública

A API pública deve permitir integração de organizações parceiras com o GreenCode, incluindo:

- Consulta de status de rastreabilidade.
- Submissão de novos lotes.
- Solicitação/recebimento de relatórios analíticos.
- Autenticação baseada em API Keys e limites de taxa.
- Permissões específicas associadas às chaves/parceiros.
- Documentação interativa com exemplos de request/response, erros e parâmetros.
- Separação entre endpoints públicos e internos/administrativos.
- Versionamento explícito da API pública.

### 2.3 Processamento assíncrono

- Enfileirar operações demoradas, como análises e relatórios.
- Retornar identificador único da tarefa.
- Disponibilizar consulta de status.
- Permitir acesso ao resultado quando concluído.
- O enunciado exemplifica BullMQ e Redis, e menciona polling ou webhook.

### 2.4 Entrega técnica e compatibilidade

A entrega inclui código-fonte completo com camada analítica e API pública documentada, além de relatório técnico justificando biblioteca estatística, persistência dos resultados, retry e evolução para centenas ou milhares de parceiros. O enunciado exige compatibilidade com Windows 10 ou superior e Ubuntu 24.04.03 ou superior (incluindo derivados).

## 3. Decisões de produto aprovadas

As regras a seguir são decisões de produto aprovadas pelo responsável, não devem ser atribuídas literalmente ao enunciado:

### 3.1 Parceiros, organizações e API Keys

- JWT continua sendo usado nas rotas internas; API Key autentica integrações externas.
- Cadastro e gestão de parceiros são restritos ao Administrador GreenCode.
- Um parceiro pode ter múltiplas chaves, identificáveis e revogáveis individualmente; o segredo é exibido uma única vez e armazenado somente como hash.
- Um parceiro pode acessar várias organizações, somente quando explicitamente autorizado.
- As permissões efetivas de uma chave são a interseção entre as permissões concedidas ao parceiro e os escopos atribuídos à própria chave. Uma chave nunca amplia as permissões do parceiro.
- A autorização de organização é verificada em toda operação pública; um `partnerId` enviado pelo cliente nunca é considerado prova de autorização.
- Limites de taxa e de submissão podem ser configurados por parceiro, com possibilidade de limites mais restritivos por chave.

### 3.2 Submissão e rastreabilidade

- Submissões de parceiro podem conter somente o lote ou o lote acompanhado de equipamentos.
- Submissões são atômicas: tudo é persistido ou nada é persistido.
- A API pública permite consulta de rastreabilidade de lotes e equipamentos das organizações autorizadas.
- A resposta de rastreabilidade pode incluir informações operacionais do lote e, para os equipamentos, tipo, marca, modelo, estado físico e situação atual, além do histórico de movimentações.
- A resposta pública aplica minimização de dados: não expõe CNPJ, dados pessoais, nomes de usuários internos, identificadores internos não destinados à integração, credenciais ou informações operacionais internas desnecessárias.
- A política de submissão pode ser configurada por parceiro; as validações de domínio da AV2 continuam obrigatórias.

### 3.3 Idempotência

- A submissão aceita `Idempotency-Key` e identificador externo (`externalId`) único por parceiro, quando informado.
- Mesma `Idempotency-Key` e mesmo conteúdo normalizado: retornar o resultado original, sem criar novo lote.
- Mesma `Idempotency-Key` com conteúdo diferente: responder HTTP `409 Conflict`.
- Mesmo `externalId` e mesmo conteúdo, mesmo com outra `Idempotency-Key`: retornar o recurso original e associar a nova chave de idempotência ao mesmo resultado, sem duplicar o lote.
- Mesmo `externalId` com conteúdo diferente: responder HTTP `409 Conflict`.
- A verificação de idempotência, a criação do lote/equipamentos e os registros de referência devem ser consistentes e transacionais; nenhuma submissão pode deixar registros parciais.

### 3.4 Auditoria

- As operações administrativas e externas relevantes devem ser auditadas: parceiros, associações de organizações, API Keys, permissões, submissões e consultas/solicitações de relatórios quando aplicável.
- A AV3 amplia o modelo `EventoAuditoria` já existente na AV2, preservando seus registros e a relação com usuários internos. Não criar uma segunda infraestrutura/tabela de auditoria de parceiros sem justificativa técnica aprovada.
- Eventos externos devem identificar, quando autenticados, o parceiro e a API Key utilizados, além da organização afetada, ação, entidade, resultado, instante e request ID.
- Segredos, hashes de API Keys, cabeçalhos de autenticação, tokens, credenciais e dados pessoais desnecessários nunca devem ser armazenados nos detalhes de auditoria.

### 3.5 Analytics e relatórios

- Previsões individuais e agrupadas; registrar método, amostra, qualidade/confiança, razões de indisponibilidade, data de cálculo e conjunto de dados utilizado.
- Distinguir valor estimado de recuperação de valor financeiro realizado.
- Relatório com solicitação, status, histórico, download autenticado, expiração configurável com padrão de sete dias e possibilidade de regeneração após expirar.
- Indicadores diários, previsões semanais e execução manual.
- Polling inicialmente; sem webhooks na primeira entrega.

## 4. Fora de escopo inicial

- SPA/front-end novo.
- Webhooks para parceiros.
- Microserviços independentes.
- Reescrita dos módulos transacionais AV2.
- Alterações arbitrárias nas regras de domínio existentes.
- Exposição de rotas internas por meio da API pública.

## 5. Primeiro grande passo de implementação

O primeiro grande passo aprovado reúne a fundação de integração e a API pública inicial:

1. Preparar a cópia AV3 da AV2 sem alterar a história/repositório AV2.
2. Implementar gestão administrativa de parceiros e organizações autorizadas.
3. Implementar ciclo de vida de API Keys, hash do segredo, escopos e autorização pela interseção parceiro/chave.
4. Ampliar a auditoria existente para identificar atores internos e externos.
5. Implementar rate limiting e limites de submissão.
6. Implementar submissão pública de lote-only e lote com equipamentos, transacional e idempotente.
7. Implementar consulta pública de rastreabilidade com dados operacionais do lote e dados autorizados dos equipamentos, respeitando minimização de dados.
8. Atualizar Swagger/OpenAPI e cobrir as funcionalidades com testes.

A camada analítica, Redis/BullMQ, workers e relatórios assíncronos permanecem para grandes passos posteriores.

## 6. Princípios de evolução

1. Preservar a estrutura `src/modules/<dominio>` e o padrão controller/service/repository.
2. Adicionar novos módulos sem concentrar lógica de negócio em controllers.
3. Usar migrações versionadas; nunca `db push` como substituto.
4. Persistir resultados analíticos com versão do método/modelo e referência temporal.
5. Separar API processadora (Fastify) do processo worker, compartilhando módulos e infraestrutura.
6. Aplicar autorização por parceiro, interseção de escopos e organização em toda leitura/escrita pública.
7. Não registrar segredos de API, tokens ou credenciais.
8. Manter AV2 íntegra e criar AV3 em novo repositório derivado.
9. Não alterar componentes transacionais AV2 fora do necessário para integrar o novo fluxo; problemas não bloqueadores devem ser documentados, não corrigidos incidentalmente.

## 7. Referências internas

Ver requisitos, arquitetura, modelo de dados, histórias, plano de implementação e ADRs desta pasta.
