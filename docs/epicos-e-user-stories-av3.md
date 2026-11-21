# Épicos e histórias de usuário — GreenCode AV3

As histórias estão organizadas por épico, prioridade e critérios de aceite, seguindo a estrutura usada na documentação AV2. Elas combinam o enunciado AV3 com as decisões de produto aprovadas. Para executar a jornada manual e os testes negativos, consulte o [Guia de execução e testes](guia-de-testes-professor.md).

> Os épicos abaixo representam o escopo funcional da AV3. Os módulos de analytics, API pública e processamento assíncrono já estão presentes no código. A homologação integrada ainda depende da execução dos testes em ambiente Node 24, PostgreSQL e Redis.

## Épico E1 — Inteligência analítica

- **US-ANA-01:** Como administrador, quero consultar tempo médio de processamento de lotes para identificar gargalos.
- **US-ANA-02:** Como gestor, quero comparar operadores e períodos para entender variações de eficiência.
- **US-ANA-03:** Como gestor, quero estimar valor de recuperação por tipo, condição, marca e modelo para priorizar equipamentos.
- **US-ANA-04:** Como gestor, quero prever vida útil remanescente com base em histórico de depreciação e falhas.
- **US-ANA-05:** Como usuário autorizado, quero consultar previsões históricas e comparar previsão com resultado observado.
- **US-ANA-06:** Como usuário, quero saber método, amostra, qualidade e motivo quando a previsão não puder ser calculada.

## Épico E2 — Gestão de parceiros

- **US-PAR-01:** Como Administrador GreenCode, quero cadastrar, consultar, atualizar, ativar e desativar parceiros.
- **US-PAR-02:** Como Administrador, quero autorizar e remover organizações vinculadas a um parceiro.
- **US-PAR-03:** Como Administrador, quero configurar os escopos máximos do parceiro e seus limites de taxa e submissão.
- **US-PAR-04:** Como Administrador, quero consultar o histórico de alterações do parceiro.

### Critérios de aceite — gestão de parceiros

**US-PAR-01 — CRUD e estado do parceiro**
- Somente usuário autenticado com papel Administrador GreenCode pode criar, consultar, atualizar, ativar ou desativar parceiros.
- A criação exige os campos obrigatórios definidos no contrato e valida formato, limites e unicidade de identificador externo quando esse identificador for informado.
- A listagem e a consulta individual não devem expor segredos, hashes de chaves ou configurações internas sensíveis.
- Atualizações respeitam validação e controle de concorrência, se o padrão AV2 correspondente for aplicável.
- Parceiro inativo não autentica integrações nem aceita novas submissões; seus registros e auditoria permanecem preservados.
- A operação administrativa é registrada em `EventoAuditoria`.

**US-PAR-02 — Organizações autorizadas**
- Somente Administrador GreenCode pode associar ou remover organizações.
- A associação exige parceiro e organização existentes; a regra para organizações inativas deve impedir nova autorização e ser verificada também no momento da operação pública.
- O mesmo vínculo não pode ser duplicado.
- A remoção/desativação do vínculo bloqueia imediatamente novas leituras e escritas públicas naquela organização.
- A alteração é auditada com parceiro, organização, ator interno, ação, resultado e request ID quando disponível.

**US-PAR-03 — Escopos e limites do parceiro**
- Somente Administrador GreenCode pode alterar os escopos máximos e limites do parceiro.
- Limites de taxa, tamanho máximo de submissão e concorrência, quando aplicáveis, aceitam somente valores válidos e positivos dentro dos limites de segurança definidos na aplicação.
- Nenhuma API Key pode possuir escopo que não esteja concedido ao parceiro.
- Reduzir ou remover escopos do parceiro deve restringir imediatamente todas as chaves vinculadas, sem depender de atualizar uma a uma.
- Alterações são auditadas.

**US-PAR-04 — Histórico de alterações**
- A consulta é restrita aos papéis internos autorizados (Administrador/Auditor conforme RBAC AV2).
- O histórico permite filtrar por parceiro, período, ação e resultado, conforme os filtros suportados pelo módulo de auditoria.
- Os detalhes não podem conter segredo de API Key, hash, token, cabeçalho Authorization ou credenciais.

## Épico E3 — API Keys e autenticação pública

- **US-KEY-01:** Como Administrador, quero emitir múltiplas chaves nomeadas para um parceiro.
- **US-KEY-02:** Como Administrador, quero definir escopos e validade opcional da chave.
- **US-KEY-03:** Como Administrador, quero revogar uma chave sem invalidar necessariamente as demais.
- **US-KEY-04:** Como parceiro, quero autenticar minhas chamadas com API Key sem usar JWT interno.
- **US-KEY-05:** Como parceiro, quero receber o segredo somente no momento de criação, com armazenamento seguro no servidor.

### Critérios de aceite — API Keys

**US-KEY-01 — Emissão de múltiplas chaves**
- Somente Administrador GreenCode pode criar chaves para parceiro existente e ativo.
- Um parceiro pode possuir várias chaves identificáveis individualmente.
- Cada chave possui identificador/prefixo público não secreto e segredo gerado com fonte criptograficamente segura.
- A resposta de criação mostra o segredo completo uma única vez; consultas posteriores não o recuperam.
- A emissão é auditada sem incluir o segredo ou seu hash nos detalhes.

**US-KEY-02 — Escopos e validade**
- Os escopos atribuídos à chave devem ser subconjunto dos escopos máximos do parceiro.
- A API rejeita configuração que tente conceder escopo além das permissões do parceiro.
- A validade pode ser opcional; quando configurada, deve ser uma data válida no futuro.
- A autorização de cada requisição calcula novamente a interseção entre escopos do parceiro e da chave, aplicando reduções posteriores do parceiro imediatamente.
- Alterações são auditadas.

**US-KEY-03 — Revogação individual**
- Administrador pode revogar uma chave específica sem revogar automaticamente outras chaves ativas do mesmo parceiro.
- Uma chave revogada não autentica novas requisições.
- Revogação é persistida e auditada; consultas administrativas indicam seu estado e data.
- A operação não revela nem retorna o segredo.

**US-KEY-04 — Autenticação pública**
- Rotas públicas exigem API Key válida no mecanismo documentado (por exemplo, cabeçalho dedicado).
- Chave ausente, inválida, revogada, expirada ou vinculada a parceiro inativo é recusada.
- JWT interno não substitui API Key nas rotas públicas; API Key não concede acesso às rotas internas/admin.
- A identidade do parceiro é derivada da chave validada, nunca de `partnerId` confiado no corpo/query.
- A última utilização pode ser registrada sem armazenar o segredo.

**US-KEY-05 — Proteção do segredo**
- O banco armazena somente hash do segredo; o segredo em claro não é persistido.
- O identificador/prefixo pode localizar o registro sem ser suficiente para autenticar.
- Logs, respostas de erro, auditoria, telemetria e Swagger não podem revelar segredo, hash ou cabeçalho de autenticação.
- Comparação do segredo deve usar mecanismo seguro apropriado ao formato de hash adotado.

## Épico E4 — Submissão e integração pública

- **US-INT-01:** Como parceiro autorizado, quero enviar um lote sem equipamentos.
- **US-INT-02:** Como parceiro autorizado, quero enviar um lote com equipamentos em uma única submissão.
- **US-INT-03:** Como integrador, quero que a submissão seja atômica e não deixe dados parciais.
- **US-INT-04:** Como integrador, quero usar `Idempotency-Key` e `externalId` para evitar duplicidade.
- **US-INT-05:** Como parceiro, quero consultar apenas dados das organizações autorizadas e cobertas pelos escopos efetivos da chave.
- **US-INT-06:** Como parceiro autorizado, quero consultar a rastreabilidade de lotes e equipamentos para acompanhar seu status e histórico operacional.

### Critérios de aceite — API pública inicial

**US-INT-01 e US-INT-02 — Submissão lote-only e lote com equipamentos**
- A rota pública é versionada e exige API Key válida com escopo efetivo de escrita de lotes.
- A organização de destino deve estar autorizada e ativa para o parceiro autenticado.
- O corpo aceita um lote sem equipamentos ou um lote com equipamentos, conforme contrato OpenAPI.
- Todos os campos passam pelas validações de domínio existentes na AV2; a API pública não cria um caminho que contorne regras de negócio.
- A identidade do parceiro é obtida da API Key validada; não é aceita como confiável a partir do payload.
- O retorno informa identificador/referência do recurso e o resultado da submissão sem expor dados internos desnecessários.
- O contrato inclui exemplos de sucesso e erros de validação, autenticação, autorização e conflito.

**US-INT-03 — Atomicidade**
- Lote, equipamentos vinculados e registros de idempotência necessários são persistidos na mesma transação de negócio.
- Se qualquer validação ou escrita falhar, não permanecem lote, equipamentos ou vínculos parcialmente criados.
- Erros de concorrência/constraint são traduzidos para respostas HTTP documentadas sem expor detalhes internos do banco.
- Há testes de integração com PostgreSQL para sucesso e rollback.

**US-INT-04 — Idempotência**
- Mesma `Idempotency-Key` para o mesmo parceiro e mesmo conteúdo normalizado retorna o resultado original sem duplicar recursos.
- Mesma `Idempotency-Key` com conteúdo diferente retorna HTTP `409 Conflict`.
- Mesmo `externalId` para o mesmo parceiro e mesmo conteúdo, ainda que com outra `Idempotency-Key`, retorna o recurso original e associa a nova chave ao mesmo resultado.
- Mesmo `externalId` com conteúdo diferente retorna HTTP `409 Conflict`.
- Identificadores de um parceiro não afetam outro parceiro.
- Há testes de repetição concorrente, mesma chave/diferente payload e mesmo external ID/diferente payload.

**US-INT-05 e US-INT-06 — Autorização e rastreabilidade**
- Consulta pública exige escopo efetivo de leitura de rastreabilidade.
- O escopo efetivo é a interseção entre permissões do parceiro e escopos da chave.
- O lote deve pertencer a uma organização com associação ativa ao parceiro autenticado.
- A resposta inclui dados operacionais do lote e, para equipamentos associados, tipo, marca, modelo, estado físico, situação atual e histórico de movimentações relevante.
- A resposta não expõe CNPJ, nomes de responsáveis, dados pessoais, `codigoBarrasInterno`, IDs internos não destinados à integração, credenciais ou informações administrativas desnecessárias.
- A referência usada na rota deve ser resolvida no contexto do parceiro; não revelar existência de registros pertencentes a terceiros.
- Chave sem escopo, vínculo de organização revogado/inativo ou recurso não autorizado não permite leitura.
- Há testes positivos e negativos cobrindo isolamento entre parceiros, chaves e organizações.

## Épico E5 — Jobs e relatórios assíncronos

- **US-JOB-01:** Como usuário/parceiro autorizado, quero solicitar análise ou relatório demorado sem manter a conexão aberta.
- **US-JOB-02:** Como solicitante, quero receber um task ID e consultar o status por polling.
- **US-JOB-03:** Como solicitante autorizado, quero baixar o resultado quando concluído.
- **US-JOB-04:** Como administrador, quero configurar expiração e permitir regeneração de relatório expirado.
- **US-JOB-05:** Como operador do sistema, quero retry controlado e rastreável para falhas transitórias.

## Épico E6 — Auditoria, documentação e operação

- **US-AUD-01:** Como auditor, quero rastrear criação/revogação de chaves, alterações de permissões, associações, submissões e consultas externas relevantes.
- **US-DOC-01:** Como parceiro, quero consultar OpenAPI com exemplos, parâmetros e erros.
- **US-OPS-01:** Como gestor, quero indicadores diários, previsões semanais e execução manual.
- **US-OPS-02:** Como mantenedor, quero executar ambiente em Docker Compose e seguir guia para Windows e Ubuntu.

### Critérios de aceite — auditoria e documentação

**US-AUD-01 — Auditoria de operações internas e externas**
- A AV3 amplia `EventoAuditoria` existente, preservando os registros AV2 e a relação com usuário interno.
- Eventos administrativos identificam o usuário interno responsável.
- Operações autenticadas por API Key identificam parceiro e chave usados; quando uma organização for afetada, registram a organização.
- Eventos registram ação, entidade, entidadeId, instante, resultado e request ID quando disponível.
- Eventos de sistema podem ser identificados como ator `SISTEMA`, sem inventar usuário interno.
- Nenhum evento guarda segredo, hash de API Key, token, cabeçalho Authorization ou credenciais.
- Há testes de persistência e consulta de auditoria para os novos tipos de ator.

**US-DOC-01 — OpenAPI**
- Todas as rotas públicas implementadas no escopo público aparecem no Swagger/OpenAPI sob namespace e versão próprios.
- A documentação descreve autenticação, escopos exigidos, parâmetros, schemas, exemplos de requisição/resposta e códigos de erro.
- Exemplos usam valores demonstrativos e nunca credenciais reais.
- Rotas públicas e internas/admin permanecem visualmente e funcionalmente separadas.

## Critério geral de aceite

Cada história deve ter critérios de aceite detalhados e testes unitários, HTTP e/ou integração. Histórias que envolvam banco, isolamento, transação ou constraints precisam de testes reais em PostgreSQL. Código sem execução deve ser registrado como implementado, mas não validado.


## Jornada mínima de demonstração

A sequência abaixo demonstra a integração externa e não substitui a execução de todos os critérios de aceite:

1. Iniciar a API e autenticar como Administrador.
2. Consultar uma organização ativa e cadastrar um parceiro.
3. Associar a organização ao parceiro e guardar o `identificadorPublico` retornado.
4. Criar API Key com `lotes:write` e `rastreabilidade:read`; guardar o segredo, que é exibido uma única vez.
5. Submeter lote com equipamentos usando `X-API-Key`, `X-Integration-ID` e `Idempotency-Key`.
6. Repetir a submissão e conferir a idempotência; testar também um conflito com conteúdo divergente.
7. Consultar a rastreabilidade pelo identificador GreenCode e pelo `externalId`.
8. Revogar a API Key e confirmar que novas chamadas são recusadas.

O roteiro detalhado, os comandos automatizados e os resultados esperados estão no [Guia de execução e testes](guia-de-testes-professor.md).
