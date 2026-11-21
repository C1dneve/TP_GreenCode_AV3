-- Snapshot da referência usada em cada avaliação para preservar a explicabilidade histórica.
ALTER TABLE "avaliacoes_recuperacao"
  ADD COLUMN "valorReferenciaPorKg" DECIMAL(12,4),
  ADD COLUMN "percentualRecuperavel" DECIMAL(7,4),
  ADD COLUMN "fonteReferencia" VARCHAR(60),
  ADD COLUMN "observacaoReferencia" VARCHAR(1000),
  ADD COLUMN "referenciaRecuperacaoId" UUID;

ALTER TABLE "avaliacoes_recuperacao"
  ADD CONSTRAINT "avaliacoes_recuperacao_referenciaRecuperacaoId_fkey"
  FOREIGN KEY ("referenciaRecuperacaoId")
  REFERENCES "referencias_recuperacao"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "avaliacoes_recuperacao_referenciaRecuperacaoId_idx"
  ON "avaliacoes_recuperacao"("referenciaRecuperacaoId");
