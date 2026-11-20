# GreenCode AV3

## Objetivo da AV3

A AV3 amplia o monólito modular da AV2 para uma plataforma que transforma dados operacionais em indicadores e previsões, disponibiliza uma API pública documentada para parceiros e executa tarefas demoradas em segundo plano.

## Pilares da atividade

1. **Camada analítica:** eficiência operacional, rentabilidade estimada por tipo de equipamento e previsão de vida útil remanescente.
2. **API pública documentada:** autenticação por API Key, limites de requisição, permissões, consulta de rastreabilidade, submissão de novos lotes e acesso a relatórios analíticos.
3. **Processamento assíncrono:** filas para análises e relatórios, identificador de tarefa, consulta de status e acesso ao resultado.


## Decisões 

- API interna autenticada por JWT e API pública autenticada por API Key.
- Um parceiro pode ter várias chaves, individualmente identificáveis e revogáveis; o segredo é exibido uma única vez e armazenado somente como hash.
- Um parceiro pode acessar várias organizações, apenas quando explicitamente autorizado.
- Somente Administrador GreenCode cria parceiros e gerencia chaves.
- As permissões efetivas de uma chave são a interseção entre os escopos concedidos ao parceiro e os escopos da chave; a chave nunca amplia permissões do parceiro.
- Submissões de parceiro podem conter apenas lote ou lote com equipamentos.
- Submissões são atômicas: tudo é persistido ou nada é persistido.
- Idempotência: mesma `Idempotency-Key` e mesmo conteúdo retorna o resultado original; conteúdo divergente com a mesma chave gera HTTP 409. Mesmo `externalId` e mesmo conteúdo reutilizam o recurso; conteúdo divergente com o mesmo `externalId` gera HTTP 409. Os identificadores são únicos no contexto do parceiro.
- A consulta pública de rastreabilidade retorna informações operacionais do lote e, para os equipamentos, tipo, marca, modelo, estado físico, situação atual e histórico relevante de movimentações, respeitando o isolamento e a minimização de dados.
- A política de submissão pode ser configurada por parceiro, sem dispensar validações de domínio.
- Auditoria externa amplia `EventoAuditoria` da AV2, preservando o histórico, e identifica parceiro, chave e organização afetada quando aplicável.
- Previsões individuais e agrupadas, com método, amostra, qualidade/confiança e motivo quando indisponíveis.
- Valor estimado de recuperação separado de valores financeiros efetivamente realizados.
- Relatórios com polling, download autenticado e expiração configurável (padrão de produto: sete dias).
- Indicadores diários, previsões semanais e execução manual.
- Sem webhooks na primeira versão.

## Stack

- Node.js 24
- TypeScript
- Fastify 5
- Prisma ORM 7
- PostgreSQL 17
- Redis + BullMQ (proposta para filas)
- Docker Compose

As versões e compatibilidade efetivas devem ser preservadas e verificadas a partir do `package.json`, lockfile e configuração do projeto AV2. Não atualizar dependências apenas por estarem disponíveis versões mais recentes.

## Execução

Os comandos oficiais devem ser documentados após a implementação da AV3. Não copie comandos que dependam de serviços ainda não adicionados. Consulte `.env.example`, `docker-compose.yml` e `package.json` atualizados no repositório AV3.

## Documentação

Os links abaixo são relativos a este arquivo, localizado em `docs/`:

- [Visão geral AV3](GreenCode-AV3.md)
- [Requisitos e rastreabilidade](requisitos-av3.md)
- [Arquitetura](arquitetura-av3.md)
- [Modelo de dados proposto](modelo-de-dados-av3.md)
- [Épicos e histórias](epicos-e-user-stories-av3.md)
- [Plano de implementação](plano-de-implementacao-av3.md)
- [Relatório técnico](relatorio-tecnico-av3.md)
- [Estrutura de pastas](estrutura-de-pastas-av3.md)
- [ADRs](adr/README.md)
