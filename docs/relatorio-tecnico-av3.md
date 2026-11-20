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

## 4. Histórico operacional de triagem

O módulo `triagem` fornece início, ocorrência, conclusão e consulta cronológica. O início valida o estado do lote e de seus equipamentos, atualiza o lote com controle otimista de versão e registra `TRIAGEM_INICIADA` com responsável e hora. O endpoint legado `POST /api/v1/lotes/:loteId/triagem` foi mantido e adaptado: executa a transição síncrona de forma atômica e registra início/conclusão na mesma sessão histórica, marcada como `origemSessao=LEGADO_AV2` e `mensuravel=false`. O fluxo explícito AV3 usa `origemSessao=AV3` e `mensuravel=true`. A migration aditiva também reclassifica sessões legadas criadas pela primeira entrega, identificando os textos determinísticos gravados pela rota anterior. A conclusão valida a mesma sessão, transiciona equipamentos e lote, registra `TRIAGEM_CONCLUIDA` e mantém a transação atômica. Ocorrências durante a sessão são eventos próprios. O tempo só é calculado pela diferença entre os timestamps persistidos em sessões mensuráveis AV3. Sessões síncronas AV2 permanecem no histórico e nas contagens operacionais, mas são reportadas separadamente (`sessoesLegadasSincronas`) e excluídas de média, mediana e distribuição para não confundir duração da requisição com tempo real de trabalho.

O módulo `historico-equipamentos` registra falhas, manutenções, avaliações de depreciação e estimativas de recuperação. O valor realizado só é gravado quando informado e a gravação usa atualização condicional para evitar sobrescrita concorrente. Operações relevantes geram auditoria.

## 5. Indicador de eficiência operacional

Implementado em `OperationalEfficiencyService`.

1. O repository recupera eventos de triagem persistidos e lotes segundo organização/período.
2. Os eventos são agrupados por `sessaoId`.
3. Sessões com início e conclusão válidos produzem duração em minutos: `conclusao.ocorridoEm - inicio.ocorridoEm`.
4. O serviço calcula média, mediana, percentis 25/75/90, mínimo/máximo e agrupamentos por responsável e organização.
5. Lotes em `RECEBIDO` ou `EM_TRIAGEM` são contabilizados como pendentes; sessões incompletas e sessões legadas não mensuráveis são informadas separadamente.
6. O período filtra pela data de conclusão da sessão; o repository recupera também o início, mesmo que seja anterior ao início do período.
7. Consultas analíticas leem até 20.001 linhas para detectar excesso; acima de 20.000 lançam `ANALYTICS_DATASET_TOO_LARGE` e não persistem um resultado parcial.

A execução é persistida em `execucoes_analise`, com método, versão, filtros, contagem de observações e sinalização de indisponibilidade quando não há sessões completas.

## 6. Indicador de recuperação financeira/rentabilidade

Implementado em `ProfitabilityService`. O cálculo de referência é:

`valor_estimado = peso_kg × valor_material_por_kg × percentual_recuperável / 100`

A hierarquia de seleção é: tipo + estado + marca + modelo; tipo + estado + marca sem modelo; tipo + estado sem marca/modelo; e, por fim, tabela-base conservadora por tipo e condição. A coluna `modelo` é opcional e só pode ser preenchida quando houver marca; o resultado informa se veio de referência cadastrada ou tabela estimativa. A avaliação pode ser registrada antes da desmontagem e comparada depois com `valorRealizado`. O serviço expõe total estimado, total realizado, diferença apenas para equipamentos com realização e agregações por tipo, marca, modelo e condição física, além da relação peso/valor.

Quando `incluirDemonstracao=true`, cada equipamento só usa referências e avaliações de recuperação com o mesmo indicador `demonstracao` do próprio equipamento; dados reais e demonstrativos não se cruzam. O valor estimado não é apresentado como receita ou dinheiro efetivamente recuperado. Sem registros de realização, a coluna permanece indisponível. O método e o resultado analítico são persistidos para comparação histórica.

## 7. Previsão de vida útil remanescente

Implementada em `UsefulLifeService` com `simple-statistics` e regressão linear OLS. Cada histórico de depreciação vira um ponto `(idade_em_meses, valor_estimado)`. O modelo ajusta `valor = intercepto + inclinação × idade`. Uma tendência com inclinação negativa permite estimar a idade em que a linha alcançaria zero; a diferença para a idade atual produz meses remanescentes.

A previsão exige valor de aquisição positivo e pelo menos três avaliações em datas distintas. Inclinação não negativa, amostra insuficiente ou ausência de registros gera previsão indisponível com motivo. A projeção é ajustada por heurística documentada: penalidade de até 6% por falha, limitada a 50%, e crédito de até 2% por manutenção, limitado a 15%. A condição física compõe o índice de qualidade junto ao R².

O R² descreve a aderência do ajuste aos dados observados. O índice de confiabilidade combina essa aderência com estado, falhas e manutenções; não é uma probabilidade calibrada. O modelo é suporte à decisão e exige calibração com histórico real representativo antes de uso operacional de alto impacto.

Resultados, filtros, método, versão, número de observações, confiabilidade e motivos de indisponibilidade ficam persistidos em `execucoes_analise`. É possível consultar histórico e comparar novas execuções.

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

A listagem pública, consulta e download filtram pelo parceiro proprietário, escopo efetivo e associação ativa com a organização. A API não retorna o caminho físico do arquivo.

## 11. Swagger, autenticação e autorização

Swagger continua em `/docs/`. Rotas internas usam JWT e RBAC. Integrações externas usam `X-API-Key`; análises exigem `analytics:read`/`analytics:write`, e relatórios exigem `reports:read`/`reports:write`. A verificação efetiva considera as permissões combinadas do parceiro e da API Key. Relatórios também validam propriedade do parceiro e organização ativa. As rotas públicas novas usam rate limiting compartilhado no PostgreSQL e respeitam o limite de tamanho do payload configurado para chave/parceiro.

A auditoria cobre submissão pública, execuções analíticas públicas, solicitação/reprocessamento/download de relatórios e mutações do histórico do equipamento/triagem. Os logs Fastify mantêm redaction de Authorization, cookies, API Key e campos sensíveis.

## 12. Execução e compatibilidade

O caminho recomendado é Docker Compose, que inicia PostgreSQL, Redis, API e worker. O perfil `tests` fornece PostgreSQL e Redis separados para integração, sem apontar testes ao banco principal. Também é possível executar localmente com Node.js 24, PostgreSQL 17 e Redis 7, mantendo API e worker em terminais/processos diferentes.

No Windows 10+ recomenda-se Docker Desktop/WSL2; no Ubuntu 24.04.03+ recomenda-se Docker Engine e plugin Compose. O `.env.example` contém as opções de intervalo dos schedulers. Configure no `.env` local as variáveis `REDIS_URL`, `REPORTS_DIR`, `REPORT_EXPIRATION_DAYS`, `WORKER_CONCURRENCY` e `ANALYTICS_*_INTERVAL_MS`; o Compose injeta seus próprios valores nos containers.

## 13. Limitações e trade-offs

- A previsão de vida útil usa OLS e ajustes heurísticos sobre dados existentes; não constitui previsão probabilística calibrada. A validade aumenta com avaliações periódicas e histórico real representativo.
- A estimativa de recuperação depende das referências de valor por kg e percentual recuperável. A tabela-base evita ausência total de resultado, mas tem caráter estimativo e deve ser substituída/atualizada por referências locais documentadas.
- Análises e relatórios limitam consultas a 20.000 registros por conjunto. O sistema busca até 20.001 para detectar excesso e falha explicitamente (`ANALYTICS_DATASET_TOO_LARGE` ou `REPORT_DATASET_TOO_LARGE`), em vez de exportar ou persistir silenciosamente um conjunto parcial. Volumes superiores exigem paginação/chunk streaming.
- As análises recorrentes são agendadas pelo BullMQ com IDs estáveis; o PostgreSQL é a fonte de verdade para os resultados e para a chave idempotente de cada execução. A indisponibilidade de Redis impede novos jobs automáticos até a recuperação do worker, mas não apaga o histórico já persistido.
- O armazenamento está em volume de filesystem. Para múltiplos hosts, seria necessária uma solução de objetos compartilhada com política equivalente de checksum/expiração.

## 14. Evidências de validação e limitações do ambiente

Foram adicionados testes unitários para estatística, regressão OLS, eficiência operacional com sessão incompleta, distinção entre sessão legada AV2 e sessão mensurável AV3, hierarquia de referências financeiras por modelo/marca, segregação de referências e avaliações pela origem demonstrativa, rejeição explícita de conjuntos acima de 20.000 registros, cenários de vida útil com dados suficientes/insuficientes, depreciação linear e serialização CSV/JSON. Os testes de integração verificam metadados persistidos no endpoint legado e no fluxo AV3 explícito, além de consultar a análise operacional para comprovar a exclusão das sessões legadas da duração média.

A migration `20261120230000_legacy_triage_measurement` é aditiva: cria `origemSessao` e `mensuravel`, classifica novas sessões AV2 como `LEGADO_AV2`/não mensuráveis e reclassifica registros legados da primeira entrega a partir das observações determinísticas gravadas pela rota síncrona. As duas migrations anteriores não foram reescritas.

As consultas analíticas leem no máximo 20.001 linhas para detectar excedente. Se houver mais de 20.000 registros em qualquer conjunto analítico (eventos de triagem, lotes, equipamentos, referências, avaliações ou históricos de depreciação/falhas/manutenção), o serviço lança `ANALYTICS_DATASET_TOO_LARGE` e não salva o resultado parcial. Relatórios operacionais também falham com `REPORT_DATASET_TOO_LARGE` quando ultrapassam o limite, sem gerar arquivo truncado. Quando o período é filtrado, uma sessão é selecionada pela conclusão e seus eventos de início/ocorrência também são recuperados, mesmo quando o início ocorreu antes do período.

**A homologação executável não foi aprovada neste ambiente.** O ambiente possui Node.js `v22.16.0`, mas a aplicação exige Node 24; Docker, PostgreSQL, Redis e Prisma CLI não estão disponíveis. Não foi possível gerar o Prisma Client, aplicar migrations em banco de testes vazio, executar seed ou exercitar workers/agendamentos/filas contra Redis.

Resultados reais dos comandos desta revisão:

- `npm install`: falhou com `EAI_AGAIN` ao resolver `registry.npmjs.org`.
- `npm ci`: falhou com o mesmo erro DNS `EAI_AGAIN`; não concluiu instalação.
- `npm run prisma:validate`, `npm run prisma:generate`, `npm run db:deploy`, `npm run db:seed`, `npm run build`, `npm test` e `npm run test:integration`: todos encerraram com código 127 (`prisma: not found`), antes de executar validação, migrations, geração de client, build ou testes.
- `tsc --noEmit -p tsconfig.json`: bloqueado por definições de tipos ausentes (`@types/node`, `@types/pg` e tipos transitivos incompletos em `node_modules`).
- Transpiração de sintaxe com TypeScript 5.8.3: 117 arquivos TypeScript examinados, zero diagnósticos sintáticos. Isso não equivale a typecheck nem execução de testes.
- `git diff --check`: aprovado, sem erros de whitespace.

O `package-lock.json` não pôde ser atualizado: o registry npm não resolveu e o cache local não contém os pacotes BullMQ/simple-statistics. Para não criar um lockfile parcial ou inventado, ele foi preservado sem alterações e não está no diff incremental. Portanto, a instalação reproduzível ainda depende de executar `npm install` em ambiente Node 24 com acesso ao registry; em seguida, validar com `npm ci` e incluir o lockfile atualizado na revisão de entrega.

Em ambiente compatível, execute `npm install`, `npm ci`, `npm run prisma:validate`, `npm run prisma:generate`, `npm run db:deploy`, `npm run db:seed`, `npm run build`, `npm test` e `npm run test:integration`. Use exclusivamente o banco de teste separado definido no Compose; não aponte os testes para a base principal. Até essa execução, migrations, workers, filas, scheduler e testes integrados permanecem pendentes de homologação real.
