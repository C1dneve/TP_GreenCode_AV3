# Guia de execução e testes — GreenCode AV3

Este roteiro permite iniciar o GreenCode, autenticar como administrador, configurar um parceiro de integração, percorrer o ciclo de vida público de lotes e solicitar relatórios. Ao final estão os comandos de testes e o significado das evidências. Os nomes de campos e os caminhos abaixo correspondem aos contratos publicados pelo Swagger.

## 1. Preparar o ambiente

### Requisitos

A execução recomendada usa Docker Desktop no Windows ou Docker Engine com o plugin Docker Compose em Linux. Node.js, PostgreSQL e Redis não precisam estar instalados diretamente no host quando a aplicação é executada em containers. Para executar npm no host, utilize Node.js 24.x, PostgreSQL 17 e Redis 7.

### Configurar variáveis locais

Na raiz do projeto, copie o modelo de ambiente:

**PowerShell**

```powershell
if (-not (Test-Path .\.env)) { Copy-Item .env.example .env }
```

**Bash**

```bash
cp .env.example .env
```

Edite `.env` e substitua ao menos `POSTGRES_PASSWORD`, `JWT_SECRET`, `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_NAME` e `BOOTSTRAP_ADMIN_PASSWORD`. A senha administrativa deve respeitar o tamanho mínimo esperado pela aplicação. Use valores locais de avaliação; não reutilize credenciais pessoais ou de produção e não envie o arquivo `.env` para o repositório.

Gere `JWT_SECRET` aleatório. Em Bash, por exemplo:

```bash
openssl rand -hex 32
```

Copie o valor gerado para `JWT_SECRET`. A chave não deve ser publicada nem colada em evidências.

### Validar e iniciar

```bash
docker compose config -q
docker compose --profile tests config -q
docker compose up --build -d
docker compose ps
```

O serviço `api` aguarda o PostgreSQL saudável, aplica migrations e executa o seed antes de iniciar. O worker é um processo separado e depende do PostgreSQL e Redis. Verifique os logs em terminais separados:

```bash
docker compose logs -f api
docker compose logs -f worker
```

### Endereços

- Swagger UI: `http://localhost:3000/docs/`
- Documento OpenAPI: `http://localhost:3000/docs/json`
- Health check: `http://localhost:3000/health`

O health check pode ser consultado com `curl --fail http://localhost:3000/health` ou `Invoke-RestMethod http://localhost:3000/health` no PowerShell. A resposta deve indicar `status: "ok"` e `service: "greencode-api"`.

## 2. Entrar como administrador

No Swagger, execute `POST /api/v1/auth/login`:

```json
{
  "usuario": "<BOOTSTRAP_ADMIN_USERNAME>",
  "senha": "<BOOTSTRAP_ADMIN_PASSWORD>"
}
```

Use os valores do `.env`. A resposta esperada é HTTP `200` e contém `accessToken`, `tokenType` e informações públicas do usuário. Clique em **Authorize**, escolha `bearerAuth` e informe o token retornado. A administração de parceiros, API Keys e associações exige papel `ADMINISTRADOR`.

O seed cria o usuário inicial quando ele ainda não existe. Alterar `BOOTSTRAP_ADMIN_PASSWORD` depois da primeira inicialização não redefine a senha de uma conta já persistida.

## 3. Criar um parceiro de integração

### 3.1 Encontrar uma organização ativa

Com o JWT do administrador, consulte `GET /api/v1/organizacoes?page=1&pageSize=20&ativo=true`. Escolha uma organização ativa e guarde seu UUID como `<organizacaoId>` para a criação do vínculo administrativo. Esse UUID não será enviado pelo parceiro nas chamadas públicas.

### 3.2 Cadastrar parceiro

Execute `POST /api/v1/parceiros`:

```json
{
  "nome": "Parceiro de Avaliação AV3",
  "descricao": "Integração usada no roteiro de avaliação",
  "escopos": [
    "lotes:read",
    "lotes:write",
    "rastreabilidade:read",
    "reports:read",
    "reports:write"
  ],
  "limiteRequisicoesPorMinuto": 120,
  "maxEquipamentosPorSubmissao": 100,
  "maxPayloadBytes": 1048576,
  "permiteLoteSemEquipamentos": true
}
```

Esperado: HTTP `201`. Guarde o campo `id` como `<parceiroId>`. O conjunto de escopos do parceiro define o teto de permissões que poderá ser concedido às chaves.

### 3.3 Vincular organização

Execute `POST /api/v1/parceiros/{parceiroId}/organizacoes`, substituindo o parâmetro pelo ID anterior:

```json
{
  "organizacaoId": "<organizacaoId>"
}
```

Esperado: HTTP `201`. Guarde `identificadorPublico` como `<integrationId>`. Esse valor opaco, e não o UUID interno da organização, será enviado no header `X-Integration-ID`.

### 3.4 Criar API Key

Execute `POST /api/v1/parceiros/{parceiroId}/chaves`:

```json
{
  "nome": "Chave da avaliação AV3",
  "escopos": [
    "lotes:read",
    "lotes:write",
    "rastreabilidade:read",
    "reports:read",
    "reports:write"
  ],
  "limiteRequisicoesPorMinuto": 60,
  "maxEquipamentosPorSubmissao": 50,
  "maxPayloadBytes": 524288
}
```

Esperado: HTTP `201`, com `apiKey` e `segredo`. Copie o segredo completo uma única vez e guarde `apiKey.id` como `<apiKeyId>`. O GreenCode não permite recuperar o segredo em consultas posteriores; o banco guarda somente o hash. Não inclua o segredo em capturas de tela, relatórios ou evidências.

No Swagger, autorize também o esquema `apiKeyAuth` com o segredo. Nas rotas públicas, use os headers aplicáveis:

- `X-API-Key`: segredo da chave.
- `X-Integration-ID`: `<integrationId>` para operações que exigem associação organizacional.
- `Idempotency-Key`: identificador único da operação de submissão de lote.

## 4. Demonstrar o ciclo de vida público dos lotes

### 4.1 CREATE — Submeter lote

Execute `POST /api/v1/public/lotes`, com os três headers descritos acima:

```json
{
  "externalId": "erp-av3-lote-001",
  "notaFiscal": "NF-AV3-001",
  "transportadora": "Transportadora de Avaliação",
  "observacoes": "Lote de demonstração criado pelo parceiro",
  "equipamentos": [
    {
      "tipo": "NOTEBOOK",
      "marca": "MarcaExemplo",
      "modelo": "Modelo 14",
      "anoFabricacao": 2024,
      "estadoFisico": "BOM_ESTADO",
      "pesoQuilogramas": "2.500",
      "valorAquisicao": "3500.00"
    }
  ]
}
```

Esperado: HTTP `201`, identificador público `gcl_...`, status `RECEBIDO` e quantidade de equipamentos igual a 1. Guarde `identificadorPublico` como `<lotePublico>`. A submissão utiliza transação, referência externa, idempotência e auditoria. Para testar lote sem equipamentos, remova `equipamentos` e use novo externalId e novo `Idempotency-Key`; isso só é permitido quando `permiteLoteSemEquipamentos` estiver habilitado.

### 4.2 READ — Listar lotes próprios

Execute:

```text
GET /api/v1/public/lotes?page=1&pageSize=20&status=RECEBIDO
```

Filtros disponíveis: `status`, `externalId`, `dataEntradaDe`, `dataEntradaAte` e `ativo`, além de `page` e `pageSize`. A resposta contém `data` e `meta` (`page`, `pageSize`, `total`, `totalPages`). Somente lotes pertencentes ao parceiro autenticado e em organizações com vínculo ativo podem aparecer.

### 4.3 READ — Consultar lote

Execute:

```text
GET /api/v1/public/lotes/<lotePublico>
```

Esperado: HTTP `200`, com identificador público, referência externa do parceiro, status, ativação, versão, datas, nota fiscal, transportadora, observações e quantidade de equipamentos. Essa resposta é uma visão de gestão; não contém movimentações ou histórico detalhado.

### 4.4 UPDATE — Alterar campos permitidos

Execute `PATCH /api/v1/public/lotes/{identificadorPublico}`:

```json
{
  "versaoEsperada": 1,
  "notaFiscal": "NF-AV3-001-RETIFICADA",
  "observacoes": "Nota fiscal corrigida antes do início da triagem"
}
```

Esperado: HTTP `200` e versão incrementada para 2. Os únicos campos editáveis são `notaFiscal`, `transportadora` e `observacoes`. O parceiro não pode alterar organização, identificadores, referências externas, estados internos, movimentações ou operadores. A edição só é permitida para lote ativo em `RECEBIDO`, sem triagem ou movimentação iniciada.

Para demonstrar concorrência otimista, repita a atualização usando `versaoEsperada` antiga. Esperado: HTTP `409`. Consulte novamente o lote para obter a versão vigente antes de uma nova alteração.

### 4.5 DELETE — Cancelar logicamente

O cancelamento é uma operação `DELETE`, mas não apaga fisicamente dados. Execute com a versão atual:

```http
DELETE /api/v1/public/lotes/<lotePublico>
Content-Type: application/json
```

```json
{
  "versaoEsperada": 2
}
```

Esperado: HTTP `200`, `ativo: false`, status público `CANCELADO` e versão incrementada. O registro, equipamentos e histórico são preservados. Um lote que já iniciou triagem ou movimentação não pode ser cancelado pelo parceiro; o resultado esperado nesse caso é HTTP `409`. Repetir a mesma operação depois de o cancelamento ter sido concluído retorna o estado cancelado sem excluir o recurso novamente.

## 5. Rastreabilidade, idempotência e autorização

### Rastreabilidade

Com escopo `rastreabilidade:read`, execute:

```text
GET /api/v1/public/rastreabilidade/lotes/<lotePublico>
GET /api/v1/public/rastreabilidade/external/erp-av3-lote-001
```

A resposta detalhada contém `historicoOperacional`, equipamentos e movimentações permitidas. Não deve expor CNPJ, IDs internos de usuário/organização, códigos de barras internos, hashes ou segredos de API Key. A API verifica também a propriedade do lote pelo parceiro; conhecer o identificador público de outro parceiro não concede acesso.

### Idempotência

Repita `POST /api/v1/public/lotes` com o mesmo conteúdo e o mesmo `Idempotency-Key`. Esperado: o mesmo lote original, sem duplicação. Reutilize a chave com conteúdo diferente. Esperado: HTTP `409`. O mesmo princípio de unicidade por parceiro se aplica a `externalId`.

### Escopos e revogação

Crie uma API Key adicional com escopo somente `lotes:write` e tente executar `GET /api/v1/public/lotes`. Esperado: HTTP `403`, por ausência de `lotes:read`. Escopos efetivos são a interseção das permissões do parceiro e da chave.

Para revogar uma chave, execute `POST /api/v1/parceiros/{parceiroId}/chaves/{apiKeyId}/revogacao` com JWT de administrador. Chamadas subsequentes usando aquela chave devem responder `401`; outras chaves ativas não são revogadas automaticamente. Para revogar a associação organizacional, use `DELETE /api/v1/parceiros/{parceiroId}/organizacoes/{associacaoId}`. O identificador de integração deixa de autorizar novas operações.

### Isolamento entre parceiros

Cadastre um segundo parceiro com `lotes:read` e `rastreabilidade:read`, vincule-o à mesma organização e gere uma chave própria. Tente consultar o lote criado pelo primeiro parceiro. Esperado: HTTP `404`. O vínculo à mesma organização não transfere propriedade de recursos submetidos por outro parceiro.

## 6. Demonstrar relatórios assíncronos

Com uma chave que possua `reports:read` e `reports:write`, execute `POST /api/v1/public/relatorios` com `X-API-Key` e `X-Integration-ID`:

```json
{
  "tipo": "equipamentos",
  "formato": "JSON"
}
```

Os tipos disponíveis são `operacional`, `equipamentos`, `triagem`, `rentabilidade` e `vida-util`; os formatos são `CSV` e `JSON`. A organização vem do vínculo ativo, não de um UUID no body. Esperado: HTTP `202 Accepted`, com ID da tarefa e estado inicial `PENDING`.

A solicitação e o evento Outbox são persistidos na mesma transação. O worker publica o job no Redis/BullMQ, processa o conteúdo e grava o arquivo. Consulte o estado com:

```text
GET /api/v1/public/relatorios/<reportId>
```

Repita até o estado `COMPLETED`; enquanto estiver `PENDING` ou `PROCESSING`, o arquivo ainda não está pronto. Baixe com:

```text
GET /api/v1/public/relatorios/<reportId>/download
```

A rota verifica o checksum SHA-256 antes de transmitir o arquivo. Um relatório não concluído não deve ser tratado como disponível para download. O serviço interno também oferece `POST /api/v1/relatorios/async` e rotas administrativas de consulta, reprocessamento e download para `ADMINISTRADOR` e `AUDITOR`.

## 7. Rotas principais por função

| Área | Rotas | Acesso |
|---|---|---|
| Saúde e documentação | `GET /health`, `/docs/`, `/docs/json` | Público |
| Autenticação interna | `POST /api/v1/auth/login` e rotas de sessão | JWT conforme rota |
| Parceiros | `/api/v1/parceiros` e subrotas `organizacoes` e `chaves` | JWT `ADMINISTRADOR` |
| Lotes internos | `/api/v1/lotes` e subrotas | JWT/RBAC |
| Equipamentos | `/api/v1/equipamentos` e subrotas | JWT/RBAC |
| API pública de lotes | `/api/v1/public/lotes` | API Key + escopo correspondente |
| Rastreabilidade pública | `/api/v1/public/rastreabilidade/...` | API Key + `rastreabilidade:read` |
| Relatórios públicos | `/api/v1/public/relatorios` | API Key + `reports:read`/`reports:write` |
| Relatórios internos | `/api/v1/relatorios/async` | JWT `ADMINISTRADOR` ou `AUDITOR` |

O Swagger é a referência para schemas, headers, query parameters, exemplos e códigos HTTP de cada operação.

## 8. Testes negativos recomendados

| Situação | Resultado esperado |
|---|---|
| JWT ou API Key ausente/inválido/revogado | `401` |
| Usuário sem papel administrativo gerencia parceiro | `403` |
| Chave sem escopo necessário | `403` |
| Parceiro consulta lote de outro parceiro, mesmo na mesma organização | `404` |
| Referência externa ou Idempotency-Key reutilizada com conteúdo divergente | `409` |
| Versão esperada antiga em PATCH/DELETE | `409` |
| Lote com triagem iniciada submetido a cancelamento | `409` |
| Limite de requisições excedido | `429` com `Retry-After` |
| Payload acima do limite contratado | `413` |
| Campos não permitidos no PATCH | `400` |

## 9. Testes automatizados

### Unitários

```bash
npm run test:unit
```

O comando gera o Prisma Client, compila TypeScript e executa os arquivos `dist/src/tests/*.test.js`. Inclui cálculos analíticos, validações e fluxos controlados por doubles.

### Demonstração com entradas e saídas

```bash
npm run test:demonstracao
```

O mecanismo apresenta por cenário identificação, tipo de teste, dependências, entrada, resultado esperado, resultado obtido, validações, duração e status. Atualiza `docs/evidencias-testes-av3.md`, preservando execuções anteriores. Valores sensíveis são redigidos antes de irem ao terminal ou arquivo.

A demonstração HTTP utiliza as rotas Fastify reais, mas controladores, repositórios ou rate limiter podem ser doubles. Cada cenário indica suas dependências; isso não deve ser descrito como teste PostgreSQL/Redis real.

### Integração com PostgreSQL e Redis

A suíte de integração exige Node.js 24, PostgreSQL 17 e Redis 7. Configure `DATABASE_URL` para um banco dedicado com `test` no nome e `REDIS_URL` para Redis isolado. O teste de relatórios confirma também `current_database()` antes de criar dados e recusa bases que não pareçam ser de teste.

Com Docker Compose:

```bash
docker compose --profile tests up -d postgres-test redis-test
docker compose --profile tests run --rm test-runner
```

O serviço `test-runner` aplica migrations e seed no banco `greencode_test` usando o cliente gerado na imagem e executa `npm run test:integration:dist`. Para rodar apenas integração a partir de um ambiente já preparado, use `npm run test:integration`; esse comando gera o cliente, compila o projeto e inicia os testes.

### Pipeline completo local

```bash
npm run test:av3
```

O comando executa validação do Prisma, um build, a suíte unitária, a demonstração e a suíte de integração em sequência. A integração ainda precisa dos serviços e variáveis dedicados.

## 10. CI e registro dos resultados

O workflow `.github/workflows/ci.yml` usa Node.js 24, PostgreSQL 17 e Redis 7 como serviços do job. Ele valida o Prisma, aplica migrations e seed uma vez, constrói o projeto, executa unitários e demonstração, roda os testes de integração e publica `docs/evidencias-testes-av3.md` como artifact do GitHub Actions.

Uma execução local ou no CI comprova somente os comandos que chegaram a executar e os cenários que reportaram resultado. Um serviço indisponível ou teste bloqueado deve ser registrado como bloqueado/não executado, nunca como aprovado.

## 11. Encerrar o ambiente

Para parar sem remover dados:

```bash
docker compose down
```

Para descartar os volumes locais e iniciar a aplicação limpa:

```bash
docker compose down -v
docker compose up --build -d
```

`down -v` apaga os volumes de dados do projeto Compose. Só execute quando os dados existentes puderem ser descartados.
