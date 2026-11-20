# Requisitos da AV3 e rastreabilidade

Legenda de origem:
- **[ENUNCIADO]** requisito expresso no PDF AV3.
- **[DECISÃO]** decisão de produto aprovada pelo responsável.
- **[PROPOSTA]** desenho técnico recomendado; validar durante implementação.

| ID | Requisito | Origem | Evidência esperada |
|---|---|---|---|
| ANA-01 | Calcular tempo médio da entrada do lote até conclusão da triagem | [ENUNCIADO] | Teste com timestamps reais e resultado agregado |
| ANA-02 | Comparar gargalos/variações por operador e período | [ENUNCIADO] | Testes de filtros e agregações |
| ANA-03 | Estimar recuperação por tipo de equipamento considerando estado, marca e modelo | [ENUNCIADO] | Relatório com metodologia e amostra |
| ANA-04 | Prever vida útil remanescente usando histórico de depreciação/falhas | [ENUNCIADO] | Testes do método e cenários sem histórico |
| ANA-05 | Persistir previsões para histórico e comparação posterior | [ENUNCIADO] | Consulta de resultados anteriores |
| ANA-06 | Registrar método, amostra, qualidade/confiança e motivo de indisponibilidade | [DECISÃO] | Contrato e testes de resposta |
| API-01 | API pública com autenticação por API Keys | [ENUNCIADO] | Testes de autenticação |
| API-02 | Limites de requisição por cliente/parceiro | [ENUNCIADO] | Testes de rate limit |
| API-03 | Permissões específicas associadas a chaves/parceiros | [ENUNCIADO]/[DECISÃO] | Testes de escopos e autorização efetiva |
| API-04 | Rotas públicas separadas das internas e versionadas | [ENUNCIADO] | Registro de rotas e testes de isolamento |
| API-05 | OpenAPI com exemplos, erros e parâmetros | [ENUNCIADO] | Documento gerado e inspeção Swagger |
| API-06 | Disponibilizar consulta pública de status de rastreabilidade | [ENUNCIADO] | Testes HTTP de consulta autorizada e não autorizada |
| API-07 | Disponibilizar submissão pública de novos lotes | [ENUNCIADO] | Testes HTTP de submissão lote-only e lote com equipamentos |
| API-08 | Disponibilizar solicitação/recebimento de relatórios analíticos por integração | [ENUNCIADO] | Testes de solicitação, status e resultado na fase assíncrona |
| API-09 | Resposta de rastreabilidade com dados operacionais e dados autorizados do equipamento, sem exposição desnecessária de dados pessoais/internos | [DECISÃO] | Testes de contrato e de minimização de dados |
| PAR-01 | CRUD administrativo de parceiros | [DECISÃO] | Testes RBAC e regras de estado |
| PAR-02 | Autorizar e remover organizações vinculadas a um parceiro | [DECISÃO] | Testes de associação, remoção e isolamento |
| PAR-03 | Múltiplas chaves por parceiro, revogação e hash do segredo | [DECISÃO] | Testes de ciclo de vida; segredo exibido uma vez |
| PAR-04 | Limites configuráveis: taxa, tamanho de lote e jobs concorrentes | [DECISÃO] | Testes de configuração e enforcement |
| PAR-05 | Permissões efetivas limitadas pela interseção entre escopos do parceiro e da chave | [DECISÃO] | Testes de permissões permitidas e negadas |
| INT-01 | Submissão lote-only ou lote+equipamentos, transacional | [DECISÃO] | Testes de rollback integral |
| INT-02 | Idempotência por Idempotency-Key e external ID único por parceiro | [DECISÃO] | Testes de repetição, conteúdo divergente e conflito |
| INT-03 | Consulta de rastreabilidade limitada às organizações autorizadas e aos escopos da chave | [DECISÃO] | Testes de isolamento entre parceiros, organizações e chaves |
| JOB-01 | Enfileirar análises/relatórios demorados | [ENUNCIADO] | Teste de publicação e consumo |
| JOB-02 | Retornar task ID e permitir polling do status | [ENUNCIADO]/[DECISÃO] | Testes de estados |
| JOB-03 | Disponibilizar resultado após conclusão | [ENUNCIADO] | Teste de autorização e download |
| JOB-04 | Retry documentado e seguro | [ENUNCIADO] | Testes de falha/reprocessamento |
| REL-01 | Histórico de solicitações, status, download autenticado e expiração | [DECISÃO] | Testes de acesso e expiração |
| REL-02 | Expiração configurável, padrão de sete dias; regeneração | [DECISÃO] | Testes de expiração/regeneração |
| AUD-01 | Auditar alterações de parceiro, associações, chaves, permissões, submissões e operações externas de rastreabilidade/relatórios | [DECISÃO] | Eventos auditáveis com ator, parceiro, chave, organização, ação, resultado e request ID quando aplicável |
| OPS-01 | Indicadores diários, previsões semanais e execução manual | [DECISÃO] | Jobs recorrentes e endpoint/admin manual |
| TECH-01 | Relatório técnico: biblioteca, persistência, retry e escalabilidade | [ENUNCIADO] | `relatorio-tecnico-av3.md` preenchido com decisões reais |
| COMP-01 | Compatibilidade Windows 10+ e Ubuntu 24.04.03+ | [ENUNCIADO] | Guia e testes documentados por plataforma |

## Critério de conclusão

Um requisito só pode ser marcado como validado após execução de teste ou inspeção verificável adequada. Código escrito, sem execução, deve ser registrado como implementado e não validado. O estado da matriz deve ser atualizado durante a implementação.
