# GreenCode AV3

Plataforma de logística reversa de equipamentos eletrônicos. A AV3 evolui o monólito modular anterior com indicadores analíticos, API pública para parceiros e processamento assíncrono de relatórios.

## Stack

Node.js 24, TypeScript, Fastify 5, Prisma ORM 7, PostgreSQL 17, Redis 7, BullMQ 5, `simple-statistics`, Swagger/OpenAPI e Docker Compose.

## Pré-requisitos

- **Windows:** Windows 10 ou superior e Docker Desktop instalado/iniciado; WSL2 e virtualização habilitados quando o Docker Desktop utilizar o backend WSL2. Docker Compose é fornecido pelo Docker Desktop.
- **Linux:** Ubuntu 24.04 LTS ou superior, ou distribuição derivada do Ubuntu compatível com Docker Engine e o plugin Docker Compose.
- Arquivo `.env` baseado em `.env.example`.
- Para execução npm local, além do Docker opcional: Node.js 24 (`>=24 <25`), PostgreSQL 17 e Redis 7.

A compatibilidade descrita indica os pré-requisitos esperados; não significa que todas as versões e distribuições derivadas tenham sido individualmente testadas. Com Docker Compose, Node.js, PostgreSQL e Redis não precisam estar instalados diretamente no host.

## Instalação e inicialização

Na raiz do repositório:

```bash
cp .env.example .env
# Edite .env: defina POSTGRES_PASSWORD, JWT_SECRET e credenciais bootstrap.
docker compose config -q
docker compose up --build -d
docker compose ps
```

O Compose inicia PostgreSQL, Redis, API e worker. A API executa as migrations de produção e o seed conforme o comando do container. Para acompanhar os serviços:

```bash
docker compose logs -f api
docker compose logs -f worker
```

A aplicação local fica disponível em:

- Swagger UI: `http://localhost:3000/docs/`
- OpenAPI JSON: `http://localhost:3000/docs/json`
- Health check: `http://localhost:3000/health`

## Execução local sem Docker

Com Node 24, PostgreSQL 17 e Redis 7 em execução, configure `.env` e instale dependências:

```bash
npm ci
npm run prisma:validate
npm run prisma:generate
npm run db:deploy
npm run db:seed:generated
```

Como o Prisma Client já foi gerado na etapa anterior, essa sequência usa `db:seed:generated` para não repetir a geração. Quando precisar executar o seed isoladamente, use `npm run db:seed`; esse comando gera o cliente antes de chamar `prisma db seed`.

Em terminais separados:

```bash
npm run dev
npm run dev:worker
```

Para execução compilada:

```bash
npm run build
npm start
npm run start:worker
```

## O que a AV3 entrega

- **Análises:** eficiência operacional, estimativa de recuperação/rentabilidade e previsão de vida útil remanescente.
- **API pública:** versionada em `/api/v1/public`, autenticada com API Keys, escopos efetivos, identificação de organização e rate limiting compartilhado no PostgreSQL.
- **Processamento assíncrono:** filas BullMQ/Redis, worker separado, Outbox transacional, consulta de estado e download de relatórios CSV/JSON.
- **Compatibilidade:** rotas operacionais da AV2 permanecem disponíveis; sessões legadas não são tratadas como tempo AV3 mensurável.

## Testes

```bash
npm run test:unit
npm run test:demonstracao
npm run test:integration
```

A integração exige os serviços de teste dedicados e `DATABASE_URL` apontando para banco cujo nome contenha `test`. Pelo Compose:

```bash
docker compose --profile tests up -d postgres-test redis-test
# Em outro terminal, com o .env e serviços de teste configurados:
npm run test:integration
```

Nunca aponte testes automatizados ao banco principal. A demonstração usa serviços reais do domínio quando possível e declara explicitamente os cenários com repositórios/autenticadores simulados. Ao executar `npm run test:demonstracao`, o terminal e `docs/evidencias-testes-av3.md` recebem os valores realmente observados.

## Documentação principal

- [Relatório técnico AV3](docs/relatorio-tecnico-av3.md): arquitetura, decisões, métricas, limitações e escalabilidade.
- [Guia do professor](docs/guia-de-testes-professor.md): inicialização, jornada de demonstração e comandos de validação.
- [Decisões arquiteturais](docs/decisoes-arquiteturais.md): decisões, alternativas e histórico dos ADRs.
- [Evidências de demonstração](docs/evidencias-testes-av3.md): preenchido pelo comando de demonstração após uma execução real.
- [Inventário da entrega](docs/inventario.md): estrutura do pacote e conteúdo regenerado ou excluído.

## Segurança operacional

Não versione `.env`, não compartilhe API Keys ou JWTs e use credenciais próprias para avaliação. O segredo completo da API Key é exibido uma única vez durante sua criação; somente o hash é persistido.
