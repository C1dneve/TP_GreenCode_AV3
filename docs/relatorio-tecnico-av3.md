# Relatório técnico — GreenCode AV3

## 1. Escopo implementado

A AV3 mantém o monólito modular da AV2 (Node.js 24, TypeScript, Fastify 5, Prisma ORM 7 e PostgreSQL 17) e acrescenta três pilares integrados: análises operacionais/financeiras/preditivas, processamento assíncrono com Redis/BullMQ e relatórios CSV/JSON com histórico, autorização, download e expiração. A API pública versionada permanece em `/api/v1/public` e passa a oferecer análises e relatórios sob escopos efetivos.

A aplicação não foi reconstruída nem teve a stack substituída. Os serviços HTTP continuam separados de serviços de domínio e repositories; as rotas novas não executam consultas Prisma diretamente.

## 2. Auditoria e estabilização da API pública

A submissão pública mantém uma transação PostgreSQL para lote, equipamentos, referência externa, chave de idempotência e evento de auditoria. O histórico de rastreabilidade também inclui `SUBMISSAO_PUBLICA_LOTE`, de forma que o evento de entrada aparece no histórico operacional. A implementação usa referência pública da organização e referência externa própria do parceiro, não expõe identificadores internos como substitutos de autorização.

O ciclo de parceiros, associações e API Keys é preservado. O segredo completo da chave aparece somente na criação; o valor persistido é o hash. A autenticação verifica revogação, expiração, status do parceiro e API Key, e calcula escopos efetivos como interseção dos escopos do parceiro com os da chave. As rotas públicas de análises e relatórios consultam novamente a associação ativa entre parceiro e organização.

O rate limiting das rotas públicas usa janela fixa de 60 segundos e contador atômico persistido no PostgreSQL (`rate_limit_buckets`), separado por parceiro e chave. O `INSERT ... ON CONFLICT ... UPDATE` compartilha o contador entre instâncias Fastify. Linhas expiradas são removidas periodicamente no fluxo do limitador. O uso do PostgreSQL para o contador, em vez de memória de processo, evita que cada réplica tenha um limite independente.

## 3. Modelo de dados e migrations

A migration `20261120190000_av3_analytics_async` cria os tipos e tabelas novos, sem reescrever as migrations anteriores:

| Entidade | Responsabilidade |
|---|---|
| `historico_triagem` | Sessão, responsável, etapa, timestamp, ocorrência e flag demonstrativa. |
| `falhas_equipamentos` | Categoria, severidade, descrição, instante e estado demonstrativo. |
| `manutencoes_equipamentos` | Tipo, descrição, data, custo opcional e flag demonstrativa. |
| `historico_depreciacao` | Avaliações periódicas de valor, taxa, condição física e método. |
| `referencias_recuperacao` | Valor por kg e percentual recuperável por tipo/marca/condição e vigência. |
| `avaliacoes_recuperacao` | Valor estimado, peso usado no cálculo e valor realizado opcional. |
| `execucoes_analise` | Tipo, organização, filtros, método/versão, resultado, qualidade, observações e flag demonstrativa. |
| `relatorios_assincronos` | Solicitante, parceiro/chave, organização, status, progresso, arquivo, hash, tamanho e expiração. |
| `outbox_eventos` | Evento de domínio a publicar, tentativas, próxima tentativa e erro controlado. |
| `rate_limit_buckets` | Contador distribuído por chave e janela. |

As FKs e índices foram definidos para relacionamentos, consultas por organização/período/status e expiração. A migration também impõe constraints de formato de relatório e limites numéricos de referências/avaliações.

### Relações e integridade relevantes

O schema mantém `Usuario`, `Organizacao`, `Contrato`, `Lote`, `Equipamento`, `Movimentacao`, `EventoAuditoria` e parâmetros operacionais da AV2. Na integração, `Parceiro` relaciona-se a várias `ApiKey` e a `Organizacao` por `ParceiroOrganizacao` (N:N, identificador público `gci_...`). `RequisicaoIdempotencia` e `ReferenciaExternaParceiro` isolam os identificadores por parceiro e apontam para o lote. O lote mantém `publicId` `gcl_...`; `codigoBarrasInterno` dos equipamentos permanece interno.

Na camada analítica, `HistoricoTriagem` guarda sessão, etapas, responsável, origem e mensurabilidade; `FalhaEquipamento`, `ManutencaoEquipamento` e `HistoricoDepreciacao` fornecem contexto histórico; `ReferenciaRecuperacao` e `AvaliacaoRecuperacao` preservam a fonte e o snapshot financeiro. `ExecucaoAnalise` mantém versões e resultados. No fluxo assíncrono, `RelatorioAssincrono` armazena estado e metadados, `OutboxEvento` garante publicação recuperável e `RateLimitBucket` mantém contadores por chave/janela. `EventoAuditoria` preserva operações internas e pode identificar parceiro, API Key e organização.

## 4. Histórico operacional de triagem

O módulo `triagem` fornece início, ocorrência, conclusão e consulta cronológica. O início valida o estado do lote e de seus equipamentos, atualiza o lote com controle otimista de versão e registra `TRIAGEM_INICIADA` com responsável e hora. O endpoint legado `POST /api/v1/lotes/:loteId/triagem` foi mantido e adaptado: executa a transição síncrona de forma atômica e registra início/conclusão na mesma sessão histórica, marcada como `origemSessao=LEGADO_AV2` e `mensuravel=false`. O fluxo explícito AV3 usa `origemSessao=AV3` e `mensuravel=true`. A migration aditiva também reclassifica sessões legadas criadas pela primeira entrega, identificando os textos determinísticos gravados pela rota anterior. A conclusão valida a mesma sessão, transiciona equipamentos e lote, registra `TRIAGEM_CONCLUIDA` e mantém a transação atômica. Ocorrências durante a sessão são eventos próprios. A duração efetiva é calculada entre `TRIAGEM_INICIADA` e `TRIAGEM_CONCLUIDA` da mesma sessão. Sessões síncronas AV2 permanecem no histórico e são identificadas separadamente; quando seus timestamps não representam tempo real de trabalho, não entram nas métricas de duração.

O módulo `historico-equipamentos` registra falhas, manutenções, avaliações de depreciação e estimativas de recuperação. O valor realizado só é gravado quando informado e a gravação usa atualização condicional para evitar sobrescrita concorrente. Operações relevantes geram auditoria.

## 5. Indicador de eficiência operacional

Implementado em `OperationalEfficiencyService`.

1. O repository recupera eventos de triagem e lotes da organização/origem solicitadas. A seleção do período considera a data de conclusão; o lote pode ter entrado antes do período.
2. Os eventos são agrupados por `sessaoId` e relacionados ao `loteId`.
3. Para o ciclo total, considera-se o evento `TRIAGEM_CONCLUIDA` associado a um lote cujo estado persistido é `TRIAGEM_CONCLUIDA`; o início da sessão não é requisito para medir entrada→conclusão. Se houver sessões concluídas históricas múltiplas para o mesmo lote, o último evento concluído define o fim do ciclo total. Para tempo efetivo, cada sessão AV3 precisa ter início e conclusão válidos, com início posterior à entrada do lote e cronologia não invertida.
4. Tempo total: `última TRIAGEM_CONCLUIDA.ocorridoEm - Lote.dataEntrada`, contado uma única vez por lote.
5. Tempo efetivo: união dos intervalos válidos `TRIAGEM_INICIADA.ocorridoEm → TRIAGEM_CONCLUIDA.ocorridoEm`; intervalos sobrepostos não são duplicados.
6. Tempo de espera: tempo total menos a união do tempo efetivo. Lotes sem sessão AV3 mensurável permanecem na amostra do ciclo total, mas não nas médias de tempo efetivo/espera; datas invertidas, sessões sem conclusão e durações negativas não entram nas médias de sessão.
7. O resultado apresenta médias/medianas, percentis, mínimo/máximo, agrupamentos por operador, organização e período, lotes pendentes e sessões incompletas. Cada lote é contado uma única vez no ciclo total.
8. Consultas acima de 20.000 registros falham explicitamente com `ANALYTICS_DATASET_TOO_LARGE`, sem persistir resultado parcial.

Intervalos efetivos sobrepostos são unidos; a parte sobreposta é atribuída à sessão que começou primeiro, evitando dupla contagem. Lotes concluídos apenas com sessão legada continuam contribuindo para o tempo total, mas não para tempo efetivo/espera, que permanecem indisponíveis quando não mensuráveis. A execução é persistida em `execucoes_analise` com método `Ciclo de lote (entrada→conclusão), união de sessões efetivas e espera` e versão de modelo `3.0.0`. Sessões legadas síncronas permanecem separadas e não contaminam os tempos quando não mensuráveis.

### Comparativos internos por operador

O agrupamento `porOperador` preserva os campos anteriores e acrescenta indicadores com denominadores explícitos:

| Campo | Interpretação | Amostra/denominador |
|---|---|---|
| `tempoEfetivoTotalMinutos` | Soma exclusiva dos minutos atribuídos ao operador após união dos intervalos. | Soma das sessões AV3 válidas do operador. |
| `sessoesConsideradas` | Quantidade de sessões completas, mensuráveis e com cronologia válida que entraram no agrupamento. | Contagem de sessões. |
| `sessoesComAtividade` | Sessões com contribuição exclusiva maior que zero. | Contagem de sessões ativas. |
| `observacoesTempoPorSessao` | Quantidade de valores usados nas estatísticas por sessão. | Igual à quantidade de sessões consideradas; contribuição zero permanece na amostra. |
| `tempoEfetivoMedioPorSessaoMinutos` / `tempoEfetivoMedianoPorSessaoMinutos` | Média e mediana dos minutos exclusivos por sessão. | `observacoesTempoPorSessao`. |
| `lotesAtendidos` | Número de lotes distintos com participação válida do operador, inclusive contribuição zero por sobreposição integral. | Lotes distintos. |
| `observacoesTempoPorLote` | Quantidade de lotes com participação válida usada na média por lote. | Lotes distintos com sessões consideradas. |
| `tempoMedioParticipacaoPorLoteMinutos` | Média da soma exclusiva do operador em cada lote. | `observacoesTempoPorLote`. |
| `participacaoPercentualTempoEfetivo` | Parcela do tempo efetivo total dos lotes elegíveis atribuída ao operador. | Um percentual agregado; indisponível quando o denominador total é zero. `observacoesParticipacaoPercentual` informa quantos lotes com sessão AV3 mensurável compõem a base global do denominador. |

Sessões legadas AV2, sessões sem início, cronologia inválida e sessões sem conclusão não alimentam os comparativos. Uma sessão AV3 válida totalmente coberta por sessão iniciada antes contribui com zero minuto, sem desaparecer da contagem de observações. A regra de precedência é temporal: a sessão que iniciou primeiro recebe a parte sobreposta. Os tempos exclusivos de operadores diferentes, somados, correspondem ao tempo efetivo sem duplicação. Esses indicadores descrevem distribuição de atividade e não constituem ranking de desempenho individual.

## 6. Indicador de recuperação financeira/rentabilidade

Implementado em `ProfitabilityService`. O cálculo de referência é:

`valor_estimado = peso_kg × valor_material_por_kg × percentual_recuperável / 100`

A hierarquia de seleção é: tipo + estado + marca + modelo; tipo + estado + marca sem modelo; tipo + estado sem marca/modelo; e, por fim, tabela-base conservadora por tipo e condição. A coluna `modelo` é opcional e só pode ser preenchida quando houver marca; o resultado informa se veio de referência cadastrada ou tabela estimativa. A avaliação pode ser registrada antes da desmontagem e comparada depois com `valorRealizado`. O serviço expõe total e média estimados, total e média realizados apenas quando há registro, diferença somente para equipamentos com realização, agrupamentos com quantidades/distribuições e relação peso/valor. Cada linha de equipamento apresenta peso considerado, material recuperável, preço de referência/kg, percentual recuperável, fonte e metodologia da referência. A referência cadastrada permanece distinguível da tabela-base estimativa.

Quando `incluirDemonstracao=true`, cada equipamento só usa referências e avaliações de recuperação com o mesmo indicador `demonstracao` do próprio equipamento; dados reais e demonstrativos não se cruzam. O valor estimado não é apresentado como receita ou dinheiro efetivamente recuperado. Sem registros de realização, a coluna permanece indisponível. O método e o resultado analítico são persistidos para comparação histórica.

## 7. Previsão de vida útil remanescente

Implementada em `UsefulLifeService` com `simple-statistics` e regressão linear OLS. Cada histórico de depreciação vira um ponto `(idade_em_meses, valor_estimado)`. O modelo ajusta `valor = intercepto + inclinação × idade`. Uma tendência com inclinação negativa permite estimar a idade em que a linha alcançaria zero; a diferença para a idade atual produz meses remanescentes.

A previsão exige valor de aquisição positivo e pelo menos três avaliações válidas, não futuras, em datas distintas. Inclinação não negativa, R² inferior a 0,35, equipamento já INSERVIVEL, amostra insuficiente ou limite de depreciação projetado no passado gera previsão indisponível com motivo. A projeção é ajustada por heurística documentada: penalidade de até 6% por falha, limitada a 50%, e crédito de até 2% por manutenção, limitado a 15%. A condição física compõe o índice de qualidade junto ao R².

O R² descreve a aderência do ajuste aos dados observados. O índice de confiabilidade combina essa aderência com estado, falhas e manutenções; não é uma probabilidade calibrada. O modelo é suporte à decisão e exige calibração com histórico real representativo antes de uso operacional de alto impacto.

Resultados, filtros, método, versão, número de observações, confiabilidade e motivos de indisponibilidade ficam persistidos em `execucoes_analise`. É possível consultar histórico e comparar novas execuções.

### Backtesting de vida útil

`UsefulLifeBacktestingService` consulta snapshots históricos de `VIDA_UTIL_REMANESCENTE` e eventos de auditoria `ALTERACAO_ESTADO_FISICO` cujo detalhe `para` seja `INSERVIVEL`. Uma previsão só é candidata quando sua data estimada já foi alcançada e a transição real é posterior ao instante de execução do modelo. A comparação usa a primeira transição posterior por equipamento real (`demonstracao=false`), calcula erro assinado em dias, erro absoluto médio e erro percentual absoluto médio (MAPE) usando o horizonte previsto como denominador. Previsões maduras sem evento observado e previsões ainda não maduras são contabilizadas separadamente, sem serem tratadas como acerto ou erro. O resultado é persistido como `BACKTESTING_VIDA_UTIL`; a nova enumeração é adicionada por migration aditiva. A limitação central é que a ausência de transição auditada não prova que o equipamento continuou utilizável: pode representar censura ou falta de registro.


### 7.1 Justificativa da `simple-statistics`

O módulo `src/modules/analytics/statistics.ts` concentra o uso da biblioteca `simple-statistics` em operações que aparecem diretamente nas análises: `mean` para médias, `median` para medianas, `quantileSorted` para quantis/percentis e `linearRegression`/`linearRegressionLine` para ajustar e avaliar a reta de regressão. As amostras de quantis são ordenadas antes da chamada; a biblioteca calcula o quantil com a convenção de interpolação padrão da função utilizada. O código de serviço calcula explicitamente o R² a partir dos resíduos e da soma total dos quadrados, limitando o resultado ao intervalo de 0 a 1 e tratando separadamente amostras com variância nula.

Na previsão de vida útil, cada ponto representa `(idade em meses, valor estimado)`. A regressão linear OLS ajusta `valor = intercepto + inclinação × idade`; a extensão da reta até valor zero estima uma idade de referência e, pela diferença com a idade atual, os meses remanescentes. Essa projeção só é disponibilizada quando os critérios do serviço são atendidos: ao menos três avaliações válidas em datas distintas, valor de aquisição positivo, ausência de avaliações futuras, equipamento não inservível, inclinação negativa, `R² >= 0,35` e cruzamento projetado ainda futuro. A penalização de falhas e o crédito de manutenção são heurísticas do domínio, não funcionalidades estatísticas da biblioteca.

A escolha é adequada ao escopo porque oferece funções estatísticas específicas e legíveis, reduz código matemático próprio, facilita a revisão por pares e integra-se ao projeto TypeScript sem exigir um ambiente numérico especializado. Uma biblioteca genérica como `mathjs` acrescentaria uma camada de operações algébricas mais ampla do que a necessidade atual: o sistema não executa álgebra simbólica, matrizes gerais ou pipelines matemáticos multidisciplinares. Não foi realizado benchmark comparativo e, portanto, não se afirma vantagem de desempenho quantitativa.

A decisão também tem limites: a biblioteca não corrige dados ruins, não escolhe variáveis causais, não valida premissas do domínio e não transforma OLS em previsão probabilística. Três observações constituem apenas um mínimo operacional, não garantia de representatividade. Tendências não lineares, mudanças tecnológicas, inflação, diferenças entre categorias e períodos sem avaliações podem tornar a reta inadequada. O R² mede ajuste aos pontos disponíveis e pode ser alto em uma série pequena; o índice de confiabilidade do GreenCode combina R² e heurísticas de condição/falhas/manutenções e não é uma probabilidade calibrada. O resultado deve ser interpretado como estimativa de apoio à decisão e validado com histórico real antes de uso operacional de alto impacto.

## 8. Dados demonstrativos

O seed foi ampliado para cadastrar referências de recuperação, séries de depreciação, falhas, manutenções, avaliações com valor estimado/realizado e sessões de triagem. Os registros de histórico e avaliações são marcados com `demonstracao=true`; os lotes e equipamentos reservados `DEMO-AV2` e as referências de recuperação criadas pelo seed também recebem essa flag. Os endpoints de escrita operacional não permitem ao cliente marcar registros reais como demonstrativos. Relatórios e análises excluem equipamentos e eventos demonstrativos por padrão; o administrador pode incluí-los em análises internas para fins acadêmicos.

Os dados demonstrativos não representam resultados financeiros ou produtividade reais do GreenCode. Devem ser identificados como simulação nos relatórios acadêmicos.

## 9. Filas, worker e consistência

Redis 7/BullMQ 5 executa a fila `greencode-relatorios`. A API grava `RelatorioAssincrono` e `OutboxEvento` na mesma transação PostgreSQL; assim, uma indisponibilidade de Redis não apaga a solicitação aceita. Um processo worker independente consulta a Outbox a cada 1,5 segundo e publica jobs com `jobId` persistente. A publicação é idempotente pelo identificador estável e o evento de Outbox só é marcado como publicado após a aceitação do job pela fila.

A fila de relatórios usa cinco tentativas e backoff exponencial com atraso inicial de 3 segundos. A fila separada `greencode-analises` usa cinco tentativas e backoff exponencial com atraso inicial de 5 segundos. Ela registra três schedulers recorrentes pelo recurso `upsertJobScheduler`, usando identificadores estáveis (`greencode-analytics-efficiency`, `greencode-analytics-profitability` e `greencode-analytics-useful-life`); inicializações concorrentes atualizam o mesmo scheduler no Redis, em vez de criar um agendamento por instância. Os intervalos padrão são 1 hora para eficiência operacional, 6 horas para rentabilidade e 24 horas para vida útil, configuráveis pelas variáveis `ANALYTICS_EFFICIENCY_INTERVAL_MS`, `ANALYTICS_PROFITABILITY_INTERVAL_MS` e `ANALYTICS_USEFUL_LIFE_INTERVAL_MS` (mínimo de 60 segundos). O worker processa com concorrência configurável (`WORKER_CONCURRENCY`, padrão 3, máximo 10), registra falhas/conclusões em log estruturado e encerra conexões em SIGINT/SIGTERM.

Cada análise automática recebe `origemExecucao=AGENDADA`, `schedulerId`, `jobId` e `chaveExecucao` única; a persistência usa upsert pela chave para não duplicar a execução quando BullMQ reentrega o mesmo job após uma queda. A tabela conserva o tipo e a versão do modelo, filtros, resultado, confiabilidade, motivo de indisponibilidade e horário para histórico/comparação. Execuções manuais permanecem identificadas como `MANUAL`.

A execução de relatórios no PostgreSQL utiliza `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` e `EXPIRED`. Uma atualização condicional assume o job uma única vez; `heartbeatEm` renova a lease a cada 20 segundos. Um worker que observa uma execução `PROCESSING` sem heartbeat recente a reenfileira após 90 segundos, possibilitando retomada depois de queda abrupta. A fila também protege a reentrega com IDs estáveis e o serviço não refaz uma exportação já concluída.

O estado de negócio permanece no PostgreSQL. O Redis é infraestrutura de entrega e coordenação, não a única fonte do status. Quando Redis está indisponível, a API continua aceitando solicitações na Outbox; a publicação fica pendente até a recuperação do worker/Redis.

## 10. Relatórios, armazenamento e expiração

Tipos disponíveis: `operacional`, `equipamentos`, `triagem`, `rentabilidade` e `vida-util`; formatos: CSV e JSON. A solicitação retorna HTTP `202` e o identificador persistido. A consulta de histórico/status expõe solicitante, datas, progresso, erro controlado e disponibilidade do arquivo. Administradores/auditores podem reprocessar relatório com falha ainda dentro da validade.

O CSV usa escape de aspas/delimitadores e neutraliza campos iniciados por sinais típicos de fórmulas de planilha. O JSON converte inteiros grandes (`bigint`) para texto. O worker grava arquivo temporário com nome aleatório e depois o renomeia ao nome gerado internamente pelo sistema. O banco guarda somente referência interna (nome, não caminho arbitrário), SHA-256 e tamanho. O download resolve o caminho sob `REPORTS_DIR`, rejeita traversal, verifica o hash e registra auditoria antes de responder com stream.

A validade padrão é de sete dias, configurável entre 1 e 30 por `REPORT_EXPIRATION_DAYS`. O worker faz limpeza horária. Falha de remoção mantém a referência para que uma próxima execução tente novamente. O volume Docker `greencode_reports` persiste os arquivos entre reinicializações.

A listagem pública, consulta e download filtram pelo parceiro proprietário, escopo efetivo e associação ativa com a organização. A API não retorna o caminho físico do arquivo. As rotas públicas de analytics e solicitação de relatórios resolvem a organização por `X-Integration-ID`, evitando que o parceiro envie UUID interno de organização; o identificador público é validado contra o vínculo ativo do próprio parceiro.

## 11. Swagger, autenticação e autorização

Swagger continua em `/docs/`. Rotas internas usam JWT e RBAC. Integrações externas usam `X-API-Key`; análises exigem `analytics:read`/`analytics:write`, e relatórios exigem `reports:read`/`reports:write`. A verificação efetiva considera as permissões combinadas do parceiro e da API Key. Relatórios também validam propriedade do parceiro e organização ativa. As rotas públicas novas usam rate limiting compartilhado no PostgreSQL e respeitam o limite de tamanho do payload configurado para chave/parceiro.

A auditoria cobre submissão pública, execuções analíticas públicas, solicitação/reprocessamento/download de relatórios e mutações do histórico do equipamento/triagem. Os logs Fastify mantêm redaction de Authorization, cookies, API Key e campos sensíveis.

## 12. Execução e compatibilidade

O caminho recomendado é Docker Compose, que inicia PostgreSQL, Redis, API e worker. O perfil `tests` fornece PostgreSQL e Redis separados para integração, sem apontar testes ao banco principal. Também é possível executar localmente com Node.js 24, PostgreSQL 17 e Redis 7, mantendo API e worker em terminais/processos diferentes.

No Windows 10+ recomenda-se Docker Desktop/WSL2; no Ubuntu 24.04.03+ recomenda-se Docker Engine e plugin Compose. O `.env.example` contém as opções de intervalo dos schedulers. Configure no `.env` local as variáveis `REDIS_URL`, `REPORTS_DIR`, `REPORT_EXPIRATION_DAYS`, `WORKER_CONCURRENCY` e `ANALYTICS_*_INTERVAL_MS`; o Compose injeta seus próprios valores nos containers.

## 13. Plano de escalabilidade

### Arquitetura e limites atuais

A implementação atual é um monólito modular Fastify 5, com PostgreSQL como banco de negócio e persistência de estado. As rotas públicas usam API Keys e escopos efetivos; o rate limit real utiliza contadores atômicos no PostgreSQL, em janela fixa de 60 segundos, por parceiro e por API Key, portanto o contador é compartilhado pelas instâncias que usam o mesmo banco. Redis 7/BullMQ 5 coordena filas e schedulers; um worker separado consome tarefas. A Outbox é gravada na mesma transação da solicitação, evitando aceitar tarefa sem persistir o evento que a publicará. O processamento é limitado por payload (10 MiB no Fastify, além do limite por parceiro/chave), quantidade máxima de equipamentos por submissão e consultas analíticas/relatórios de até 20.000 registros. A concorrência do worker é configurável (padrão 3, máximo 10). Os arquivos de relatório são gravados atualmente em filesystem local/volume Docker persistente; o PostgreSQL guarda metadados, expiração, tamanho e hash SHA-256.

Esses são mecanismos presentes no código. Não existe, nesta entrega, teste de carga que comprove capacidade para centenas ou milhares de parceiros. O armazenamento por volume local também não é compartilhado automaticamente entre hosts.

### Etapa 1 — centenas de parceiros

| Evolução proposta | Problema que resolve e justificativa | Impacto e estado |
|---|---|---|
| Executar múltiplas instâncias da API atrás de load balancer. | Distribui tráfego HTTP e permite manutenção/recuperação de instâncias. | Proposta futura. A autenticação e o rate limit no PostgreSQL já compartilham o estado necessário; sessões locais ou caches adicionados no futuro precisariam ser removidos ou externalizados. |
| Pooling e limites de conexões PostgreSQL. | Evita que réplicas HTTP e workers esgotem conexões do banco. | Prisma/driver já usa PostgreSQL; dimensionar pool, timeouts e, se necessário, PgBouncer exigirá métricas de conexões e testes de carga. Proposta futura. |
| Escalar workers horizontalmente. | Absorve aumento de relatórios/análises sem bloquear requisições. | A separação API/worker, Outbox e IDs estáveis já existem; adicionar instâncias e ajustar `WORKER_CONCURRENCY` requer acompanhar latência, tentativas e profundidade de fila. A escala horizontal é proposta, não validada neste ambiente. |
| Limites e visibilidade por parceiro. | Evita que um consumidor monopolize recursos. | Limites por parceiro/chave, escopos e limites de payload já existem. Painéis/alertas de consumo, cotas por tipo de tarefa e políticas adaptativas ficam para evolução. |
| Monitorar filas e banco. | Detecta crescimento de backlog, falhas e pressão sobre conexões antes de degradar a API. | Logs e estado persistido já são gerados; métricas, alertas e dashboards dedicados são futuros. |

### Etapa 2 — milhares de parceiros

| Evolução proposta | Problema que resolve e justificativa | Impacto e estado |
|---|---|---|
| Revisar índices com `EXPLAIN (ANALYZE, BUFFERS)` e métricas reais. | Consultas por organização, chave, período, status e expiração podem tornar-se gargalos. | Índices de integridade/consulta já existem nas migrations; otimizações só devem ocorrer após medir consultas representativas. Futura. |
| Paginação, leitura por cursor e processamento em chunks. | Reduz memória e tempo de transações para conjuntos maiores que os limites atuais. | Hoje há limite explícito de 20.000 registros. Streaming/paginação em relatórios e análises é evolução futura, com atenção a consistência de snapshot e backpressure. |
| Considerar Redis para rate limiting. | Reduz escritas de alta frequência no PostgreSQL se o contador tornar-se gargalo medido. | Hoje PostgreSQL é a fonte compartilhada e implementação efetiva. Migrar para Redis exigiria estratégia atômica, persistência/HA, política de fallback e observabilidade; só fazer após evidência de saturação. |
| Object storage compartilhado para relatórios. | Disponibiliza o mesmo arquivo para workers/API em hosts diferentes e desacopla volume de disco. | Hoje arquivos estão em filesystem/volume local, com checksum e expiração. Adotar S3 compatível ou equivalente requer credenciais, política de retenção, URLs/download autenticado e migração; futuro. |
| Mais workers com concorrência limitada. | Aumenta vazão mantendo limite de recursos por tarefa. | BullMQ já permite múltiplos consumidores; aumentar quantidade/concorrência exige medir CPU, memória, conexões, taxa de falhas e tempo de fila. Futuro. |
| Observabilidade de ponta a ponta. | Correlaciona requisição, parceiro, Outbox, job, execução e arquivo para localizar gargalos. | Request IDs e logs estruturados existem; tracing distribuído, métricas Prometheus/OpenTelemetry e alertas são propostas futuras. |
| Isolamento de dados e controle de acesso. | Reduz risco de vazamento em consultas multi-tenant e facilita auditoria. | O código já verifica parceiro, API Key, escopos e associação ativa; índices, revisão de consultas e testes de isolamento devem evoluir junto com volume. Particionamento ou bancos separados por tenant não são adotados hoje. |
| Backpressure e cotas de filas. | Evita crescimento ilimitado de tarefas diante de picos. | Há limite de relatórios pendentes por organização e limites de tamanho/volume; cotas por parceiro, rejeição antecipada e circuit breakers são evoluções futuras. |

### Etapa 3 — disponibilidade e evolução estrutural

1. **Métricas de capacidade e testes de carga:** definir SLOs, throughput, p95/p99, taxa de erros, conexões PostgreSQL, uso de CPU/memória, fila/idade do job e custo de armazenamento. Testar cargas graduais com distribuição realista por parceiro e comportamento de pico. Não há resultados de benchmark/carga nesta entrega.
2. **Alta disponibilidade:** planejar PostgreSQL gerenciado com réplica/failover e backups verificados; Redis com persistência/replicação adequadas ao papel de fila; balanceador e múltiplas réplicas stateless de API/worker; object storage redundante. Cada componente exige plano de failover e limites conhecidos.
3. **Recuperação:** ensaiar restauração de backup, reprocessamento idempotente da Outbox, recuperação de leases, retenção de relatórios e procedimentos para jobs órfãos. Definir RPO/RTO com base em requisitos do negócio.
4. **Separação de serviços:** manter o monólito modular enquanto módulos compartilham domínio/transações e a equipe consegue operá-lo. Extrair serviço apenas quando houver necessidade independente comprovada de escala, ciclo de entrega, isolamento de falhas ou ownership — por exemplo, workers de relatórios. A separação adiciona contratos remotos, deploy, tracing e consistência distribuída; não é um objetivo por si só.

O plano é incremental: medir primeiro, remover gargalos demonstrados depois. Nenhuma capacidade futura descrita acima deve ser interpretada como implementada ou comprovada por teste de carga nesta versão.

## 14. Limitações e trade-offs

- A previsão de vida útil usa OLS e ajustes heurísticos sobre dados existentes; não constitui previsão probabilística calibrada. A validade aumenta com avaliações periódicas e histórico real representativo.
- A estimativa de recuperação depende das referências de valor por kg e percentual recuperável. A tabela-base evita ausência total de resultado, mas tem caráter estimativo e deve ser substituída/atualizada por referências locais documentadas.
- Análises e relatórios limitam consultas a 20.000 registros por conjunto. O sistema busca até 20.001 para detectar excesso e falha explicitamente (`ANALYTICS_DATASET_TOO_LARGE` ou `REPORT_DATASET_TOO_LARGE`), em vez de exportar ou persistir silenciosamente um conjunto parcial. Volumes superiores exigem paginação/chunk streaming.
- As análises recorrentes são agendadas pelo BullMQ com IDs estáveis; o PostgreSQL é a fonte de verdade para os resultados e para a chave idempotente de cada execução. A indisponibilidade de Redis impede novos jobs automáticos até a recuperação do worker, mas não apaga o histórico já persistido.
- O armazenamento está em volume de filesystem. Para múltiplos hosts, seria necessária uma solução de objetos compartilhada com política equivalente de checksum/expiração.

## 15. Rastreabilidade resumida dos requisitos AV3

| Pilar | Requisito resumido | Implementação de referência | Evidência a executar |
|---|---|---|---|
| Analítico | Ciclo do lote, tempo efetivo, espera, agrupamento por operador e período. | `OperationalEfficiencyService`, `analytics.repository.ts` e histórico de triagem. | Testes unitários de intervalos e execução com PostgreSQL de teste. |
| Analítico | Estimativa de recuperação por tipo/estado/marca/modelo e comparação com valor realizado. | `ProfitabilityService`, referências e avaliações de recuperação. | Testes numéricos e integração de persistência. |
| Analítico | Vida útil por depreciação, falhas, manutenções e histórico/backtesting. | `UsefulLifeService`, `simple-statistics` e auditoria. | Testes OLS/indisponibilidade e integração de histórico. |
| API pública | API Keys, escopos, versionamento, rate limit, submissão e rastreabilidade. | `parceiros`, `integracoes` e `api-publica`. | HTTP positivo/negativo e testes de isolamento/concorrência no PostgreSQL. |
| Assíncrono | Solicitação com task ID, status, retry, relatório e download. | `relatorios-async`, Outbox, BullMQ e worker. | Integração com Redis/PostgreSQL, falha, retry, recuperação e expiração. |
| Segurança e operação | Auditoria, autenticação, minimização de DTOs, documentação e ambiente reproduzível. | `auth`, `auditoria`, Swagger/OpenAPI, Compose e guias. | Verificação de OpenAPI, inicialização, testes negativos e execução em ambiente limpo. |

A matriz detalhada de IDs funcionais (ANA/API/PAR/INT/JOB/REL/AUD/OPS/TECH/COMP) foi sintetizada a partir do documento de requisitos e das histórias de usuário. A implementação presente no código não substitui a execução dos critérios de aceite de banco, fila, concorrência e isolamento.

## 16. Evidências de validação e limitações do ambiente

A árvore de código contém testes unitários, testes de integração com salvaguarda para banco dedicado, e um comando específico de demonstração. O comando `npm run test:demonstracao` constrói o projeto, executa cenários determinísticos, imprime entrada/esperado/obtido e gera `docs/evidencias-testes-av3.md`. Os cenários que usam repositório, cliente Prisma, controller ou limitador simulados são identificados. O cenário público executa o `createApiKeyAuthenticator` e a validação criptográfica de chave reais com registro Prisma simulado; isso não comprova persistência ou revogação consultada em PostgreSQL, nem integração Redis/BullMQ.

**Verificações realizadas nesta sessão de refinamento:**

| Verificação | Comando/ação | Resultado observado |
|---|---|---|
| Inventário do repositório e documentos | listagem e leitura dos arquivos fonte/documentação | CONCLUÍDO — análise estática realizada. |
| Runtime | `node --version` | BLOQUEADO — runtime disponível `v22.16.0`; projeto exige `>=24 <25`. |
| Instalação npm | `npm ci --ignore-scripts --no-audit --no-fund --prefer-offline` | BLOQUEADO — excedeu 120 segundos; npm também emitiu `EBADENGINE` para Node 22. |
| Dependências de build | verificação de `node_modules` | BLOQUEADO — dependências locais não ficaram disponíveis para build. |
| Docker e serviços | `command -v docker`, verificação de PostgreSQL/Redis | BLOQUEADO — Docker CLI e serviços de banco/fila não estão disponíveis nesta sessão. |
| Prisma validate/generate e migrations | `npm run prisma:validate`, `npm run prisma:generate`, `npm run db:deploy` | BLOQUEADOS — todos retornaram `sh: 1: prisma: not found` (exit 127). |
| Build e testes | `npm run build`, `npm run test:unit`, `npm run test:integration`, `npm run test:demonstracao` | BLOQUEADOS — etapa inicial do build interrompida por `prisma: not found` (exit 127); nenhum teste foi executado. |
| Parser TypeScript estático | API do compilador TypeScript global percorreu todos os `src/**/*.ts` | CONCLUÍDO — 119 arquivos analisados, zero diagnósticos sintáticos. Não substitui type-check/build do projeto. |
| Sintaxe JavaScript da sidebar | `node --check src/docs/greencode-swagger-sidebar.js` | CONCLUÍDO — sem erros de sintaxe no runtime disponível. |
| JSON de configuração | `package.json` e `package-lock.json` carregados com `JSON.parse` | CONCLUÍDO — ambos são JSON válidos. |
| Type-check global | `tsc -p tsconfig.json --noEmit --pretty false` | BLOQUEADO — TypeScript global não encontrou declarações/dependências (`@types/node`, `pg` e tipos transitivos) após instalação npm incompleta. |
| Inicialização da API/worker | `npm start`, `npm run start:worker` | NÃO INICIADOS — `dist/src/server.js` e `dist/src/worker.js` não existem porque o build não foi executado. |
| Docker Compose | `docker compose config -q` | BLOQUEADO — `docker: command not found` (exit 127). |
| OpenAPI JSON e screenshots | requisições HTTP à API real | NÃO EXECUTADOS — a aplicação não foi iniciada; `/docs/json` e `/docs/` não foram inspecionados via HTTP. |

A tentativa de baixar Node.js 24 também não foi concluída por falha de resolução DNS do host de distribuição. Portanto, não há resultado de build, typecheck, Prisma validate/generate, migrations, testes unitários/integração/demonstração nem validação real do JSON OpenAPI nesta sessão. Não se declara homologação. Para concluir essas verificações, use Node.js 24 e instale as dependências (`npm ci`), ou execute o Compose em uma máquina com Docker e acesso às imagens/registry. A URL local configurada no projeto é `http://localhost:3000`; Swagger `/docs/`, OpenAPI `/docs/json` e health `/health` só ficam disponíveis enquanto a API estiver em execução.
