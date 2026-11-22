# Decisões arquiteturais — GreenCode AV3

Este documento registra decisões que afetam a evolução e a operação do GreenCode. Cada ADR descreve o problema que motivou a escolha, alternativas consideradas, funcionamento na implementação, custos e formas de verificação. O estado indicado diz respeito ao código versionado; a cobertura de testes não deve ser confundida com uma homologação de produção.

## ADR-0005 — API pública, credenciais de integração e controle de consumo

**Decisão:** adotada.  
**Implementação:** `src/modules/api-publica/`, `src/modules/integracoes/` e `src/modules/parceiros/`.  
**Cobertura:** testes de rotas/autorização e testes unitários do autenticador e do rate limiter; os testes PostgreSQL de integração devem ser executados no ambiente descrito no guia.  
**Limitação:** a janela fixa pode permitir rajadas na fronteira entre dois minutos consecutivos.

### Contexto e problema

A API atende dois tipos de identidade. Usuários da operação acessam recursos internos e precisam de sessão, papéis e permissões. Já um sistema parceiro representa uma integração máquina a máquina, não uma pessoa que esteja fazendo login no GreenCode. Reutilizar o JWT de um funcionário para um ERP externo misturaria identidades, ciclo de vida, revogação e autorização diferentes.

Também é necessário limitar o dano de uma credencial vazada, permitir revogação sem depender do vencimento de um token e restringir cada integração às operações contratadas.

### Alternativas consideradas

- Reutilizar o JWT de usuários internos: vincularia a integração à conta de uma pessoa e ao fluxo de autenticação da interface.
- Usar uma chave em texto puro no banco: simplificaria a comparação, mas transformaria um vazamento de banco em vazamento imediato de credenciais utilizáveis.
- Manter limites em memória: simples em uma instância, mas cada réplica contaria requisições separadamente e perderia o estado ao reiniciar.
- Usar Redis para o contador: viável, mas acrescentaria uma dependência de escrita para um recurso que já pode compartilhar o PostgreSQL.

### Decisão adotada e funcionamento

A autenticação interna continua com JWT e RBAC. A API externa utiliza `X-API-Key`, com segredo aleatório produzido por `randomBytes(32)` e codificado em base64url. O valor completo é mostrado somente na criação. O banco persiste o hash SHA-256; a verificação compara os buffers com `timingSafeEqual`. O prefixo `gc_live_` identifica o tipo de credencial, sem substituir a validação criptográfica.

A API Key pertence a um parceiro, e cada uma possui seu próprio conjunto de escopos. Os escopos efetivos são a interseção entre as permissões do parceiro e as permissões da chave. Assim, restringir qualquer um dos dois níveis restringe a chamada seguinte. Chaves podem ser revogadas e possuem metadados próprios, sem expor o segredo após a criação.

O limitador usado nos módulos públicos grava os contadores no PostgreSQL. A chave do contador distingue parceiro e API Key. A janela é fixa, de 60 segundos, alinhada ao minuto calculado a partir do relógio recebido. Um `INSERT ... ON CONFLICT ... DO UPDATE` incrementa atomicamente o contador, evitando o padrão vulnerável de consultar e depois gravar em duas operações. A API aplica o menor limite entre parceiro e chave e, quando excedido, responde `429` com `Retry-After` e os headers `X-RateLimit-*`.

### Consequências

A credencial de integração pode ser criada, restringida e revogada sem depender da sessão de um operador. O armazenamento de hash reduz o impacto de uma leitura indevida da tabela de chaves. Como o contador fica em uma base compartilhada, múltiplas instâncias da API observam a mesma cota.

O custo é uma gravação PostgreSQL para cada consumo contabilizado. Uma janela fixa não suaviza a taxa: um cliente pode consumir parte da cota no fim de um minuto e outra parte logo no início do seguinte. Se a carga de escrita crescer de forma mensurável, Redis ou uma janela deslizante podem ser avaliados, mas a troca deve ser guiada por métricas.

### Verificação

Execute `npm run test:unit` e `npm run test:integration`. Os testes unitários verificam os contratos de autenticação, escopos e contagem. A suíte de integração usa PostgreSQL dedicado para verificar persistência, revogação, isolamento, concorrência e idempotência. O teste demonstrativo de API HTTP usa rotas Fastify com dependências controladas; ele não deve ser apresentado como teste de banco real.

## ADR-0006 — Processamento assíncrono com Outbox, BullMQ e Redis

**Decisão:** adotada.  
**Implementação:** `src/modules/relatorios-async/`, `src/infrastructure/queue/report-queue.ts` e `src/worker.ts`.  
**Cobertura:** testes unitários e um teste de integração dedicado para PostgreSQL, Redis, BullMQ, worker e arquivo; o resultado depende da execução efetiva da suíte de integração.  
**Limitação:** disponibilidade do Redis, armazenamento dos arquivos e observabilidade do worker continuam sendo preocupações operacionais separadas.

### Contexto e problema

A geração de relatórios pode envolver consulta de muitos registros, serialização e escrita de arquivos. Fazer todo esse trabalho dentro da requisição HTTP prende uma conexão, aumenta a latência e torna o resultado sensível a timeout ou desconexão do cliente.

Apenas gravar um registro no PostgreSQL e depois publicar um job no Redis também cria uma janela de falha: a aplicação pode confirmar a transação e cair antes de publicar o job. Se publicar primeiro, pode ocorrer o inverso: o worker recebe um evento cujo registro de negócio não foi confirmado.

### Alternativas consideradas

- Gerar o arquivo dentro da requisição: simples, mas inadequado para tarefas de duração variável.
- Persistir e publicar em duas etapas sem Outbox: deixa uma janela em que o relatório fica sem job ou o job fica sem solicitação confirmada.
- Tratar Redis como fonte de verdade: faria o histórico depender da retenção e disponibilidade da fila.
- Polling de tabela sem fila: reduziria componentes, mas exigiria implementar no banco o agendamento, a distribuição e o controle de concorrência que BullMQ já oferece.

### Decisão adotada e funcionamento

A API valida a solicitação e grava, na mesma transação PostgreSQL, o relatório com estado inicial e o evento correspondente em `OutboxEvento`. A resposta HTTP `202 Accepted` informa que o pedido foi aceito, não que o arquivo já está pronto.

O despachante lê eventos pendentes e os publica em uma fila BullMQ no Redis com identificador de job estável. Depois que a fila aceita o job, o evento recebe `publicadoEm`. Se a publicação falhar, a Outbox mantém o evento pendente, registra o erro e calcula `proximaTentativaEm` com atraso exponencial limitado. A publicação duplicada usa o mesmo identificador, o que torna a operação idempotente no nível da fila.

O worker executa o serviço de relatório e atualiza o estado no PostgreSQL. Relatórios usam cinco tentativas e backoff exponencial inicial de três segundos. O processamento reivindica o relatório por atualização condicional e usa `leaseToken` para impedir que um worker antigo sobrescreva o resultado de outro. Um heartbeat é atualizado periodicamente; uma tarefa `PROCESSING` sem heartbeat recente pode ser recuperada depois de 90 segundos. Arquivos são escritos primeiro em caminho temporário, renomeados após a serialização e armazenados com SHA-256. O download recalcula o checksum antes de fornecer o conteúdo.

O PostgreSQL permanece como fonte de verdade para solicitação, estado, auditoria e resultado. Redis/BullMQ coordenam entrega e execução; não substituem o histórico persistido.

### Consequências

A solicitação não é perdida apenas porque Redis está indisponível no instante em que o pedido foi gravado. Quando o serviço volta, o evento pendente pode ser publicado. Uma tarefa interrompida pode ser retomada após expirar o heartbeat. O cliente consulta o estado sem manter a requisição original aberta.

A arquitetura introduz um worker, Redis, despachante Outbox e arquivos que precisam de armazenamento e limpeza. A entrega é, na prática, pelo menos uma vez: a aplicação deve tolerar reentrega e concorrência, em vez de pressupor execução única. O lease e as atualizações condicionais evitam que duas execuções persistam resultados conflitantes, mas não substituem monitoramento de filas, falhas e espaço em disco.

### Verificação

Execute `npm run test:integration` com PostgreSQL 17 e Redis 7 dedicados. A suíte `src/tests/integration/async-reports-redis.integration.test.ts` verifica a jornada HTTP `202` → Outbox → BullMQ → worker → arquivo → checksum e os cenários de retry/recuperação que estiverem habilitados na versão do teste. `npm run test:demonstracao` exibe os fluxos com doubles explicitamente identificados; não comprova a infraestrutura real.

## ADR-0008 — Isolamento de parceiros e organizações

**Decisão:** adotada.  
**Implementação:** `src/modules/api-publica/`, `src/modules/integracoes/`, `src/modules/parceiros/` e `prisma/schema.prisma`.  
**Cobertura:** testes de autorização, acesso cruzado e integração de persistência; os testes devem ser executados com banco dedicado.  
**Limitação:** o isolamento precisa continuar sendo aplicado em toda nova consulta pública, inclusive em recursos relacionados.

### Contexto e problema

Uma instalação pode atender várias organizações e mais de um parceiro. A autorização para integrar com uma organização não significa que o parceiro tenha acesso a todos os lotes dessa organização. A API precisa verificar tanto o vínculo ativo com a organização quanto a propriedade do recurso submetido pela integração.

Usar UUID interno de organização vindo do cliente facilita enumeração e acopla o contrato público ao modelo interno. Expor CNPJ, códigos internos de equipamentos ou usuários também entrega dados que não são necessários para acompanhar uma submissão.

### Alternativas consideradas

- Aceitar `organizacaoId` interno em chamadas públicas: foi rejeitado por revelar identificadores internos e colocar a escolha do tenant nas mãos do cliente.
- Autorizar somente pelo vínculo de organização: insuficiente quando dois parceiros possuem vínculo com a mesma organização, pois um poderia consultar recurso criado pelo outro.
- Fazer exclusão física de lotes cancelados: eliminaria parte do histórico e prejudicaria rastreabilidade e auditoria.

### Decisão adotada e funcionamento

`ParceiroOrganizacao` mantém a relação entre parceiro e organização, com um identificador opaco `gci_...` enviado em `X-Integration-ID`. O servidor resolve esse identificador e confirma se o vínculo continua ativo. O cliente não seleciona a organização por UUID nem por CNPJ.

O lote possui identificador público `gcl_...`. A referência externa e os registros de idempotência são vinculados ao parceiro autenticado. Para as operações públicas de leitura e alteração, além da associação organizacional, a consulta exige que o lote tenha referência externa ou idempotência pertencente ao mesmo parceiro. Isso evita que dois parceiros ligados à mesma organização acessem um ao outro apenas por conhecer um identificador público.

As respostas usam projeções específicas e não retornam IDs internos de organização, usuário ou API Key, CNPJ, código de barras interno, hash de credencial ou dados pessoais de operadores. A rastreabilidade operacional continua separada da visão resumida de gestão do lote.

O cancelamento público usa desativação lógica (`ativo = false`) e registra auditoria. O registro, equipamentos e histórico permanecem preservados. A operação só é permitida antes de triagem e de movimentações incompatíveis, com controle de versão.

### Consequências

O contrato público é estável mesmo que IDs internos mudem. A associação pode ser revogada sem apagar o histórico. A verificação de propriedade protege também casos em que a organização é compartilhada por múltiplos parceiros. A exclusão lógica mantém evidências operacionais e permite explicar o estado final do lote.

O custo é que as consultas públicas precisam aplicar filtros por parceiro e vínculo em todas as operações. Uma rota nova não deve reutilizar uma consulta interna sem acrescentar essas restrições. O cancelamento também exige regras de estado e versão, em vez de simplesmente remover a linha.

### Verificação

Os testes de integração cobrem submissão, leitura, atualização, conflito de versão, cancelamento, revogação, idempotência e tentativa de acesso cruzado. O teste demonstrativo de HTTP mostra exemplos de contrato e autorização, mas usa dependências controladas. Para adicionar novos recursos públicos, inclua cenários para parceiro autorizado, parceiro diferente na mesma organização, organização sem vínculo ativo e chave sem escopo.

## ADR-0009 — Ciclo de vida público dos lotes

**Decisão:** adotada.  
**Implementação:** `src/modules/api-publica/routes.ts`, `api-publica.controller.ts` e `api-publica.service.ts`.  
**Cobertura:** testes HTTP e de integração do módulo público.  
**Limitação:** a edição é deliberadamente restrita aos dados administrativos do lote antes do início do processamento.

### Contexto e problema

A primeira versão da API pública permitia submeter lotes e consultar rastreabilidade, mas o parceiro não tinha operações próprias para listar, consultar de forma resumida, corrigir campos cadastrais ou cancelar uma submissão ainda não processada. A consulta detalhada de rastreabilidade não é substituta de uma consulta básica de recurso.

### Decisão adotada

O ciclo público disponibiliza `GET /api/v1/public/lotes` e `GET /api/v1/public/lotes/{identificadorPublico}` com escopo `lotes:read`. A criação permanece em `POST /api/v1/public/lotes`; alteração e cancelamento usam `PATCH` e `DELETE` com `lotes:write`. O escopo `rastreabilidade:read` permanece exclusivo do histórico operacional. O novo escopo não é atribuído automaticamente a chaves existentes.

A listagem oferece paginação e filtros de estado, referência externa e período. A consulta individual retorna somente os campos necessários à gestão. A atualização aceita apenas nota fiscal, transportadora e observações, exige `versaoEsperada` e incrementa a versão. O cancelamento também exige a versão esperada e desativa logicamente o lote quando ainda está em estado `RECEBIDO`, sem movimentação/triagem. Uma repetição de cancelamento já concluído é idempotente.

### Consequências e verificação

A gestão básica fica separada da linha do tempo de rastreabilidade, e concorrência otimista impede que uma edição sobrescreva silenciosamente outra. Campos de propriedade, estado interno e histórico não podem ser escolhidos pelo parceiro. O custo é a rejeição explícita de alterações fora da janela permitida, retornando conflito em vez de aceitar mutação tardia.

Verifique os contratos no Swagger e execute `npm run test:integration`. Os testes devem validar tanto os caminhos permitidos quanto `403`, `404`, `409` e payloads inválidos.

## ADR-0010 — Estatística descritiva e regressão com simple-statistics

**Decisão:** adotada.  
**Implementação:** `src/modules/analytics/statistics.ts` e `src/modules/analytics/`.  
**Cobertura:** testes unitários dos cálculos e testes de serviço com dados controlados.  
**Limitação:** os resultados dependem da qualidade, quantidade e representatividade dos registros persistidos.

### Contexto, alternativas e decisão

O escopo analítico precisa de média, mediana, quantis e regressão linear simples. Implementar essas rotinas manualmente aumentaria a quantidade de código matemático próprio a revisar e testar. Uma biblioteca mais abrangente como `mathjs` oferece operações de álgebra e expressões que não são necessárias para as métricas atuais. `simple-statistics` atende diretamente as funções utilizadas, sem introduzir um mecanismo geral de avaliação de expressões.

A aplicação mantém suas regras de domínio em serviços próprios e usa a biblioteca para as operações estatísticas elementares. A regressão OLS é aplicada sobre idade em meses e valor estimado de depreciação. O R² é calculado a partir da soma dos resíduos, com proteção para séries constantes.

### Consequências e verificação

A matemática comum fica concentrada em uma dependência pequena, enquanto critérios de elegibilidade e limitações permanecem explícitos no domínio. A dependência não resolve viés de amostra, dados ausentes nem causalidade. Execute os testes unitários e os cenários demonstrativos analíticos para conferir valores de entrada e saída.

## Princípios de evolução

- Manter o monólito modular enquanto métricas não justificarem a separação de serviços.
- Preservar o PostgreSQL como fonte de verdade para estado de negócio e auditoria.
- Criar migrations aditivas; não reescrever migrations já aplicadas.
- Não expor dados internos em contratos públicos.
- Identificar a natureza de cada teste e não atribuir a um double a evidência de uma infraestrutura real.
