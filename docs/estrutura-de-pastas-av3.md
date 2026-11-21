# Estrutura de pastas — GreenCode AV3

Este documento explica onde ficam o código, as migrations, os testes e a documentação mantida no repositório. A documentação atual do produto é a documentação AV3 em `docs/`; não há necessidade de manter uma cópia paralela dos documentos funcionais da AV2. Os módulos e o histórico de banco existentes continuam sendo a fundação técnica do sistema.

## Estrutura principal

| Caminho | Responsabilidade |
|---|---|
| `README.md` | Apresentação, execução inicial, rotas públicas e comandos de teste |
| `docs/` | Visão do produto, requisitos, arquitetura, dados, histórias, plano, relatório e guia de testes AV3 |
| `docs/adr/` | Decisões arquiteturais AV3; numeração existente preservada |
| `prisma/schema.prisma` | Schema atual dos modelos operacionais e de integração |
| `prisma/migrations/` | Histórico de migrations; alterações AV3 em migration nova |
| `prisma/seed.ts` | Administrador inicial e massa demonstrativa de organizações, contratos, lotes e equipamentos |
| `src/config/` | Leitura e validação das variáveis de ambiente |
| `src/docs/` | Recursos estáticos utilizados pelo Swagger UI |
| `src/infrastructure/database/` | Criação e configuração do cliente Prisma/PostgreSQL |
| `src/modules/auth/` | JWT, login e sessão dos usuários internos |
| `src/modules/usuarios/` | Cadastro e administração de usuários |
| `src/modules/organizacoes/` | Cadastro e manutenção de organizações |
| `src/modules/contratos/` | Vigência e histórico contratual |
| `src/modules/lotes/` | Recebimento e ciclo operacional de lotes |
| `src/modules/equipamentos/` | Cadastro e estados dos equipamentos |
| `src/modules/movimentacoes/` | Histórico de movimentações |
| `src/modules/parceiros/` | CRUD administrativo de parceiros, associações e ciclo de vida das chaves |
| `src/modules/integracoes/` | Geração/verificação de API Key, escopos, hash canônico e rate limiting |
| `src/modules/api-publica/` | Autenticação externa, submissão e consulta de rastreabilidade |
| `src/modules/analytics/` | Serviços analíticos, persistência histórica, OLS e backtesting |
| `src/modules/triagem/` | Sessões, ocorrências e conclusão de triagem |
| `src/modules/historico-equipamentos/` | Falhas, manutenção, depreciação e recuperação |
| `src/modules/relatorios-async/` | Solicitação, status, sanitização, geração e download de relatórios |
| `src/infrastructure/queue/` | Redis, BullMQ, Outbox e agendamento recorrente |
| `src/modules/auditoria/` | Registro e consulta de auditoria existente ampliada |
| `src/modules/relatorios/` | Relatórios operacionais/financeiros disponíveis na base atual |
| `src/modules/parametros/` | Parâmetros globais |
| `src/tests/` | Testes unitários e HTTP |
| `src/tests/integration/` | Testes que exigem PostgreSQL dedicado com `test` no nome da base |
| `src/app.ts` | Registro dos módulos, hooks, tratamento de erros e OpenAPI |
| `src/server.ts` | Inicialização do servidor e conexão com o banco |
| `package.json` / `package-lock.json` | Metadados, scripts e dependências do projeto |
| `Dockerfile` / `docker-compose.yml` | Imagem da aplicação, banco principal e ambiente isolado de testes |
| `.env.example` | Valores locais de exemplo, sem credenciais de produção |

## Organização dos módulos novos

```text
src/modules/
  parceiros/       # gestão administrativa de parceiros, organizações e chaves
  integracoes/     # segurança de API Key, escopos, hash e rate limit
  api-publica/     # autenticação externa, submissão e rastreabilidade
  auditoria/       # estrutura já existente ampliada para atores externos
```

A autenticação JWT interna permanece separada da API Key pública. O ciclo administrativo das chaves fica no módulo `parceiros`, evitando duplicar a gestão do parceiro. Os serviços novos ainda possuem acessos diretos a Prisma em pontos documentados no [relatório técnico](relatorio-tecnico-av3.md); a arquitetura operacional existente utiliza Repository.

## Estado atual e pendências

As pastas de analytics, triagem, histórico de equipamentos, relatórios assíncronos e infraestrutura de filas já fazem parte da implementação AV3. A execução integrada dessas funcionalidades depende da homologação em Node 24, PostgreSQL e Redis. A presença dos módulos no repositório não equivale a testes de infraestrutura aprovados.
