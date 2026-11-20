-- GreenCode AV3: parceiro, associação explícita, API Keys, auditoria externa e idempotência.
-- Mantém as migrations anteriores intactas e preserva registros AV2.

ALTER TABLE "lotes" ADD COLUMN "publicId" VARCHAR(40);
UPDATE "lotes"
   SET "publicId" = 'gcl_' || replace(gen_random_uuid()::text, '-', '')
 WHERE "publicId" IS NULL;
ALTER TABLE "lotes"
  ALTER COLUMN "publicId" SET NOT NULL,
  ALTER COLUMN "publicId" SET DEFAULT ('gcl_' || replace(gen_random_uuid()::text, '-', ''));
CREATE UNIQUE INDEX "lotes_publicId_key" ON "lotes"("publicId");

CREATE TABLE "parceiros" (
  "id" UUID NOT NULL,
  "nome" VARCHAR(160) NOT NULL,
  "descricao" VARCHAR(1000),
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "escopos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "limiteRequisicoesPorMinuto" INTEGER NOT NULL DEFAULT 60,
  "maxEquipamentosPorSubmissao" INTEGER NOT NULL DEFAULT 100,
  "maxPayloadBytes" INTEGER NOT NULL DEFAULT 1048576,
  "permiteLoteSemEquipamentos" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "parceiros_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "parceiros_escopos_check" CHECK ("escopos" <@ ARRAY['lotes:write', 'rastreabilidade:read']::TEXT[]),
  CONSTRAINT "parceiros_limites_check" CHECK (
    "limiteRequisicoesPorMinuto" BETWEEN 1 AND 10000 AND
    "maxEquipamentosPorSubmissao" BETWEEN 0 AND 5000 AND
    "maxPayloadBytes" BETWEEN 1024 AND 10485760
  )
);
CREATE INDEX "parceiros_ativo_nome_idx" ON "parceiros"("ativo", "nome");

CREATE TABLE "parceiros_organizacoes" (
  "id" UUID NOT NULL,
  "parceiroId" UUID NOT NULL,
  "organizacaoId" UUID NOT NULL,
  "identificadorPublico" VARCHAR(64) NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "revogadoEm" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "parceiros_organizacoes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "parceiros_organizacoes_identificadorPublico_key" UNIQUE ("identificadorPublico"),
  CONSTRAINT "parceiros_organizacoes_parceiroId_organizacaoId_key" UNIQUE ("parceiroId", "organizacaoId"),
  CONSTRAINT "parceiros_organizacoes_parceiroId_fkey" FOREIGN KEY ("parceiroId") REFERENCES "parceiros"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "parceiros_organizacoes_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "parceiros_organizacoes_parceiroId_ativo_idx" ON "parceiros_organizacoes"("parceiroId", "ativo");
CREATE INDEX "parceiros_organizacoes_organizacaoId_ativo_idx" ON "parceiros_organizacoes"("organizacaoId", "ativo");

CREATE TABLE "api_keys" (
  "id" UUID NOT NULL,
  "parceiroId" UUID NOT NULL,
  "nome" VARCHAR(120) NOT NULL,
  "prefixo" VARCHAR(40) NOT NULL,
  "segredoHash" CHAR(64) NOT NULL,
  "escopos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "limiteRequisicoesPorMinuto" INTEGER,
  "maxEquipamentosPorSubmissao" INTEGER,
  "maxPayloadBytes" INTEGER,
  "expiraEm" TIMESTAMPTZ(3),
  "revogadaEm" TIMESTAMPTZ(3),
  "ultimoUsoEm" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_keys_prefixo_key" UNIQUE ("prefixo"),
  CONSTRAINT "api_keys_parceiroId_fkey" FOREIGN KEY ("parceiroId") REFERENCES "parceiros"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "api_keys_escopos_check" CHECK ("escopos" <@ ARRAY['lotes:write', 'rastreabilidade:read']::TEXT[]),
  CONSTRAINT "api_keys_rate_limit_check" CHECK ("limiteRequisicoesPorMinuto" IS NULL OR "limiteRequisicoesPorMinuto" BETWEEN 1 AND 10000),
  CONSTRAINT "api_keys_equipment_limit_check" CHECK ("maxEquipamentosPorSubmissao" IS NULL OR "maxEquipamentosPorSubmissao" BETWEEN 0 AND 5000),
  CONSTRAINT "api_keys_payload_limit_check" CHECK ("maxPayloadBytes" IS NULL OR "maxPayloadBytes" BETWEEN 1024 AND 10485760)
);
CREATE INDEX "api_keys_parceiroId_createdAt_idx" ON "api_keys"("parceiroId", "createdAt");
CREATE INDEX "api_keys_parceiroId_revogadaEm_expiraEm_idx" ON "api_keys"("parceiroId", "revogadaEm", "expiraEm");

CREATE TABLE "requisicoes_idempotencia" (
  "id" UUID NOT NULL,
  "parceiroId" UUID NOT NULL,
  "chave" VARCHAR(200) NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "loteId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "requisicoes_idempotencia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "requisicoes_idempotencia_parceiroId_chave_key" UNIQUE ("parceiroId", "chave"),
  CONSTRAINT "requisicoes_idempotencia_parceiroId_fkey" FOREIGN KEY ("parceiroId") REFERENCES "parceiros"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "requisicoes_idempotencia_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "requisicoes_idempotencia_loteId_idx" ON "requisicoes_idempotencia"("loteId");

CREATE TABLE "referencias_externas_parceiro" (
  "id" UUID NOT NULL,
  "parceiroId" UUID NOT NULL,
  "externalId" VARCHAR(200) NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "loteId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referencias_externas_parceiro_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "referencias_externas_parceiro_parceiroId_externalId_key" UNIQUE ("parceiroId", "externalId"),
  CONSTRAINT "referencias_externas_parceiro_parceiroId_loteId_key" UNIQUE ("parceiroId", "loteId"),
  CONSTRAINT "referencias_externas_parceiro_parceiroId_fkey" FOREIGN KEY ("parceiroId") REFERENCES "parceiros"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "referencias_externas_parceiro_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "referencias_externas_parceiro_loteId_idx" ON "referencias_externas_parceiro"("loteId");

ALTER TABLE "eventos_auditoria"
  ADD COLUMN "atorTipo" VARCHAR(20) NOT NULL DEFAULT 'USUARIO',
  ADD COLUMN "parceiroId" UUID,
  ADD COLUMN "apiKeyId" UUID,
  ADD COLUMN "organizacaoId" UUID;
ALTER TABLE "eventos_auditoria"
  ADD CONSTRAINT "eventos_auditoria_parceiroId_fkey" FOREIGN KEY ("parceiroId") REFERENCES "parceiros"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "eventos_auditoria_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "eventos_auditoria_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "eventos_auditoria_parceiroId_instante_idx" ON "eventos_auditoria"("parceiroId", "instante");
CREATE INDEX "eventos_auditoria_apiKeyId_instante_idx" ON "eventos_auditoria"("apiKeyId", "instante");
CREATE INDEX "eventos_auditoria_organizacaoId_instante_idx" ON "eventos_auditoria"("organizacaoId", "instante");
