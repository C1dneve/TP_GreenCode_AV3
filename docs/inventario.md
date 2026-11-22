# Inventário — GreenCode AV3

Este documento resume a organização do repositório e a finalidade dos arquivos principais da AV3.

## Aplicação e configuração

- `src/`: API Fastify, módulos de negócio, análises, autenticação, fila, worker e testes.
- `prisma/schema.prisma`: modelos, enums e configuração do Prisma Client.
- `prisma/migrations/`: histórico de migrations versionadas.
- `prisma/seed.ts`: carga inicial idempotente para ambiente preparado.
- `prisma.config.ts`: caminhos do schema/migrations e comando de seed do Prisma.
- `package.json` e `package-lock.json`: scripts e dependências fixadas.
- `tsconfig.json`: compilação ESM/NodeNext, incluindo reescrita das importações TypeScript para a saída JavaScript.

## Execução e infraestrutura

- `Dockerfile`: geração do Prisma Client e build da imagem Node.js 24.
- `docker-compose.yml`: API, worker, PostgreSQL 17, Redis 7 e serviços isolados de testes.
- `.env.example`: nomes e formatos das variáveis necessárias, sem credenciais válidas.
- `.github/workflows/ci.yml`: pipeline com validação Prisma, banco e Redis de teste, testes e artifact de evidências, além do smoke test Docker Compose.

## Documentação

- `README.md`: instalação e execução rápida.
- `docs/relatorio-tecnico-av3.md`: visão técnica da solução.
- `docs/decisoes-arquiteturais.md`: ADRs e justificativas.
- `docs/guia-de-testes-professor.md`: procedimentos de demonstração e validação.
- `docs/evidencias-testes-av3.md`: histórico append-only das execuções demonstrativas e resumos do CI.
- `docs/arquivos-entrega.md`: este inventário.

## Conteúdo regenerado ou excluído do pacote

O Prisma Client em `src/generated/prisma/` é gerado por `npm run prisma:generate` e permanece no `.gitignore`; não deve ser versionado. O pacote de entrega não deve incluir `.env` real, `.git`, `node_modules` ou `dist`. As migrations e o lockfile devem ser preservados.
