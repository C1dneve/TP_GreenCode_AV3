-- Alinha as constraints persistidas aos seis escopos aceitos pela aplicação.
-- Migração aditiva: não altera o histórico de migrações anteriores.
ALTER TABLE "parceiros"
  DROP CONSTRAINT "parceiros_escopos_check";
ALTER TABLE "parceiros"
  ADD CONSTRAINT "parceiros_escopos_check"
  CHECK ("escopos" <@ ARRAY[
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
    'lotes:write',
    'rastreabilidade:read',
    'analytics:read',
    'analytics:write',
    'reports:read',
    'reports:write'
  ]::TEXT[]);
