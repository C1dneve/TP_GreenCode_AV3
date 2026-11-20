ALTER TABLE "lotes" ADD COLUMN "demonstracao" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "lotes_demonstracao_dataEntrada_idx" ON "lotes"("demonstracao", "dataEntrada");
ALTER TABLE "equipamentos" ADD COLUMN "demonstracao" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "equipamentos_demonstracao_ativo_idx" ON "equipamentos"("demonstracao", "ativo");

CREATE TYPE "TipoAnalise" AS ENUM ('EFICIENCIA_OPERACIONAL', 'RENTABILIDADE_EQUIPAMENTOS', 'VIDA_UTIL_REMANESCENTE');
CREATE TYPE "StatusRelatorio" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

CREATE TABLE "historico_triagem" (
  "id" UUID NOT NULL,
  "sessaoId" UUID NOT NULL,
  "loteId" UUID NOT NULL,
  "equipamentoId" UUID,
  "responsavelId" UUID NOT NULL,
  "etapa" VARCHAR(30) NOT NULL,
  "ocorridoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "observacao" VARCHAR(2000),
  "demonstracao" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "historico_triagem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "historico_triagem_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "historico_triagem_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "equipamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "historico_triagem_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "historico_triagem_loteId_ocorridoEm_idx" ON "historico_triagem"("loteId", "ocorridoEm");
CREATE INDEX "historico_triagem_sessaoId_etapa_idx" ON "historico_triagem"("sessaoId", "etapa");
CREATE INDEX "historico_triagem_responsavelId_ocorridoEm_idx" ON "historico_triagem"("responsavelId", "ocorridoEm");

CREATE TABLE "falhas_equipamentos" (
  "id" UUID NOT NULL,
  "equipamentoId" UUID NOT NULL,
  "ocorridoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "categoria" VARCHAR(80) NOT NULL,
  "severidade" VARCHAR(20) NOT NULL,
  "descricao" VARCHAR(2000) NOT NULL,
  "resolvidaEm" TIMESTAMPTZ(3),
  "demonstracao" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "falhas_equipamentos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "falhas_equipamentos_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "equipamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "falhas_equipamentos_equipamentoId_ocorridoEm_idx" ON "falhas_equipamentos"("equipamentoId", "ocorridoEm");
CREATE INDEX "falhas_equipamentos_severidade_ocorridoEm_idx" ON "falhas_equipamentos"("severidade", "ocorridoEm");

CREATE TABLE "manutencoes_equipamentos" (
  "id" UUID NOT NULL,
  "equipamentoId" UUID NOT NULL,
  "realizadaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tipo" VARCHAR(40) NOT NULL,
  "descricao" VARCHAR(2000) NOT NULL,
  "custo" DECIMAL(12,2),
  "demonstracao" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manutencoes_equipamentos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "manutencoes_equipamentos_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "equipamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "manutencoes_equipamentos_equipamentoId_realizadaEm_idx" ON "manutencoes_equipamentos"("equipamentoId", "realizadaEm");

CREATE TABLE "historico_depreciacao" (
  "id" UUID NOT NULL,
  "equipamentoId" UUID NOT NULL,
  "avaliadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valorEstimado" DECIMAL(12,2) NOT NULL,
  "taxaAnualPercentual" DECIMAL(7,4),
  "estadoFisico" "EstadoFisico" NOT NULL,
  "metodo" VARCHAR(60) NOT NULL,
  "demonstracao" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "historico_depreciacao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "historico_depreciacao_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "equipamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "historico_depreciacao_equipamentoId_avaliadoEm_idx" ON "historico_depreciacao"("equipamentoId", "avaliadoEm");

CREATE TABLE "referencias_recuperacao" (
  "id" UUID NOT NULL,
  "tipo" "TipoEquipamento" NOT NULL,
  "marca" VARCHAR(100),
  "estadoFisico" "EstadoFisico" NOT NULL,
  "valorMaterialPorKg" DECIMAL(12,4) NOT NULL,
  "percentualRecuperavel" DECIMAL(7,4) NOT NULL,
  "observacaoMetodologia" VARCHAR(1000) NOT NULL,
  "demonstracao" BOOLEAN NOT NULL DEFAULT false,
  "ativa" BOOLEAN NOT NULL DEFAULT true,
  "vigenciaInicio" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "vigenciaFim" TIMESTAMPTZ(3),
  CONSTRAINT "referencias_recuperacao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "referencias_recuperacao_percentual_check" CHECK ("percentualRecuperavel" >= 0 AND "percentualRecuperavel" <= 100),
  CONSTRAINT "referencias_recuperacao_valor_check" CHECK ("valorMaterialPorKg" >= 0)
);
CREATE INDEX "referencias_recuperacao_tipo_estadoFisico_ativa_idx" ON "referencias_recuperacao"("tipo", "estadoFisico", "ativa");
CREATE INDEX "referencias_recuperacao_demonstracao_ativa_idx" ON "referencias_recuperacao"("demonstracao", "ativa");

CREATE TABLE "avaliacoes_recuperacao" (
  "id" UUID NOT NULL,
  "equipamentoId" UUID NOT NULL,
  "avaliadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valorEstimado" DECIMAL(12,2) NOT NULL,
  "valorRealizado" DECIMAL(12,2),
  "metodo" VARCHAR(80) NOT NULL,
  "quantidadeKg" DECIMAL(10,3) NOT NULL,
  "demonstracao" BOOLEAN NOT NULL DEFAULT false,
  "realizadoEm" TIMESTAMPTZ(3),
  "observacao" VARCHAR(1000),
  CONSTRAINT "avaliacoes_recuperacao_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "avaliacoes_recuperacao_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "equipamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "avaliacoes_recuperacao_valores_check" CHECK ("valorEstimado" >= 0 AND ("valorRealizado" IS NULL OR "valorRealizado" >= 0))
);
CREATE INDEX "avaliacoes_recuperacao_equipamentoId_avaliadoEm_idx" ON "avaliacoes_recuperacao"("equipamentoId", "avaliadoEm");
CREATE INDEX "avaliacoes_recuperacao_demonstracao_avaliadoEm_idx" ON "avaliacoes_recuperacao"("demonstracao", "avaliadoEm");

CREATE TABLE "execucoes_analise" (
  "id" UUID NOT NULL,
  "tipo" "TipoAnalise" NOT NULL,
  "organizacaoId" UUID,
  "metodo" VARCHAR(100) NOT NULL,
  "versaoModelo" VARCHAR(40) NOT NULL,
  "filtros" JSONB NOT NULL,
  "resultado" JSONB NOT NULL,
  "observacoes" INTEGER NOT NULL DEFAULT 0,
  "confiabilidade" DECIMAL(7,4),
  "indisponivel" BOOLEAN NOT NULL DEFAULT false,
  "motivo" VARCHAR(500),
  "demonstracao" BOOLEAN NOT NULL DEFAULT false,
  "executadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "execucoes_analise_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "execucoes_analise_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "execucoes_analise_tipo_executadoEm_idx" ON "execucoes_analise"("tipo", "executadoEm");
CREATE INDEX "execucoes_analise_organizacaoId_tipo_executadoEm_idx" ON "execucoes_analise"("organizacaoId", "tipo", "executadoEm");

CREATE TABLE "relatorios_assincronos" (
  "id" UUID NOT NULL,
  "tipo" VARCHAR(60) NOT NULL,
  "formato" VARCHAR(10) NOT NULL,
  "status" "StatusRelatorio" NOT NULL DEFAULT 'PENDING',
  "solicitanteUsuarioId" UUID,
  "parceiroId" UUID,
  "apiKeyId" UUID,
  "organizacaoId" UUID NOT NULL,
  "filtros" JSONB NOT NULL,
  "jobId" VARCHAR(100) NOT NULL,
  "arquivoPath" VARCHAR(500),
  "arquivoSha256" CHAR(64),
  "tamanhoBytes" BIGINT,
  "progresso" INTEGER NOT NULL DEFAULT 0,
  "mensagemErro" VARCHAR(1000),
  "requestId" VARCHAR(100),
  "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "iniciadoEm" TIMESTAMPTZ(3),
  "heartbeatEm" TIMESTAMPTZ(3),
  "leaseToken" VARCHAR(100),
  "concluidoEm" TIMESTAMPTZ(3),
  "expiraEm" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "relatorios_assincronos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "relatorios_assincronos_jobId_key" UNIQUE ("jobId"),
  CONSTRAINT "relatorios_assincronos_solicitanteUsuarioId_fkey" FOREIGN KEY ("solicitanteUsuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "relatorios_assincronos_parceiroId_fkey" FOREIGN KEY ("parceiroId") REFERENCES "parceiros"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "relatorios_assincronos_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "relatorios_assincronos_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "organizacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "relatorios_assincronos_formato_check" CHECK ("formato" IN ('CSV', 'JSON'))
);
CREATE INDEX "relatorios_assincronos_organizacaoId_criadoEm_idx" ON "relatorios_assincronos"("organizacaoId", "criadoEm");
CREATE INDEX "relatorios_assincronos_parceiroId_criadoEm_idx" ON "relatorios_assincronos"("parceiroId", "criadoEm");
CREATE INDEX "relatorios_assincronos_status_expiraEm_idx" ON "relatorios_assincronos"("status", "expiraEm");
CREATE INDEX "relatorios_assincronos_status_heartbeatEm_idx" ON "relatorios_assincronos"("status", "heartbeatEm");

CREATE TABLE "outbox_eventos" (
  "id" UUID NOT NULL,
  "agregado" VARCHAR(80) NOT NULL,
  "agregadoId" VARCHAR(100) NOT NULL,
  "evento" VARCHAR(100) NOT NULL,
  "payload" JSONB NOT NULL,
  "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publicadoEm" TIMESTAMPTZ(3),
  "tentativas" INTEGER NOT NULL DEFAULT 0,
  "proximaTentativaEm" TIMESTAMPTZ(3),
  "ultimoErro" VARCHAR(1000),
  CONSTRAINT "outbox_eventos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "outbox_eventos_publicadoEm_criadoEm_idx" ON "outbox_eventos"("publicadoEm", "criadoEm");
CREATE INDEX "outbox_eventos_agregado_agregadoId_idx" ON "outbox_eventos"("agregado", "agregadoId");

CREATE TABLE "rate_limit_buckets" (
  "chave" VARCHAR(160) NOT NULL,
  "janelaInicio" TIMESTAMPTZ(3) NOT NULL,
  "quantidade" INTEGER NOT NULL DEFAULT 0,
  "expiraEm" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("chave", "janelaInicio")
);
CREATE INDEX "rate_limit_buckets_expiraEm_idx" ON "rate_limit_buckets"("expiraEm");
