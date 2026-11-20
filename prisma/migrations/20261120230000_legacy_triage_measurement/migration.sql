-- Identifica a origem de cada sessão e impede que o fluxo síncrono AV2
-- seja interpretado como duração real de triagem pela camada analítica.
ALTER TABLE "historico_triagem"
  ADD COLUMN "origemSessao" VARCHAR(24) NOT NULL DEFAULT 'AV3',
  ADD COLUMN "mensuravel" BOOLEAN NOT NULL DEFAULT true;

-- Reclassifica sessões criadas pela rota síncrona no primeiro incremento AV3.
-- O texto era escrito deterministicamente pelo endpoint de compatibilidade.
UPDATE "historico_triagem"
SET "origemSessao" = 'LEGADO_AV2', "mensuravel" = false
WHERE ("etapa" = 'TRIAGEM_INICIADA' AND "observacao" = 'Início registrado pelo endpoint compatível da AV2.')
   OR ("etapa" = 'TRIAGEM_CONCLUIDA' AND "observacao" = 'Conclusão registrada pelo endpoint compatível da AV2.');

CREATE INDEX "historico_triagem_origemSessao_mensuravel_ocorridoEm_idx"
  ON "historico_triagem"("origemSessao", "mensuravel", "ocorridoEm");
