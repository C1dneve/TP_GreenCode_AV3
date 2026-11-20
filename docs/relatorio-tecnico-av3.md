# Relatório técnico — GreenCode AV3

## 1. Objetivo e escopo desta entrega

Este relatório registra as decisões e evidências do primeiro grande passo da AV3: gestão administrativa de parceiros, associação com organizações, API Keys, autorização por escopos, rate limiting, submissão pública de lotes, idempotência, rastreabilidade e auditoria.

Analytics, filas, Redis/BullMQ, workers, scheduler, relatórios assíncronos, webhooks e armazenamento de artefatos não fazem parte desta entrega e permanecem pendentes.

## 2. Arquitetura adotada

A aplicação mantém o monólito modular TypeScript/ESM com Node.js 24, Fastify 5, Prisma 7 e PostgreSQL 17. As rotas internas continuam protegidas por JWT/RBAC. As rotas públicas estão versionadas em `/api/v1/public` e utilizam API Key.

Os módulos novos são `parceiros`, `integracoes` e `api-publica`. A auditoria existente foi ampliada; as regras de domínio de lote e equipamento são reutilizadas para evitar uma segunda implementação de validação.

**Divergência arquitetural a revisar:** parte de `ParceirosService` e `ApiPublicaService` acessa Prisma diretamente, ao contrário do padrão Repository dos módulos operacionais. A submissão ainda precisa manter transação atômica entre lote, equipamentos, referências, idempotência e auditoria; a refatoração deve preservar esse limite transacional.

## 3. API Keys e autorização

- Segredo gerado com 32 bytes aleatórios e prefixo público `gc_live_...`.
- Segredo integral exibido somente na criação.
- Armazenamento apenas de SHA-256 hexadecimal; comparação de digest com `timingSafeEqual`.
- Escopos implementados: `lotes:write` e `rastreabilidade:read`.
- Escopos efetivos calculados em cada requisição: interseção dos escopos do parceiro com os da API Key.
- Estado do parceiro, revogação/expiração da chave e associação ativa com organização são verificados no servidor.
- Logs Fastify redigem `X-API-Key`, Authorization, cookies e campos sensíveis configurados.

A escolha de SHA-256 parte da premissa de que o segredo é aleatório e possui alta entropia; não é uma senha escolhida por uma pessoa. Essa estratégia não deve ser reaproveitada para armazenar senhas humanas.

## 4. Rate limiting

O limitador implementado utiliza janela fixa local de 60 segundos. Contadores independentes são mantidos para parceiro e chave; o menor limite é aplicado. Limites de payload e quantidade de equipamentos também respeitam o menor valor permitido entre parceiro e chave.

Respostas de excesso de requisições utilizam HTTP `429` e `Retry-After`; payload maior que o limite retorna `413`. O contador não é distribuído nem compartilhado entre processos e reinicia com a aplicação. Antes da escala horizontal, será necessário backend compartilhado e nova validação operacional.

## 5. Persistência e idempotência

A migration `20261120160000_partner_public_api` adiciona `Parceiro`, `ParceiroOrganizacao`, `ApiKey`, `RequisicaoIdempotencia` e `ReferenciaExternaParceiro`, amplia `EventoAuditoria` e adiciona `Lote.publicId`. As três migrations anteriores não foram modificadas.

`RequisicaoIdempotencia` identifica `(parceiroId, chave)` e `ReferenciaExternaParceiro` identifica `(parceiroId, externalId)`. O hash é calculado sobre JSON semântico canônico. A submissão utiliza transação serializável para persistir lote, equipamentos, referência externa, idempotência e auditoria sem registros parciais.

## 6. Auditoria

A estrutura `EventoAuditoria` existente foi ampliada com identificação opcional do tipo de ator, parceiro, API Key e organização, preservando o vínculo com o usuário interno. Operações administrativas e externas relevantes são registradas. Segredos e hashes não devem aparecer em detalhes ou logs.

O registro atual não cria identidade artificial para falhas de autenticação sem chave válida; auditoria específica dessas falhas permanece como possível evolução.

## 7. OpenAPI e documentação

O Swagger mantém as rotas internas e documenta as rotas administrativas e públicas. API Key utiliza `X-API-Key`; submissões também exigem `X-Integration-ID` e `Idempotency-Key`. Interface: `/docs/`. JSON: `/docs/json`.

O [Guia de execução e testes](guia-de-testes-professor.md) descreve a preparação em Windows/Ubuntu, execução Docker, testes automatizados e jornada manual de integração.

## 8. Testes e verificações registradas

Conforme o relatório fornecido com o pacote de implementação:

| Verificação | Resultado informado | Interpretação |
|---|---|---|
| Transpilation sintática de 22 arquivos TypeScript | Sem diagnósticos | Verifica sintaxe, não equivale ao build completo |
| Testes unitários focados | 5 aprovados, 0 falhas | Evidência restrita aos cinco casos executados |
| `git diff --check` | Aprovado | Sem problemas de whitespace no diff analisado |
| Verificação de links Markdown | 12 verificados, 0 quebrados | Escopo limitado aos links verificados |
| Build oficial (`npm run build`) | Não concluído | Pendente |
| Prisma (`npm run prisma:validate`) | Não concluído | Pendente |
| Testes HTTP (`npm test`) | Não concluídos | Pendente |
| Integração PostgreSQL (`npm run test:integration`) | Não concluída | Pendente |

A instalação `npm ci` falhou com `EAI_AGAIN` no registry npm. O ambiente utilizado possuía Node.js `v22.16.0`, incompatível com `engines: >=24 <25`; o executável local Prisma não ficou disponível. Também não havia Docker nem PostgreSQL disponíveis. Por isso não foi possível gerar o Prisma Client, executar o build oficial, validar/aplicar a migration, nem executar testes HTTP/integração.

Esses resultados são o registro recebido da execução que gerou o pacote; não representam homologação independente. O roteiro para obter evidências completas está no guia de testes.

## 9. Pontos identificados na revisão independente

1. **Histórico público:** o serviço grava `SUBMISSAO_PUBLICA_LOTE`, mas `TRACKING_AUDIT_ACTIONS` não inclui essa ação. A consulta `historicoOperacional` pode não mostrar o evento inicial da submissão. Corrigir o filtro e adicionar teste de integração.
2. **Persistência dos services:** avaliar extração das operações Prisma de `ParceirosService` e `ApiPublicaService` para repositories dedicados, mantendo uma unidade transacional para submissões.
3. **Rollback:** acrescentar teste PostgreSQL que provoque falha durante a criação dos registros e comprove ausência de lote, equipamentos, referências, idempotência e auditoria parciais.
4. **Ambiente:** executar validação Prisma, build, migration em banco limpo, integração em PostgreSQL isolado e regressão da API.

A definição `descricao` da resposta de parceiro no código recebido já aceita `string` ou `null`; não há pendência documental nesse contrato no pacote atual.

## 10. Próximas etapas

- Corrigir os pontos da revisão independente e executar testes completos.
- Instrumentar e validar dados necessários aos indicadores analíticos.
- Implementar analytics e persistência dos resultados.
- Adicionar Redis/BullMQ, workers, retry e mecanismo de reconciliação de publicação.
- Implementar solicitação, consulta, download, expiração e regeneração de relatórios.
- Validar a aplicação em Windows 10+ e Ubuntu 24.04.03+ e registrar resultados reais.
