# Plano de implementação e homologação — GreenCode AV3

## Estado da evolução

A AV3 recebida já contém os três pilares definidos pelo enunciado: camada analítica, API pública versionada e processamento assíncrono com BullMQ/Redis. A revisão atual corrige semântica de eficiência, amplia transparência da rentabilidade, aplica critérios adicionais à projeção de vida útil, adiciona backtesting persistido, cria projeções públicas sanitizadas e alinha a porta local PostgreSQL com o Docker Compose.

A implementação permanece sujeita à homologação integrada. O ambiente desta revisão não possui Node 24, Docker, PostgreSQL ou Redis disponíveis e a instalação de dependências não foi concluída.

## Incrementos presentes no código

1. **Base AV2 preservada:** migrations iniciais mantidas, módulos operacionais preservados e estrutura modular continuada.
2. **API pública:** parceiros, API Keys, escopos, associação parceiro-organização, rate limit PostgreSQL, submissão, idempotência, rastreabilidade e auditoria.
3. **Analytics:** eficiência, rentabilidade, vida útil, histórico e execução agendada; a revisão adiciona ciclo de lote entrada→conclusão e métricas separadas de espera/triagem.
4. **Backtesting:** comparação de previsões maduras com eventos auditados de transição para `INSERVIVEL`, persistida como `BACKTESTING_VIDA_UTIL`.
5. **Processamento assíncrono:** Outbox, BullMQ, Redis, worker, retry, lease/heartbeat, recuperação e relatórios CSV/JSON.
6. **Minimização pública:** projeções próprias para analytics e sanitização de relatórios públicos.

## Próxima fase obrigatória — homologação

Executar em ambiente Node 24.x com acesso ao registry npm:

```bash
npm ci
npm run prisma:validate
npm run prisma:generate
npm run db:deploy
npm run db:seed
npm run build
npm test
npm run test:integration
```

Para a migração AV2→AV3, criar banco descartável separado, aplicar as migrations AV2, executar o seed AV2, registrar contagens e amostras, depois aplicar as migrations AV3 e validar integridade. Para instalação limpa, utilizar outro banco descartável vazio e aplicar todas as migrations desde o início. Não utilizar a base de desenvolvimento original nem executar reset em bancos não descartáveis.

Executar também `docker compose config -q`, `docker compose --profile tests config -q`, subir o perfil `tests`, executar o test-runner e verificar API/worker em execução. A validação deve registrar saídas reais para Redis indisponível, reinício do worker, retries, relatórios, autorização pública, rate limit e isolamento.

## Critério de conclusão

Uma funcionalidade só deve ser marcada como validada após evidência de execução. Build, testes unitários, testes de integração, migrations, seed, API, worker e compatibilidade Windows/Ubuntu devem ser registrados separadamente. O relatório técnico é a fonte de status e limitações desta revisão.
