# ADR-0005 — API pública e autenticação por API Key

- **Status:** Aceito para o primeiro grande passo AV3.
- **Contexto:** A AV3 exige API pública documentada, autenticação por API Key, rate limit, consulta de rastreabilidade, submissão de lotes e separação das rotas internas.
- **Decisões aprovadas:** manter JWT nas rotas internas; introduzir namespace público versionado e autenticação por API Key; permitir múltiplas chaves por parceiro, individualmente revogáveis; mostrar o segredo uma única vez e armazenar somente hash; associar escopos ao parceiro e à chave.
- **Regra de autorização:** a permissão efetiva é a interseção dos escopos concedidos ao parceiro com os escopos atribuídos à chave. A chave nunca pode ampliar as permissões do parceiro. A redução de escopos do parceiro deve valer imediatamente para todas as chaves.
- **Rate limiting:** aplicar limites por chave e/ou parceiro, respeitando o limite mais restritivo configurado. Limites de payload e submissão também devem ser validados.
- **Auditoria:** operações administrativas e externas relevantes são registradas pela estrutura `EventoAuditoria` existente, ampliada para identificar atores externos, preservando os eventos e a relação de usuário interno da AV2.
- **Consequências:** novos módulos de parceiros/chaves e rotas públicas; autorização contextual por escopo e organização; atualização da documentação OpenAPI; testes de autenticação, expiração, revogação, permissões, rate limit e isolamento.
- **Detalhes técnicos ainda sujeitos a validação:** algoritmo/formato de hash, mecanismo concreto de rate limit distribuído e convenção final dos nomes dos escopos. Essas escolhas devem respeitar os requisitos acima e ser registradas no código/documentação.
- **Alternativas rejeitadas:** reutilizar JWT externo ou misturar rotas públicas e internas, por confundir ciclos de vida e políticas de segurança.
