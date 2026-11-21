# Inventário da entrega GreenCode AV3

## Documentação final mantida

- `README.md` — entrada, pré-requisitos, inicialização, testes e links.
- `docs/relatorio-tecnico-av3.md` — arquitetura, modelo de dados, análises, estatística, API, segurança, filas, limites, escalabilidade e validação.
- `docs/guia-de-testes-professor.md` — configuração, execução, jornada Swagger, testes e modo demonstrativo.
- `docs/decisoes-arquiteturais.md` — ADRs 0005, 0006 e 0008 consolidados.
- `docs/adr/0005-api-publica-api-keys.md` e `docs/adr/README.md` — referências curtas para compatibilidade e navegação histórica.
- `docs/evidencias-testes-av3.md` — status inicial da execução; é sobrescrito pelo comando demonstrativo após uma execução real.

## Documentos consolidados/removidos

O conteúdo de contexto, arquitetura e organização de pastas foi incorporado no README e relatório técnico. A matriz de requisitos e histórias foi resumida na rastreabilidade do relatório técnico. O modelo de dados foi incorporado no relatório. O roteiro de homologação foi absorvido pelo guia do professor. Os relatórios intermediários de revisão foram removidos por duplicarem informações ou registrarem validações antigas. Os ADRs 0006 e 0008 foram incorporados ao documento consolidado; seus históricos e consequências foram preservados.

Arquivos removidos:

- `docs/GreenCode-AV3.md`
- `docs/arquitetura-av3.md`
- `docs/epicos-e-user-stories-av3.md`
- `docs/estrutura-de-pastas-av3.md`
- `docs/homologacao-revisao.md`
- `docs/modelo-de-dados-av3.md`
- `docs/plano-de-implementacao-av3.md`
- `docs/relatorio-alteracoes-revisao.md`
- `docs/relatorio-testes-revisao.md`
- `docs/requisitos-av3.md`
- `docs/adr/0006-processamento-assincrono.md`
- `docs/adr/0008-isolamento-parceiros.md`


## Inventário de alterações no código

Arquivos de código/configuração modificados:

- `README.md` — reescrito como entrada concisa do projeto, instalação, execução, testes e links.
- `package.json` — scripts de teste unitário/integração usam o reporter `spec`; adicionado `test:demonstracao`.
- `scripts/copy-assets.mjs` — copia o CSS e a sidebar para a distribuição compilada.
- `src/app.ts` — tags em português, esquemas de segurança, opções do Swagger UI e inclusão do CSS/JavaScript da sidebar.
- `src/docs/greencode-swagger.css` — identidade visual, hierarquia, estados, operações, exemplos, autenticação e layout responsivo.
- `src/modules/analytics/operational-efficiency.service.ts` — indicadores comparativos, amostras explícitas, tratamento de sobreposição/legado e valores indisponíveis.
- `src/modules/analytics/routes.ts` — tags, descrições, parâmetros e exemplos para análise interna e pública.
- `src/modules/api-publica/routes.ts` — exemplos e descrições de submissão e rastreabilidade.
- `src/modules/auth/routes.ts` — exemplos e contratos de autenticação/identidade/logout/alteração de senha.
- `src/modules/parceiros/routes.ts` — schemas, exemplos e respostas para parceiros, vínculos e API Keys.
- `src/modules/relatorios-async/routes.ts` — schemas/exemplos para solicitação, histórico, status, reprocessamento e download; respostas 202/listagem ajustadas ao formato efetivo dos serviços.
- `src/modules/relatorios-async/report-format.ts` — datas em campos de linhas CSV serializadas como ISO 8601 legível.
- `src/tests/av3-analytics.test.ts` — cobertura numérica de sobreposição, legado, lote único, amostras e datas CSV.
- `src/tests/integracoes.test.ts` — teste do adaptador Prisma de rate limit com cliente simulado, buckets separados e janela fixa.

Arquivos adicionados:

- `src/docs/greencode-swagger-sidebar.js` — sidebar de navegação que complementa o DOM do Swagger UI original.
- `src/tests/demonstracao.ts` — demonstrações de análises, API pública, solicitação assíncrona, Outbox, worker/arquivo/download, retry e Swagger/health; registra resultados de execução real quando o comando consegue rodar.
- `docs/decisoes-arquiteturais.md` — decisões 0005, 0006 e 0008 consolidadas.
- `docs/evidencias-testes-av3.md` — estado de validação desta cópia; o script substitui o arquivo somente após uma execução real.

`package-lock.json` e migrations existentes foram preservados sem alteração nesta revisão.

## Observação sobre validação

Os documentos descrevem o estado do código e distinguem validação executada de bloqueio de ambiente. Nesta cópia, build, testes, inicialização e screenshots reais do Swagger não foram executados porque o ambiente tem Node 22.16 (o projeto exige Node 24), a instalação npm expirou e Docker/PostgreSQL/Redis não estão disponíveis. Consulte o relatório técnico e `docs/evidencias-testes-av3.md` antes de afirmar homologação.
