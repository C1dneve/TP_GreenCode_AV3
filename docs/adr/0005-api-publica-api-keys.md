# ADR-0005 — API pública e autenticação por API Key

## Status

Aceito e implementado no primeiro grande passo. Build, migrations e validação PostgreSQL completos permanecem pendentes.

## Contexto

A API pública precisa autenticar sistemas parceiros sem utilizar a sessão JWT de usuários internos. O acesso deve ser restrito por parceiro, chave, escopo e organização, com limites e trilha de auditoria.

## Decisão

- Rotas internas continuam utilizando JWT/RBAC.
- Gestão de parceiros e chaves exige usuário interno com papel `ADMINISTRADOR`.
- Rotas públicas são versionadas em `/api/v1/public` e autenticadas por API Key.
- A API Key usa prefixo `gc_live_` e segredo de 32 bytes aleatórios (`randomBytes(32)`, base64url).
- O segredo completo é exibido uma única vez; somente SHA-256 hexadecimal é persistido.
- O digest é comparado com `timingSafeEqual`; o prefixo localiza o registro, mas não autentica isoladamente.
- Escopos iniciais: `lotes:write` e `rastreabilidade:read`.
- `escoposEfetivos = escoposParceiro ∩ escoposApiKey`, recalculado em cada requisição.
- O rate limiting utiliza janela fixa de 60 segundos em memória, com contadores para parceiro e chave; o menor limite vence.

## Justificativa e alternativas

O segredo possui alta entropia e é gerado pelo sistema, não escolhido por uma pessoa. SHA-256 determinístico é adequado para verificar esse segredo aleatório sem armazená-lo em claro; essa justificativa não se aplica a senhas humanas. Foi rejeitado o uso de JWT para autenticar parceiros, o armazenamento do segredo em texto puro e a introdução de Redis somente para o rate limit inicial.

## Consequências

As respostas excedidas usam HTTP `429` e `Retry-After`; payload acima do limite retorna `413`. Os contadores locais reiniciam com o processo e não são compartilhados entre instâncias. Um backend distribuído deverá ser adotado antes da escala horizontal.

Os módulos `parceiros`, `integracoes` e `api-publica` mantêm o ciclo administrativo, a segurança e as rotas externas. O OpenAPI descreve a autenticação e os headers necessários.

## Validação necessária

Executar build, autenticação HTTP, testes de escopos, expiração/revogação, rate limit, submissão e rastreabilidade com PostgreSQL de teste. A execução registrada está em `docs/relatorio-tecnico-av3.md`.
