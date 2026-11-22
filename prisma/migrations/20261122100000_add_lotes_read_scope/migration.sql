-- Adiciona leitura básica de lotes sem ampliar automaticamente as permissões
-- já atribuídas a parceiros ou API Keys.
ALTER TABLE "parceiros"
  DROP CONSTRAINT "parceiros_escopos_check";
ALTER TABLE "parceiros"
  ADD CONSTRAINT "parceiros_escopos_check"
  CHECK ("escopos" <@ ARRAY[
    'lotes:read',
    'lotes:write',
    'rastreabilidade:read',
    'analytics:read',
    'analytics:write',
    'reports:read',
    'reports:write'
  ]::TEXT[]);

ALTER TABLE "api_keys"
  DROP CONSTRAINT "api_keys_escopos_check";
ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_escopos_check"
  CHECK ("escopos" <@ ARRAY[
    'lotes:read',
    'lotes:write',
    'rastreabilidade:read',
    'analytics:read',
    'analytics:write',
    'reports:read',
    'reports:write'
  ]::TEXT[]);

-- A API pública filtra os lotes pela propriedade da requisição de idempotência.
-- O índice composto atende essa verificação sem alterar registros existentes.
CREATE INDEX "requisicoes_idempotencia_parceiroId_loteId_idx"
  ON "requisicoes_idempotencia"("parceiroId", "loteId");
