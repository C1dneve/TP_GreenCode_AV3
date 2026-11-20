# Estrutura de pastas — base AV2 e evolução AV3

Esta tabela reflete a estrutura observada no ZIP `TP_GreenCode_AV2-main.zip` enviado em 20/11/2026. A orientação é manter os caminhos atuais e acrescentar novos módulos dentro dos mesmos padrões. Os nomes dos novos arquivos são propostas, não arquivos já implementados.

| Caminho AV2 | Ação na AV3 | Conteúdo / orientação |
|---|---|---|
| `.github/workflows/` | Manter e ampliar | CI deve incluir Postgres, Redis, migrations, testes de API e worker nas fases correspondentes |
| `docs/` | Ampliar | Adicionar os documentos AV3 deste pacote; preservar documentos AV2 como histórico |
| `docs/adr/` | Ampliar | Novas decisões numeradas após ADR-0004; não sobrescrever ADRs AV2 |
| `prisma/` | Ampliar | Estender schema e criar migrations versionadas |
| `prisma/migrations/` | Manter e ampliar | Nunca reescrever migration já aplicada; novas migrations para AV3 |
| `scripts/` | Manter e ampliar se necessário | Scripts operacionais/migração/fixtures, sem duplicar responsabilidades |
| `src/config/` | Ampliar | Configuração de Redis, worker, analytics e variáveis públicas nas fases correspondentes |
| `src/docs/` | Manter/ampliar | CSS/recursos do Swagger; documentar tags e schemas públicos |
| `src/infrastructure/database/` | Manter | Prisma existente |
| `src/infrastructure/` | Ampliar | Adicionar integração BullMQ/Redis e storage se necessário |
| `src/modules/auditoria/` | Ampliar no primeiro passo | Ampliar `EventoAuditoria` existente e seu repositório/serviço para atores externos; preservar consultas e eventos AV2 |
| `src/modules/auth/` | Manter com cuidado | Preservar JWT interno; API Key deve ter contexto/módulo próprio para não misturar ciclos de vida |
| `src/modules/parceiros/` | Criar no primeiro passo | CRUD administrativo, escopos máximos, limites e associação com organizações |
| `src/modules/api-keys/` | Criar no primeiro passo | Emissão, hash, expiração, revogação e autenticação/validação de chaves |
| `src/modules/api-publica/` | Criar no primeiro passo | Rotas públicas versionadas, submissão, rastreabilidade e contratos externos |
| `src/modules/contratos/` | Manter | Preservar domínio AV2 |
| `src/modules/equipamentos/` | Ampliar quando necessário | Consulta autorizada para rastreabilidade; instrumentação histórica/analítica somente na fase analítica |
| `src/modules/lotes/` | Ampliar no primeiro passo | Submissão externa transacional e resolução por referência do parceiro; preservar regras de domínio AV2 |
| `src/modules/movimentacoes/` | Manter/ampliar | Reutilizar histórico real para consultas de rastreabilidade e análises quando semanticamente adequado |
| `src/modules/organizacoes/` | Ampliar no primeiro passo | Consultas de autorização de organizações por parceiro |
| `src/modules/parametros/` | Ampliar se necessário | Parâmetros analíticos e expiração somente se forem configurações globais |
| `src/modules/relatorios/` | Ampliar na fase posterior | Solicitação assíncrona, status, histórico, expiração e download |
| `src/modules/analytics/` | Criar na fase analítica | Cálculos analíticos, persistência de resultados e consultas |
| `src/modules/jobs/` | Criar na fase assíncrona | Casos de uso para criação/consulta de execuções; worker consome serviços sem duplicar regras |
| `src/modules/usuarios/` | Manter | Gestão de usuários internos |
| `src/shared/` | Ampliar com parcimônia | Tipos/helpers realmente transversais; evitar regra de negócio genérica |
| `src/tests/` | Ampliar | Unitários, HTTP, autorização e integração |
| `src/tests/integration/` | Ampliar | PostgreSQL, API Keys, isolamento e idempotência no primeiro passo; Redis/worker nas fases posteriores |
| `src/app.ts` | Ampliar | Registrar módulos/rotas, sem colocar regras de negócio no bootstrap |
| `src/server.ts` | Manter/ampliar | Processo HTTP e encerramento gracioso |
| `package.json` | Alterar na implementação | Dependências/scripts de API Keys/rate limit e, nas fases posteriores, BullMQ/Redis e worker |
| `package-lock.json` | Regenerar na implementação | Sempre sincronizado com package.json |
| `Dockerfile` | Avaliar/ampliar | Suportar execução API e worker por comandos/targets adequados quando worker for implementado |
| `docker-compose.yml` | Ampliar nas fases necessárias | Adicionar Redis e serviço worker sem remover serviços/volumes existentes |
| `.env.example` | Ampliar | Variáveis documentadas, valores demonstrativos e sem segredos |
| `.gitignore` / `.dockerignore` | Revisar | Ignorar artefatos, arquivos temporários e segredos |
| `README.md` | Atualizar na cópia AV3 | Basear no README AV2; descrever arquitetura e operação AV3 |
| `tsconfig.json`, `prisma.config.ts`, `.nvmrc` | Preservar | Não trocar configurações funcionais sem necessidade |

## Novos módulos sugeridos

Seguir o padrão controller/service/repository/module/routes já utilizado:

```text
src/modules/
  parceiros/       # primeiro grande passo
  api-keys/        # primeiro grande passo
  api-publica/     # primeiro grande passo
  analytics/       # fase analítica
  jobs/            # fase assíncrona
  relatorios/      # ampliar módulo existente na fase de relatórios
src/infrastructure/
  queue/           # fase assíncrona
  storage/         # somente se houver armazenamento externo/abstração real
```

### Observações de organização

- `api-publica` agrupa rotas e contratos externos; autenticação por API Key deve ser um plugin/hook reutilizável.
- `api-keys` gerencia ciclo de vida e validação de chaves; não armazena segredo em claro.
- `parceiros` concentra CRUD, configurações, escopos máximos, limites e organizações autorizadas.
- A auditoria externa amplia `EventoAuditoria` e seus serviços/repositórios existentes; não criar módulo/tabela paralela sem justificativa e ADR.
- As permissões efetivas da API Key são a interseção entre escopos do parceiro e escopos da chave.
- A submissão pública deve reutilizar os serviços/regras de domínio de lotes e equipamentos sempre que possível; não duplicar regras de negócio nos controllers públicos.
- A rastreabilidade pública deve projetar apenas os campos autorizados; não expor diretamente objetos Prisma completos.
- `analytics` concentra serviços de cálculo e persistência de resultados.
- `jobs` concentra casos de uso para criação/consulta de execuções; o worker consome serviços dos módulos, sem duplicar regras.
- Se o padrão real do projeto justificar outra divisão, registrar ADR antes de alterar estrutura.

## Árvore-alvo resumida

```text
.
├── .github/workflows/
├── docs/
│   └── adr/
├── prisma/
│   └── migrations/
├── scripts/
└── src/
    ├── config/
    ├── docs/
    ├── infrastructure/
    │   ├── database/
    │   ├── queue/              # fase assíncrona
    │   └── storage/            # opcional
    ├── modules/
    │   ├── auditoria/
    │   ├── auth/
    │   ├── api-keys/
    │   ├── api-publica/
    │   ├── analytics/
    │   ├── parceiros/
    │   ├── jobs/
    │   ├── contratos/
    │   ├── equipamentos/
    │   ├── lotes/
    │   ├── movimentacoes/
    │   ├── organizacoes/
    │   ├── parametros/
    │   ├── relatorios/
    │   └── usuarios/
    ├── shared/
    ├── tests/
    │   └── integration/
    ├── app.ts
    └── server.ts
```
