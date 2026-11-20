# Arquitetura — GreenCode AV3

## 1. Base arquitetural

A AV3 mantém o monólito modular TypeScript/ESM. A aplicação é executada em Node.js 24, utiliza Fastify 5 para HTTP, Prisma 7 para persistência e PostgreSQL 17 como banco principal. Não há separação em microserviços neste incremento.

Nos módulos operacionais, o fluxo principal permanece:

```text
Rotas → Controllers → Services → Repositories → Prisma → PostgreSQL
```

Rotas validam o contrato HTTP; controllers conectam requisições aos casos de uso; services concentram regras de negócio e transações; repositories isolam consultas e gravações. Nas rotas internas, JWT e RBAC continuam sendo os mecanismos de autenticação e autorização.

Os módulos novos de parceiros e API pública seguem `Routes → Controllers → Services`, mas parte dos services acessa Prisma diretamente. Essa diferença em relação ao padrão dos módulos operacionais está documentada como dívida técnica a revisar antes de ampliar esses casos de uso. A transação multi-entidade de submissão deve continuar atômica mesmo se sua persistência for extraída para um repositório dedicado.

## 2. Módulos do primeiro incremento

| Módulo | Responsabilidade |
|---|---|
| `parceiros` | Administração de parceiros, associações com organizações, escopos, limites e ciclo de vida das API Keys |
| `integracoes` | Geração/verificação de API Keys, normalização de escopos, hash canônico e rate limiting |
| `api-publica` | Autenticação externa, autorização, submissão de lotes e consulta de rastreabilidade |
| `auditoria` | Uso do `EventoAuditoria` existente, ampliado para atores externos |
| `lotes` | Regras de lote existentes e funções de validação compartilhadas com a submissão pública |
| `equipamentos` | Regras de equipamento existentes e funções de normalização compartilhadas |

A submissão pública é um caso de uso multi-entidade: uma transação serializável coordena lote, equipamentos, referência externa, idempotência e auditoria. O fluxo não executa triagem nem cria movimentações. O lote começa em `RECEBIDO`; equipamentos começam em `AGUARDANDO_TRIAGEM`.

## 3. Autenticação e autorização

As rotas internas e administrativas utilizam JWT. A gestão de parceiros, associações e chaves exige também o papel `ADMINISTRADOR`. JWT não substitui API Key nas rotas públicas, e API Key não concede acesso às rotas internas.

A API Key usa prefixo `gc_live_...` e segredo aleatório de 32 bytes codificado em base64url. O segredo completo é exibido somente na criação; o banco armazena o SHA-256 hexadecimal. O prefixo localiza o registro, mas não autentica isoladamente. A comparação do digest utiliza `timingSafeEqual`.

A cada requisição, a aplicação verifica segredo, revogação, validade, estado do parceiro, escopo e associação da organização. Os escopos iniciais são `lotes:write` e `rastreabilidade:read`. A autorização efetiva é:

```text
escoposEfetivos = escoposParceiro ∩ escoposApiKey
```

A redução de permissões do parceiro produz efeito imediatamente para todas as chaves. O identificador público de associação `gci_...` é enviado em `X-Integration-ID`; o identificador público do lote usa prefixo `gcl_...`. O cliente não envia ID interno da organização nem CNPJ como referência de integração.

## 4. Rate limiting e limites de submissão

O limitador usa janela fixa de 60 segundos persistida no PostgreSQL. Cada requisição consome contadores do parceiro e da chave; o menor limite efetivo é aplicado. Os buckets são atualizados atomicamente, compartilhados entre instâncias e expiram pela janela. Excesso de requisições retorna `429` e `Retry-After`; payload acima do limite retorna `413`. Redis/BullMQ é usado para as filas de relatórios e análises, não como fonte do contador HTTP.

## 5. Idempotência e concorrência

`Idempotency-Key` e `externalId` são únicos por parceiro e persistidos em estruturas separadas. O hash de conteúdo é SHA-256 de JSON semântico canônico: propriedades de objetos são ordenadas, listas preservam a ordem e campos de domínio são normalizados antes do cálculo. A data de entrada gerada automaticamente não participa do hash quando não foi enviada pelo cliente.

Mesma chave/conteúdo ou mesmo `externalId`/conteúdo reutiliza o lote original. Conteúdo divergente para uma mesma referência retorna `409 Conflict`. A transação serializável e constraints únicas PostgreSQL protegem a integridade sob concorrência. A validação real dessas condições deve ocorrer na suíte de integração PostgreSQL.

## 6. Persistência e relações principais

Os modelos novos são `Parceiro`, `ParceiroOrganizacao`, `ApiKey`, `RequisicaoIdempotencia` e `ReferenciaExternaParceiro`. O modelo `Lote` recebeu `publicId`. `EventoAuditoria` foi ampliado com `atorTipo`, `parceiroId`, `apiKeyId` e `organizacaoId`, preservando os campos e as relações com usuários internos.

Parceiros, associações e chaves possuem ciclo de vida lógico. A revogação não apaga os registros históricos. As migrations anteriores são preservadas; a evolução é adicionada por migration versionada.

## 7. Segurança e minimização de dados

A rastreabilidade retorna apenas campos operacionais necessários: identificador público, status e datas do lote, quantidade de equipamentos, histórico operacional permitido e campos de equipamento/movimentação aprovados. A resposta não deve expor CNPJ, dados pessoais, nomes de responsáveis internos, IDs internos, `codigoBarrasInterno`, credenciais, tokens, hashes ou referências externas de terceiros.

A consulta por `externalId` é contextualizada ao parceiro autenticado. A consulta por `publicId` exige associação ativa com a organização do lote. Logs Fastify redigem `X-API-Key`, Authorization, cookies e campos sensíveis configurados; auditoria não registra segredo nem hash.

## 8. OpenAPI e documentação

O Swagger documenta rotas internas, rotas administrativas e endpoints públicos. O esquema `apiKeyAuth` utiliza o header `X-API-Key`; a submissão também exige `X-Integration-ID` e `Idempotency-Key`. A interface está em `/docs/` e o contrato JSON em `/docs/json`.

## 9. Módulos analíticos e processamento assíncrono AV3

A camada analítica está separada em eficiência operacional, rentabilidade e vida útil remanescente. As execuções são persistidas no PostgreSQL com método, versão, filtros, resultado e identificação manual/agendada. O fluxo de triagem antigo e o fluxo explícito AV3 gravam `historico_triagem`; índices parciais garantem um início e uma conclusão por sessão.

O worker separado consome `greencode-relatorios` e `greencode-analises`. A fila de análises registra schedulers com IDs estáveis via `upsertJobScheduler`; retries usam backoff exponencial. Relatórios usam Outbox, lease/heartbeat, armazenamento com checksum SHA-256, download autorizado e expiração. O PostgreSQL permanece como estado de negócio; Redis coordena entrega e agendamento.
