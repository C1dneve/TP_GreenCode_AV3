# GreenCode AV3: história, estrutura e arquitetura

## O que é o GreenCode

O GreenCode apoia a logística reversa de equipamentos eletrônicos. O sistema registra organizações, contratos, lotes recebidos, equipamentos e movimentações, mantendo o histórico necessário para acompanhar o ciclo operacional e consultar informações do processo.

## Da AV2 para a AV3

A AV2 consolidou o backend como uma API REST com autenticação de usuários, permissões por papel, persistência em PostgreSQL e auditoria. A AV3 amplia esse produto em duas direções: integrações externas com organizações parceiras e uma camada analítica/preditiva para apoiar decisões operacionais.

A AV3 mantém o domínio operacional existente. As rotas internas continuam utilizando JWT e RBAC; os parceiros externos utilizam API Keys, escopos próprios e vínculos explícitos com as organizações que podem acessar. A API pública é versionada e não expõe diretamente as rotas administrativas ou internas.

O primeiro incremento concentra-se na fundação das integrações: cadastro e administração de parceiros, associação de organizações, emissão e revogação de API Keys, submissão pública de lotes e consulta de rastreabilidade. A camada analítica e o processamento assíncrono permanecem planejados para etapas posteriores.

## O que o sistema faz nesta etapa

- Mantém usuários internos, seus papéis e a autorização das operações administrativas.
- Mantém organizações, contratos, lotes, equipamentos e movimentações do fluxo operacional.
- Permite ao Administrador cadastrar e administrar parceiros externos.
- Autoriza um parceiro a operar somente nas organizações associadas a ele.
- Emite várias API Keys por parceiro, com escopos, validade opcional, limites e revogação individual.
- Recebe lotes enviados por parceiros, com ou sem equipamentos, em uma transação única.
- Evita duplicidade por `Idempotency-Key` e por `externalId` dentro do contexto do parceiro.
- Disponibiliza rastreabilidade pública por identificador GreenCode ou referência externa do parceiro.
- Registra operações internas e externas na estrutura de auditoria existente.

## Arquitetura em poucas palavras

O GreenCode AV3 continua sendo um **monólito modular**: a aplicação é entregue como um único serviço HTTP, mas o código é separado por responsabilidades e áreas de negócio.

```text
Cliente interno / Swagger / Sistema parceiro
                  ↓
             Fastify / Rotas
                  ↓
       Controllers e autenticação
                  ↓
       Services e regras de domínio
                  ↓
        Repositories / Prisma
                  ↓
             PostgreSQL
```

As rotas internas usam JWT/RBAC. As rotas administrativas de parceiros exigem o papel `ADMINISTRADOR`. As rotas públicas usam API Key e verificam escopos efetivos e associação ativa com a organização. Os módulos operacionais continuam utilizando o padrão Controller-Service-Repository. Nos módulos novos de parceiros e API pública, parte da persistência é acessada diretamente pelos services e transações Prisma; essa divergência está registrada para refatoração antes da expansão dos casos de uso.

## Tecnologias

- **Node.js 24 e TypeScript:** ambiente de execução e linguagem.
- **Fastify 5:** servidor HTTP, rotas e validação dos contratos.
- **Prisma 7:** acesso tipado ao banco e migrações versionadas.
- **PostgreSQL 17:** armazenamento principal dos dados e das regras de integridade.
- **JWT e bcrypt:** sessão dos usuários internos e proteção de senhas.
- **API Keys:** autenticação dos sistemas parceiros, com segredo exibido uma única vez e persistido somente como hash.
- **Swagger/OpenAPI:** documentação interativa das rotas internas, administrativas e públicas.
- **Docker Compose:** inicialização reproduzível da API, do PostgreSQL e do ambiente de testes.

## Organização do código

Dentro de `src/`, cada módulo concentra uma parte do sistema:

| Módulo | Responsabilidade |
|---|---|
| `auth` | Login, sessão, logout e troca de senha de usuários internos |
| `usuarios` | Cadastro, consulta e administração dos usuários |
| `organizacoes` | Cadastro e manutenção das organizações |
| `contratos` | Vigência, renovação e histórico contratual |
| `lotes` | Recebimento, triagem, encaminhamento e finalização |
| `equipamentos` | Cadastro, condição física e estados de rastreamento |
| `movimentacoes` | Histórico de deslocamento dos equipamentos |
| `parceiros` | Gestão administrativa de parceiros, vínculos e API Keys |
| `integracoes` | Geração/verificação de chaves, escopos, hash canônico e rate limiting |
| `api-publica` | Autenticação externa, submissão de lotes e rastreabilidade |
| `auditoria` | Consulta e registro dos eventos relevantes |
| `relatorios` | Relatórios operacionais e financeiros existentes na base |
| `parametros` | Parâmetros globais utilizados pelo domínio |

O schema e as migrations ficam em `prisma/`; os testes automatizados ficam em `src/tests/`; os documentos de produto e decisões ficam em `docs/`.

## Dados e relações principais

Uma organização pode possuir vários contratos históricos e receber lotes. Cada lote pode conter equipamentos, e cada equipamento mantém suas movimentações. Na AV3, um parceiro pode estar associado a várias organizações, mas cada associação precisa ser autorizada explicitamente e possui um identificador público de integração.

Um parceiro pode possuir várias API Keys. A permissão efetiva de cada chave é a interseção dos escopos do parceiro com os escopos específicos da chave. A chave não amplia o acesso concedido ao parceiro. Os registros de idempotência e de referência externa são isolados por parceiro e apontam para o lote criado ou reutilizado.

Os eventos de auditoria continuam na estrutura `EventoAuditoria`. A AV3 acrescenta campos opcionais para identificar ator externo, parceiro, API Key e organização, sem apagar o relacionamento com usuários internos.

## Regras que orientam o funcionamento

- Rotas internas continuam protegidas por JWT e RBAC.
- Somente o Administrador pode gerir parceiros, associações e API Keys.
- Parceiros só acessam organizações com vínculo ativo e organização ativa.
- Escopos efetivos são calculados por `escoposParceiro ∩ escoposApiKey` em cada requisição.
- O segredo completo da API Key é mostrado somente na criação; o banco armazena o hash SHA-256.
- A API pública usa `X-API-Key`; submissões também exigem `X-Integration-ID` e `Idempotency-Key`.
- Submissões de lote e equipamentos são atômicas: tudo é salvo ou nada é salvo.
- A mesma chave de idempotência e o mesmo conteúdo retornam o resultado original; conteúdo divergente gera `409`.
- A mesma referência externa e o mesmo conteúdo reutilizam o lote original no contexto do parceiro.
- A rastreabilidade pública não expõe CNPJ, dados pessoais, IDs internos, códigos de barras internos, credenciais ou dados de outros parceiros.
- O rate limiting usa contadores em memória do processo nesta etapa; não é distribuído entre instâncias.
- Migrations são versionadas e as migrations anteriores não devem ser reescritas.

## O que ainda não está implementado

A AV3 completa também prevê indicadores de eficiência operacional, estimativa de recuperação, previsão de vida útil remanescente e processamento assíncrono de relatórios. Essas funcionalidades exigem instrumentação e modelos de dados específicos e serão desenvolvidas nos próximos grandes passos.

Neste incremento não há Redis, BullMQ, workers, scheduler, webhooks, solicitação de relatórios pela API pública nem download de artefatos. O registro técnico e o [plano de implementação](plano-de-implementacao-av3.md) distinguem essas entregas futuras do que já está no código.

## Execução e testes

A forma recomendada de iniciar a aplicação e executar os testes é Docker Compose, no Windows 10 ou superior e Ubuntu 24.04 ou superior. O roteiro detalhado está no [Guia de execução e testes](guia-de-testes-professor.md). O [README](../README.md) contém os comandos iniciais.
