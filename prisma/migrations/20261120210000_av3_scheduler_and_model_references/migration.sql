ALTER TABLE "referencias_recuperacao"
  ADD COLUMN "modelo" VARCHAR(120);

ALTER TABLE "referencias_recuperacao"
  ADD CONSTRAINT "referencias_recuperacao_modelo_exige_marca_check"
  CHECK ("modelo" IS NULL OR "marca" IS NOT NULL);

CREATE INDEX "referencias_recuperacao_tipo_estado_marca_modelo_ativa_idx"
  ON "referencias_recuperacao"("tipo", "estadoFisico", "marca", "modelo", "ativa");

ALTER TABLE "execucoes_analise"
  ADD COLUMN "origemExecucao" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "schedulerId" VARCHAR(100),
  ADD COLUMN "jobId" VARCHAR(160),
  ADD COLUMN "chaveExecucao" VARCHAR(260);

CREATE UNIQUE INDEX "execucoes_analise_chaveExecucao_key"
  ON "execucoes_analise"("chaveExecucao");
CREATE INDEX "execucoes_analise_origemExecucao_executadoEm_idx"
  ON "execucoes_analise"("origemExecucao", "executadoEm");

-- Uma sessão pode ter no máximo um início e uma conclusão; ocorrências são ilimitadas.
CREATE UNIQUE INDEX "historico_triagem_inicio_unico_por_sessao_idx"
  ON "historico_triagem"("sessaoId") WHERE "etapa" = 'TRIAGEM_INICIADA';
CREATE UNIQUE INDEX "historico_triagem_conclusao_unica_por_sessao_idx"
  ON "historico_triagem"("sessaoId") WHERE "etapa" = 'TRIAGEM_CONCLUIDA';
