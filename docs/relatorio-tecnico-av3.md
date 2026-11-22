# Relatório técnico — GreenCode AV3

## 1. Introdução e objetivo

O GreenCode é uma aplicação de logística reversa de equipamentos eletrônicos. A AV3 amplia o sistema com indicadores de operação, estimativas de recuperação de materiais, previsão de vida útil, integração máquina a máquina para parceiros e geração assíncrona de relatórios. A estrutura permanece como monólito modular: cada domínio tem suas rotas, controladores, serviços e repositórios, mas compartilha a infraestrutura de autenticação, persistência e execução.

O objetivo é apoiar decisões e integrações sem substituir a operação existente. Os valores analíticos são estimativas calculadas a partir dos registros disponíveis; não representam garantias de produtividade, preço de mercado ou duração física.

## 2. Arquitetura geral

A API é construída com Node.js 24, TypeScript e Fastify 5. Prisma ORM 7 acessa PostgreSQL 17, que concentra entidades operacionais, resultados analíticos, integrações, auditoria e solicitações de relatório. Redis 7 e BullMQ 5 são usados para a fila de trabalhos demorados. Um processo worker separado consome os jobs e atualiza os registros no banco.

A separação de responsabilidades é mantida nos módulos. Rotas definem o contrato HTTP; controladores adaptam a requisição; serviços concentram regras de negócio; repositórios fazem consultas e persistência. A camada compartilhada contém autenticação, erros, validação e configurações. O Swagger/OpenAPI publica os contratos de API.

## 3. Camada analítica

Os serviços analíticos consultam os dados por `AnalyticsRepository`, aplicam filtros de organização e período e persistem cada execução como histórico. A separação entre dados operacionais e demonstrativos é mantida pelos filtros de origem, evitando misturar exemplos com números efetivos.

Os três serviços principais são:

- `operational-efficiency.service.ts`: tempos de ciclo, atividade, espera e indicadores por lote, operador e período.
- `profitability.service.ts`: estimativa de material recuperável e valor estimado por equipamento, marca, modelo e tipo.
- `useful-life.service.ts`: estimativa de horizonte remanescente a partir da série histórica de depreciação.

As funções estatísticas compartilhadas ficam em `statistics.ts`, que utiliza `simple-statistics` para média, mediana, quantis e regressão linear. Regras de elegibilidade, interpretação e persistência permanecem nos serviços do GreenCode.

## 4. Eficiência operacional

O serviço considera sessões de triagem e os eventos de início/conclusão associados a lotes. O período do relatório é aplicado à conclusão da triagem, para não descartar lotes que entraram antes do intervalo e foram concluídos dentro dele. O ciclo total é contado uma vez por lote.

O tempo efetivo é calculado pela união dos intervalos válidos das sessões AV3. Quando duas sessões se sobrepõem, o trecho comum é contado uma única vez. Isso evita que atividades simultâneas inflem o tempo produtivo. Sessões legadas podem apoiar a identificação do ciclo e da conclusão, mas não são tratadas como medição confiável de tempo efetivo. O tempo de espera é a diferença entre o ciclo total e o tempo efetivo quando ambos são válidos.

Os resultados incluem medidas agregadas e recortes por operador, organização e período, além de contagens de lotes pendentes e sessões sem informação suficiente. A leitura dos indicadores deve considerar que a qualidade da medição depende de eventos registrados em ordem cronológica e de sessões com início e conclusão consistentes.

## 5. Rentabilidade e recuperação

A estimativa base usa a expressão:

`valor estimado = peso (kg) × valor de referência por kg × percentual recuperável / 100`.

O percentual e o preço são escolhidos, quando disponíveis, a partir de uma referência cadastrada que corresponda ao tipo e estado físico, priorizando modelo e marca, depois marca e por último uma referência genérica. Na ausência de referência aplicável, o serviço utiliza uma tabela-base estimativa por tipo de equipamento e um fator de condição física. O resultado identifica a origem da referência utilizada.

Quando existe uma avaliação histórica de recuperação compatível com a origem real ou demonstrativa do equipamento, seus valores são usados no relatório. A aplicação mantém separados valores estimados e valores realizados. Totais realizados consideram somente avaliações com valor efetivamente registrado; estimativa não é apresentada como receita obtida.

O resultado é uma aproximação operacional. O preço por quilograma, a composição do equipamento, custos de desmontagem, transporte, processamento e variações de mercado podem alterar o valor efetivamente recuperado.

## 6. Previsão de vida útil

O serviço utiliza regressão linear por mínimos quadrados ordinários (OLS) sobre avaliações históricas de depreciação. A variável independente é a idade em meses, calculada a partir do ano de fabricação; a variável dependente é o valor estimado registrado na avaliação. O horizonte é projetado até a interseção da reta estimada com o valor zero, tomando como referência a última observação válida.

Para publicar uma estimativa são exigidas pelo menos três avaliações válidas em datas distintas, valor de aquisição positivo, inclinação negativa, R² de pelo menos 0,35 e um horizonte futuro finito. Equipamento classificado como `INSERVIVEL`, série sem tendência de depreciação, ajuste insuficiente ou horizonte já ultrapassado não recebe previsão.

O schema registra falhas com data, categoria, severidade e data de resolução, além de registros de manutenção. O serviço apresenta quantidade de falhas, falhas não resolvidas, distribuição por severidade e intervalo médio entre ocorrências quando há mais de uma observação. Esses dados são descritivos; não entram como penalidades fixas na previsão. O histórico disponível não estabelece uma relação calibrada entre severidade/frequência de falhas e tempo até a inutilização. Atribuir pesos arbitrários daria aparência de precisão sem sustentação empírica.

O R² descreve a qualidade do ajuste linear, não é probabilidade de sobrevivência. A projeção não garante que o equipamento terá aquela duração real. Os resultados devem ser revistos conforme novos históricos e avaliações forem registrados.

## 7. Persistência dos resultados analíticos

As execuções são gravadas como registros de análise com tipo, organização, filtros, método, versão do modelo, quantidade de observações, confiabilidade quando aplicável, estado de disponibilidade e resultado serializado. O histórico permite consultar a saída usada em uma execução anterior mesmo que dados operacionais sejam atualizados posteriormente.

O Prisma modela relações entre organizações, lotes, equipamentos, sessões, avaliações, falhas e execuções. O PostgreSQL aplica chaves estrangeiras e restrições de unicidade. As migrations versionam mudanças estruturais; novas alterações devem ser aditivas para preservar ambientes que já aplicaram versões anteriores.

## 8. API pública para parceiros

A API de integração é versionada em `/api/v1/public`. O parceiro submete lotes com `POST /api/v1/public/lotes` e acompanha a gestão básica do recurso com:

| Método | Rota | Escopo | Finalidade |
|---|---|---|---|
| POST | `/api/v1/public/lotes` | `lotes:write` | Submeter lote e equipamentos |
| GET | `/api/v1/public/lotes` | `lotes:read` | Listar lotes próprios com paginação e filtros |
| GET | `/api/v1/public/lotes/{identificadorPublico}` | `lotes:read` | Consultar visão resumida do lote próprio |
| PATCH | `/api/v1/public/lotes/{identificadorPublico}` | `lotes:write` | Alterar campos administrativos permitidos |
| DELETE | `/api/v1/public/lotes/{identificadorPublico}` | `lotes:write` | Cancelar logicamente quando permitido |
| GET | `/api/v1/public/rastreabilidade/lotes/{identificadorPublico}` | `rastreabilidade:read` | Consultar histórico operacional |
| GET | `/api/v1/public/rastreabilidade/external/{externalId}` | `rastreabilidade:read` | Consultar pelo identificador externo do parceiro |

`lotes:read` foi introduzido como escopo separado. Ele não é concedido automaticamente a chaves antigas. A listagem permite filtros por estado, externalId e período, além de metadados de paginação. A visão resumida não substitui o endpoint de rastreabilidade, que contém histórico e movimentações.

O `PATCH` aceita somente `notaFiscal`, `transportadora` e `observacoes`. Requer `versaoEsperada` para controle otimista de concorrência. A resposta `409` sinaliza versão desatualizada ou estado incompatível. O `DELETE` é cancelamento lógico, não exclusão física: preserva lote, equipamentos e histórico, altera a ativação e audita a operação. Só é permitido antes de triagem ou movimentações incompatíveis. Repetir o cancelamento já realizado não remove dados nem cria uma segunda exclusão.

## 9. Autenticação e autorização

Usuários internos continuam autenticados por JWT e autorizados por papéis. Parceiros usam API Keys independentes do ciclo de vida dos usuários. O segredo é gerado de forma criptograficamente aleatória, exibido uma vez e persistido somente como hash SHA-256. A verificação usa comparação de tempo constante (`timingSafeEqual`). Credenciais podem ser revogadas.

Os escopos efetivos são a interseção dos escopos concedidos ao parceiro e daqueles da API Key. A chave não pode ampliar uma permissão que o parceiro não possui. `X-Integration-ID` identifica uma associação ativa entre parceiro e organização; o cliente não escolhe o tenant com UUID interno ou CNPJ.

Além do vínculo organizacional, consultas de lotes verificam a propriedade do recurso por referência externa ou registro de idempotência associado ao parceiro autenticado. Isso é necessário porque diferentes parceiros podem ter autorização para a mesma organização. As respostas públicas usam projeções específicas para não expor IDs internos, CNPJ, código de barras interno, dados pessoais de operadores ou hashes de credenciais.

## 10. Versionamento, idempotência e rate limiting

A API mantém `Idempotency-Key` para submissão. A chave é vinculada ao parceiro: repetir a mesma requisição recupera o resultado original; reutilizar a mesma chave com conteúdo divergente produz conflito. O cadastro do lote, equipamentos, referência externa, registro de idempotência e auditoria participa da transação PostgreSQL.

As alterações públicas usam `versaoEsperada`, evitando sobrescrita silenciosa quando dois sistemas atualizam o mesmo lote. O rate limiter contabiliza por parceiro e por API Key em janela fixa de 60 segundos. A atualização atômica do contador ocorre no PostgreSQL, compartilhado entre instâncias. Ao exceder o limite, a API retorna HTTP `429` e `Retry-After`. A janela fixa é simples e consistente, mas pode permitir rajadas na transição de minutos.

## 11. Processamento assíncrono

O pedido de relatório é validado e persistido no PostgreSQL junto com o evento Outbox. A API retorna HTTP `202 Accepted`, pois a resposta confirma o aceite do trabalho, não a conclusão do arquivo. O despachante lê eventos pendentes e publica jobs na fila BullMQ do Redis. O worker processa o relatório fora do ciclo HTTP e atualiza o registro persistente.

A Outbox resolve a janela de falha entre gravar o pedido e enviar o job. Se a publicação não puder ocorrer, o evento permanece pendente e recebe próxima tentativa com backoff exponencial. O job possui identificador estável. Relatórios usam cinco tentativas e backoff exponencial com atraso inicial de três segundos. O processamento utiliza lease e heartbeat; um relatório sem heartbeat recente pode ser recuperado depois de 90 segundos.

O arquivo é escrito em caminho temporário e renomeado quando concluído. O banco armazena caminho relativo, tamanho e checksum SHA-256. A rota de download confirma o checksum antes de enviar o arquivo. Os formatos suportados incluem CSV e JSON, conforme o tipo de relatório.

## 12. Modelagem de dados

PostgreSQL armazena os dados transacionais e históricos. As principais relações conectam organizações a lotes; lotes a equipamentos; equipamentos a depreciações, falhas, manutenções e avaliações de recuperação; parceiros a API Keys e associações organizacionais; relatórios a eventos Outbox e registros de auditoria.

Prisma fornece tipos e consultas alinhadas ao schema e executa migrations. O ORM reduz repetição de SQL em operações comuns, enquanto operações atômicas específicas (como o contador do rate limiter) utilizam SQL parametrizado. As transações protegem operações compostas e as restrições do banco reforçam unicidade e integridade referencial.

## 13. Justificativas das tecnologias

- **Fastify 5:** organiza rotas, hooks e schemas com baixo overhead e integração direta com TypeScript.
- **Prisma 7 + PostgreSQL 17:** oferecem schema tipado, relações explícitas, transações, índices e persistência durável para o domínio.
- **Redis 7 + BullMQ 5:** fornecem fila, tentativas, backoff e distribuição do processamento entre API e worker.
- **simple-statistics:** atende as operações estatísticas atualmente necessárias sem introduzir um mecanismo matemático amplo. A regra de negócio continua fora da biblioteca.
- **Swagger/OpenAPI:** torna os contratos navegáveis e permite testar as rotas manualmente.
- **Docker Compose:** padroniza a execução local dos serviços e cria infraestrutura isolada para testes.

## 14. Escalabilidade e operação

O desenho permite executar várias instâncias HTTP, desde que compartilhem PostgreSQL e Redis. O rate limiter compartilha estado no PostgreSQL e os jobs são consumidos pelos workers. O banco continuará sendo o principal recurso de coordenação e exige índices adequados, conexões dimensionadas e acompanhamento de consultas.

A fila desacopla o tempo de resposta HTTP do tempo de geração do relatório. O crescimento dos arquivos exige política de retenção e armazenamento com espaço suficiente. Para escalar workers, devem ser observadas concorrência, uso de CPU/memória e pressão no banco. Separar o monólito em serviços independentes só se justifica quando houver necessidade operacional demonstrável.

## 15. Segurança e isolamento

As rotas públicas exigem API Key válida, associação ativa e escopo correspondente. Os limites são aplicados tanto ao parceiro como à chave. A submissão é limitada em tamanho e em quantidade máxima de equipamentos. Segredos não são incluídos na auditoria. IDs internos e dados desnecessários não aparecem nos DTOs públicos.

O cancelamento de lote preserva o histórico. Revogação de associação ou de API Key impede novas chamadas, sem apagar registros. O ambiente de teste deve usar banco e Redis dedicados; nunca utilize uma base com dados reais para integração automatizada.

## 16. Limitações técnicas conhecidas

- A vida útil estimada depende de no mínimo três avaliações válidas em datas distintas e de um ajuste linear com qualidade mínima. Falhas e manutenções são exibidas como dados históricos, mas ainda não são preditores calibrados.
- A estimativa de rentabilidade depende das referências e dos percentuais cadastrados ou da tabela-base. Não inclui automaticamente todos os custos operacionais e flutuações de mercado.
- O rate limiting usa janela fixa, não janela deslizante.
- A arquitetura assíncrona precisa de Redis, worker e armazenamento de arquivos operacionais. A Outbox e o heartbeat permitem recuperação, mas não dispensam monitoramento e testes de falha.
- Os cenários demonstrativos com doubles não substituem integração em PostgreSQL/Redis reais.
- O relatório técnico descreve os mecanismos do código; a cobertura comprovada deve ser lida junto ao arquivo de evidências da execução mais recente e ao resultado do CI.

## 17. Estratégia de testes

Os testes são separados por natureza:

1. **Unitários:** verificam regras de domínio e funções estatísticas com entradas controladas.
2. **HTTP com doubles:** inicializam rotas Fastify e verificam contratos/autorização sem afirmar que o banco foi utilizado.
3. **Integração:** executam PostgreSQL, Redis, BullMQ e worker reais quando exigidos pelo cenário.
4. **Infraestrutura:** validam inicialização e disponibilidade dos serviços, como os health checks do CI e do Compose.

Comandos principais:

```bash
npm run prisma:validate
npm run build
npm run test:unit
npm run test:demonstracao
npm run test:integration
npm run test:av3
```

A suíte de integração exige Node.js 24, PostgreSQL 17 e Redis 7 dedicados. A variável `DATABASE_URL` deve apontar para um banco cujo nome contenha `test`; o teste de integração verifica essa condição antes de executar. O relatório `docs/evidencias-testes-av3.md` registra entradas, resultados esperados, saídas observadas e duração da demonstração. Resultados não executados não devem ser tratados como aprovados.
