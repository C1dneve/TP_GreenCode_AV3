import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import Fastify from "fastify";
import { buildApp } from "../app.js";
import { registerApiPublicaRoutes } from "../modules/api-publica/routes.js";
import { createApiKeyAuthenticator, type IntegrationIdentity } from "../modules/api-publica/integration-auth.js";
import { generateApiKey } from "../modules/integracoes/api-key-security.js";
import { OperationalEfficiencyService } from "../modules/analytics/operational-efficiency.service.js";
import { ProfitabilityService } from "../modules/analytics/profitability.service.js";
import { UsefulLifeService } from "../modules/analytics/useful-life.service.js";
import { linearRegression } from "../modules/analytics/statistics.js";
import type { AnalyticsRepository } from "../modules/analytics/analytics.repository.js";
import { serializeReport } from "../modules/relatorios-async/report-format.js";
import { registerRelatoriosAsyncRoutes } from "../modules/relatorios-async/routes.js";
import { RelatoriosAsyncController } from "../modules/relatorios-async/relatorios-async.controller.js";
import { RelatoriosAsyncRepository } from "../modules/relatorios-async/relatorios-async.repository.js";
import { RelatoriosAsyncService } from "../modules/relatorios-async/relatorios-async.service.js";
import { DomainError, errors } from "../shared/domain-error.js";

type ScenarioStatus = "APROVADO" | "REPROVADO" | "BLOQUEADO" | "NAO_EXECUTADO";
type ScenarioTestLevel = "Teste unitário" | "Teste HTTP com doubles" | "Teste de infraestrutura" | "Teste de integração";

interface ScenarioEvidence {
  name: string;
  objective: string;
  module: string;
  nature: "serviço com repositório simulado" | "rota HTTP real com autenticador/serviço simulado" | "Fastify sem banco" | "serializador puro";
  testLevel: ScenarioTestLevel;
  dependencies: string[];
  sourceFile: string;
  durationMs: number;
  input: unknown;
  expected: unknown;
  obtained: unknown;
  validations: string[];
  status: ScenarioStatus;
  failure?: string;
}
const evidence: ScenarioEvidence[] = [];

function scenarioModule(name: string): string {
  const value = name.toLocaleLowerCase("pt-BR");
  if (value.includes("eficiência")) return "analytics/operational-efficiency";
  if (value.includes("rentabilidade")) return "analytics/profitability";
  if (value.includes("vida útil")) return "analytics/useful-life";
  if (value.includes("api pública") || value.includes("http")) return "api-publica";
  if (value.includes("relatório")) return "relatorios-async";
  return "infraestrutura e serialização";
}

function scenarioLevel(nature: ScenarioEvidence["nature"]): ScenarioTestLevel {
  if (nature === "rota HTTP real com autenticador/serviço simulado") return "Teste HTTP com doubles";
  if (nature === "Fastify sem banco") return "Teste de infraestrutura";
  return "Teste unitário";
}

function scenarioDependencies(nature: ScenarioEvidence["nature"]): string[] {
  if (nature === "rota HTTP real com autenticador/serviço simulado") return ["Fastify real", "autenticador real", "Prisma simulado", "controller simulado", "rate limiter simulado"];
  if (nature === "Fastify sem banco") return ["Fastify", "Swagger/OpenAPI", "sem PostgreSQL/Redis"];
  if (nature === "serializador puro") return ["Node.js", "serializador de relatórios"];
  return ["serviço de domínio real", "repositório determinístico simulado"];
}

function redactEvidence(value: unknown, key = ""): unknown {
  if (/(api.?key|secret|senha|password|jwt|token|cnpj|authorization|credential)/i.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value
      .replace(/gc_(?:live|test)_[A-Za-z0-9._-]+/g, "[API_KEY_REDACTED]")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [TOKEN_REDACTED]")
      .replace(/\b\d{14}\b/g, "[CNPJ_REDACTED]");
  }
  if (Array.isArray(value)) return value.map(item => redactEvidence(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, redactEvidence(childValue, childKey)]));
  }
  return value;
}

async function scenario(
  name: string,
  objective: string,
  nature: ScenarioEvidence["nature"],
  input: unknown,
  expected: unknown,
  execute: () => Promise<unknown>,
  validate: (obtained: any) => void,
  validations: string[],
  metadata: { module?: string; testLevel?: ScenarioTestLevel; dependencies?: string[]; sourceFile?: string } = {},
) {
  const startedAt = process.hrtime.bigint();
  let obtained: unknown = null;
  let status: ScenarioStatus = "APROVADO";
  let failure: string | undefined;
  try {
    obtained = await execute();
    validate(obtained);
  } catch (error) {
    status = "REPROVADO";
    failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  evidence.push({
    name, objective, module: metadata.module ?? scenarioModule(name), nature,
    testLevel: metadata.testLevel ?? scenarioLevel(nature),
    dependencies: metadata.dependencies ?? scenarioDependencies(nature),
    sourceFile: metadata.sourceFile ?? "src/tests/demonstracao.ts",
    durationMs: Math.round(durationMs * 100) / 100,
    input: redactEvidence(input), expected: redactEvidence(expected), obtained: redactEvidence(obtained),
    validations, status, ...(failure ? { failure } : {}),
  });
}

function addSession(
  events: any[], sessionId: string, lotId: string, operatorId: string, operatorName: string,
  start: string, end: string, origin = "AV3", measurable = true,
) {
  const base = { sessaoId: sessionId, loteId: lotId, responsavelId: operatorId, responsavel: { id: operatorId, nome: operatorName }, lote: { id: lotId, organizacaoId: "org-demo" }, origemSessao: origin, mensuravel: measurable };
  events.push({ ...base, etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date(start) });
  events.push({ ...base, etapa: "TRIAGEM_CONCLUIDA", ocorridoEm: new Date(end) });
}

async function demonstrateEfficiency() {
  const events: any[] = [];
  addSession(events, "a-l1", "lote-1", "op-a", "Operador A", "2026-11-20T09:00:00Z", "2026-11-20T10:30:00Z");
  addSession(events, "b-l1-zero", "lote-1", "op-b", "Operador B", "2026-11-20T09:30:00Z", "2026-11-20T10:00:00Z");
  addSession(events, "b-l1", "lote-1", "op-b", "Operador B", "2026-11-20T10:00:00Z", "2026-11-20T11:00:00Z");
  addSession(events, "a-l2", "lote-2", "op-a", "Operador A", "2026-11-20T13:00:00Z", "2026-11-20T13:30:00Z");
  addSession(events, "b-l2", "lote-2", "op-b", "Operador B", "2026-11-20T13:20:00Z", "2026-11-20T14:30:00Z");
  addSession(events, "legacy-l2", "lote-2", "op-a", "Operador A", "2026-11-20T13:00:00Z", "2026-11-20T13:15:00Z", "LEGADO_AV2", false);
  const repository = {
    triageEvents: async () => events,
    lots: async () => [
      { id: "lote-1", organizacaoId: "org-demo", dataEntrada: new Date("2026-11-20T09:00:00Z"), statusProcessamento: "TRIAGEM_CONCLUIDA" },
      { id: "lote-2", organizacaoId: "org-demo", dataEntrada: new Date("2026-11-20T13:00:00Z"), statusProcessamento: "TRIAGEM_CONCLUIDA" },
    ],
    saveRun: async () => undefined,
  } as unknown as AnalyticsRepository;
  const result = await new OperationalEfficiencyService(repository).execute();
  const a = result.porOperador.find(item => item.operadorId === "op-a")!;
  const b = result.porOperador.find(item => item.operadorId === "op-b")!;
  return {
    result,
    output: {
      lotesConcluidos: result.lotesComTriagemConcluida,
      sessoesAv3Validas: result.sessoesMensuraveis,
      sessoesLegadas: result.sessoesLegadasSincronas,
      tempoEfetivoTotalMinutos: a.tempoEfetivoTotalMinutos + b.tempoEfetivoTotalMinutos,
      mediaEfetivaPorLoteMinutos: result.tempoEfetivoTriagemMedioMinutos,
      operadores: [a, b].map(item => ({
        operador: item.operador, tempoEfetivoTotalMinutos: item.tempoEfetivoTotalMinutos,
        sessoesConsideradas: item.sessoesConsideradas, sessoesComAtividade: item.sessoesComAtividade,
        mediaPorSessaoMinutos: item.tempoEfetivoMedioPorSessaoMinutos,
        medianaPorSessaoMinutos: item.tempoEfetivoMedianoPorSessaoMinutos,
        lotesAtendidos: item.lotesAtendidos,
        mediaPorLoteMinutos: item.tempoMedioParticipacaoPorLoteMinutos,
        participacaoPercentual: item.participacaoPercentualTempoEfetivo,
      })),
    },
  };
}

async function demonstratePublicApi() {
  const app = Fastify({ logger: false });
  let scopes = ["lotes:read", "lotes:write", "rastreabilidade:read"];
  let forceRateLimit = false;
  let revoked = false;
  const generated = generateApiKey();
  const partnerRecord = {
    id: "partner-demo", ativo: true, escopos: scopes,
    limiteRequisicoesPorMinuto: 60, maxEquipamentosPorSubmissao: 100,
    maxPayloadBytes: 1_048_576, permiteLoteSemEquipamentos: true,
  };
  const keyRecord = {
    id: "key-demo", prefixo: generated.prefixo, segredoHash: generated.segredoHash,
    escopos: ["lotes:read", "lotes:write", "rastreabilidade:read"], limiteRequisicoesPorMinuto: 60,
    maxEquipamentosPorSubmissao: 100, maxPayloadBytes: 1_048_576,
    expiraEm: null,
  };
  const prismaMock = {
    apiKey: {
      findUnique: async ({ where }: any) => where.prefixo === generated.prefixo
        ? { ...keyRecord, revogadaEm: revoked ? new Date("2026-11-20T12:00:00.000Z") : null, parceiro: partnerRecord }
        : null,
      update: async () => ({}),
    },
  };
  const authenticator = createApiKeyAuthenticator(prismaMock as never);
  const limiter = {
    consume: async (_key: string, limit: number) => ({
      allowed: !forceRateLimit, limit, remaining: forceRateLimit ? 0 : limit - 1,
      resetAt: 1_795_276_860_000, retryAfterSeconds: 37,
    }),
  };
  let demoLot = {
    identificadorPublico: "gcl_0123456789abcdef0123456789abcdef", externalId: "erp-demo-001",
    status: "RECEBIDO", ativo: true, versao: 1,
    dataEntrada: "2026-11-20T12:00:00.000Z", notaFiscal: "NF-DEMO-001",
    transportadora: "Transportadora Exemplo", observacoes: "Lote de demonstração",
    criadoEm: "2026-11-20T12:00:00.000Z", atualizadoEm: "2026-11-20T12:00:00.000Z",
    quantidadeEquipamentos: 1,
  };
  const controller = {
    submit: async (body: any, _identity: IntegrationIdentity, _integrationId: string, _idempotency: string) => ({
      identificadorPublico: demoLot.identificadorPublico, externalId: body.externalId,
      status: "RECEBIDO", dataEntrada: demoLot.dataEntrada, criadoEm: demoLot.criadoEm,
      quantidadeEquipamentos: body.equipamentos?.length ?? 0,
      equipamentos: (body.equipamentos ?? []).map((equipment: any) => ({
        tipo: equipment.tipo, marca: equipment.marca, modelo: equipment.modelo,
        estadoFisico: equipment.estadoFisico, statusRastreamento: "AGUARDANDO_TRIAGEM",
      })),
    }),
    listLots: async () => ({ data: [demoLot], meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 } }),
    getLot: async () => demoLot,
    updateLot: async (_id: string, input: any) => {
      if (input.notaFiscal !== undefined) demoLot.notaFiscal = input.notaFiscal;
      if (input.transportadora !== undefined) demoLot.transportadora = input.transportadora;
      if (input.observacoes !== undefined) demoLot.observacoes = input.observacoes;
      demoLot.versao += 1;
      demoLot.atualizadoEm = "2026-11-20T12:15:00.000Z";
      return demoLot;
    },
    cancelLot: async (id: string) => ({ ...demoLot, identificadorPublico: id, status: "CANCELADO", ativo: false, versao: 2 }),
    getByPublicId: async (id: string) => ({ identificadorPublico: id }),
    getByExternalId: async (id: string) => ({ externalId: id }),
  } as any;
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } });
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Falha no cenário demonstrativo." } });
  });
  registerApiPublicaRoutes(app, controller, authenticator as any, limiter);
  const headers = {
    "x-api-key": generated.valorCompleto, "x-integration-id": "gci_DEMO",
    "idempotency-key": "demo-submission-001",
  };
  const body = {
    externalId: "erp-demo-001", notaFiscal: "NF-DEMO-001", transportadora: "Transportadora Exemplo",
    equipamentos: [{ tipo: "NOTEBOOK", marca: "Exemplo", modelo: "NB-14", anoFabricacao: 2024, estadoFisico: "BOM_ESTADO", pesoQuilogramas: "2.500" }],
  };
  try {
    const success = await app.inject({ method: "POST", url: "/api/v1/public/lotes", headers, payload: body });
    const successResult = { statusCode: success.statusCode, headers: { rateLimitRemaining: success.headers["x-ratelimit-remaining"] }, body: success.json() };
    const lotList = await app.inject({ method: "GET", url: "/api/v1/public/lotes?page=1&pageSize=10", headers });
    const lotRead = await app.inject({ method: "GET", url: `/api/v1/public/lotes/${demoLot.identificadorPublico}`, headers });
    const lotUpdate = await app.inject({ method: "PATCH", url: `/api/v1/public/lotes/${demoLot.identificadorPublico}`, headers, payload: { versaoEsperada: 1, notaFiscal: "NF-DEMO-001-REV" } });
    const lotCancel = await app.inject({ method: "DELETE", url: "/api/v1/public/lotes/gcl_1123456789abcdef0123456789abcdef", headers, payload: { versaoEsperada: 1 } });
    const lotCrudResults = {
      listagem: { statusCode: lotList.statusCode, body: lotList.json() },
      consulta: { statusCode: lotRead.statusCode, body: lotRead.json() },
      atualizacao: { statusCode: lotUpdate.statusCode, body: lotUpdate.json() },
      cancelamento: { statusCode: lotCancel.statusCode, body: lotCancel.json() },
    };
    scopes = ["lotes:write"];
    partnerRecord.escopos = scopes;
    const noReadScope = await app.inject({ method: "GET", url: `/api/v1/public/lotes/${demoLot.identificadorPublico}`, headers });
    scopes = ["lotes:read"];
    partnerRecord.escopos = scopes;
    const noWriteScope = await app.inject({ method: "POST", url: "/api/v1/public/lotes", headers, payload: body });
    const forbiddenResult = {
      consultaSemEscopo: { statusCode: noReadScope.statusCode, body: noReadScope.json() },
      escritaSemEscopo: { statusCode: noWriteScope.statusCode, body: noWriteScope.json() },
    };
    scopes = ["lotes:read", "lotes:write", "rastreabilidade:read"];
    partnerRecord.escopos = scopes;
    forceRateLimit = true;
    const limited = await app.inject({ method: "POST", url: "/api/v1/public/lotes", headers, payload: body });
    const rateLimitResult = { statusCode: limited.statusCode, retryAfter: limited.headers["retry-after"], body: limited.json() };
    forceRateLimit = false;
    const invalidSecret = `${generated.prefixo}.${"X".repeat(43)}`;
    const invalidKey = await app.inject({ method: "POST", url: "/api/v1/public/lotes", headers: { ...headers, "x-api-key": invalidSecret }, payload: body });
    const invalidKeyResult = { statusCode: invalidKey.statusCode, body: invalidKey.json() };
    revoked = true;
    const revokedKey = await app.inject({ method: "POST", url: "/api/v1/public/lotes", headers, payload: body });
    const revokedKeyResult = { statusCode: revokedKey.statusCode, body: revokedKey.json() };
    revoked = false;
    const noKey = await app.inject({ method: "POST", url: "/api/v1/public/lotes", headers: { ...headers, "x-api-key": "" }, payload: body });
    const noKeyResult = { statusCode: noKey.statusCode, body: noKey.json() };
    return {
      input: { headers: { ...headers, "x-api-key": "[SEGREDO FICTÍCIO GERADO NO TESTE; OMITIDO]" }, body },
      scenarios: {
        submissaoAutorizada: successResult, cicloDeVidaLote: lotCrudResults, semEscopo: forbiddenResult, limiteExcedido: rateLimitResult,
        chaveInvalida: invalidKeyResult, chaveRevogada: revokedKeyResult, semChave: noKeyResult,
      },
      nature: "A rota e o createApiKeyAuthenticator reais são executados; Prisma e controller/limiter são simulados. A API Key é gerada em memória e não é incluída nas evidências.",
    };
  } finally {
    await app.close();
  }
}

async function demonstrateAsyncReport() {
  const reportIdentity: IntegrationIdentity = {
    parceiroId: "partner-report-demo", apiKeyId: "key-report-demo",
    escoposEfetivos: ["reports:read", "reports:write"],
    limiteRequisicoesPorMinuto: 60, limiteParceiroPorMinuto: 60, limiteChavePorMinuto: 60,
    maxEquipamentosPorSubmissao: 100, maxPayloadBytes: 1_048_576, permiteLoteSemEquipamentos: true,
  };
  const organizationId = "b2a4ce10-70d8-4f17-8c93-bf16f229f6e1";
  const writes: string[] = [];
  let persistedReport: any;
  let outboxPayload: any;
  const db: any = {
    async $transaction(callback: (tx: any) => Promise<any>) { return callback(this); },
    organizacao: { findFirst: async () => ({ id: organizationId }) },
    parceiroOrganizacao: { findFirst: async () => ({ id: "association-demo", organizacaoId: organizationId }) },
    relatorioAssincrono: {
      count: async () => 0,
      create: async ({ data }: any) => {
        persistedReport = { ...data, progresso: 0, criadoEm: new Date(), iniciadoEm: null, concluidoEm: null, mensagemErro: null, tamanhoBytes: null, arquivoPath: null };
        writes.push("relatorio");
        return persistedReport;
      },
      findFirst: async () => persistedReport,
    },
    outboxEvento: { create: async ({ data }: any) => { outboxPayload = data; writes.push("outbox"); return {}; } },
    eventoAuditoria: { create: async () => { writes.push("auditoria"); return {}; } },
  };
  const service = new RelatoriosAsyncService(new RelatoriosAsyncRepository(db));
  const controller = new RelatoriosAsyncController(service);
  const app = Fastify({ logger: false });
  app.decorate("authenticate", async () => undefined);
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } });
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Falha no cenário demonstrativo." } });
  });
  const authenticate = async (request: any) => { request.integrationIdentity = reportIdentity; };
  const limiter = { consume: async (_key: string, limit: number) => ({ allowed: true, limit, remaining: limit - 1, resetAt: Date.now() + 60_000, retryAfterSeconds: 60 }) };
  registerRelatoriosAsyncRoutes(app, controller, authenticate as any, limiter);
  const headers = { "x-api-key": "gc_live_DEMO_NAO_VALIDO", "x-integration-id": "gci_0123456789abcdef0123456789abcdef" };
  try {
    const accepted = await app.inject({ method: "POST", url: "/api/v1/public/relatorios", headers, payload: { tipo: "operacional", formato: "CSV" } });
    const created = accepted.json();
    const status = await app.inject({ method: "GET", url: `/api/v1/public/relatorios/${created.id}`, headers });
    return {
      input: { method: "POST", path: "/api/v1/public/relatorios", headers: { "x-api-key": "[FICTÍCIA]", "x-integration-id": headers["x-integration-id"] }, body: { tipo: "operacional", formato: "CSV" } },
      obtained: { accepted: { statusCode: accepted.statusCode, body: created }, status: { statusCode: status.statusCode, body: status.json() }, transactionWrites: writes, outbox: { evento: outboxPayload?.evento, agregado: outboxPayload?.agregado, reportIdMatches: outboxPayload?.agregadoId === created.id } },
    };
  } finally {
    await app.close();
  }
}

async function demonstrateWorkerReport() {
  const reportId = "d2a4ce10-70d8-4f17-8c93-bf16f229f6e1";
  const row: any = {
    id: reportId, tipo: "equipamentos", formato: "CSV", status: "PENDING", progresso: 0,
    organizacaoId: "b2a4ce10-70d8-4f17-8c93-bf16f229f6e1", parceiroId: null,
    criadoEm: new Date("2026-11-20T12:00:00.000Z"), iniciadoEm: null, concluidoEm: null,
    expiraEm: new Date("2099-11-20T12:00:00.000Z"), filtros: {}, arquivoPath: null,
    arquivoSha256: null, tamanhoBytes: null, heartbeatEm: null, leaseToken: null, jobId: "job-relatorio-demo",
  };
  const fixture = [{
    id: "equipment-demo-001", codigoBarrasInterno: "BC-DEMO-001", tipo: "NOTEBOOK", marca: "ACME", modelo: "NB-14",
    anoFabricacao: 2024, estadoFisico: "BOM_ESTADO", pesoQuilogramas: "2.500", statusRastreamento: "AGUARDANDO_TRIAGEM",
    valorAquisicao: "1000.00", createdAt: new Date("2026-11-20T10:00:00.000Z"),
  }];
  const db: any = {
    relatorioAssincrono: {
      findUnique: async () => row,
      updateMany: async ({ where, data }: any) => {
        if (where.id !== reportId) return { count: 0 };
        if (typeof where.status === "string" && row.status !== where.status) return { count: 0 };
        if (where.status?.in && !where.status.in.includes(row.status)) return { count: 0 };
        if (where.leaseToken && row.leaseToken !== where.leaseToken) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      count: async () => row.status === "PROCESSING" ? 1 : 0,
    },
    equipamento: { findMany: async () => fixture },
    eventoAuditoria: { create: async () => undefined },
  };
  const service = new RelatoriosAsyncService(new RelatoriosAsyncRepository(db));
  try {
    await service.process(reportId);
    const status = await service.getInternal(reportId);
    const download = await service.download(reportId, { usuarioId: "user-demo" }, "request-download-demo");
    let content = "";
    for await (const chunk of download.stream as any) content += chunk.toString();
    return {
      input: { reportId, tipo: row.tipo, formato: row.formato, fixture, outboxWorkerAlreadyDispatched: true },
      obtained: {
        status: status.status, progresso: status.progresso, downloadDisponivel: status.downloadDisponivel,
        filename: download.filename, contentType: download.contentType, size: download.size,
        csv: content, checksumValidatedByDownload: true,
      },
    };
  } finally {
    if (row.arquivoPath) await rm(resolve(process.env.REPORTS_DIR?.trim() || "./storage/reports", row.arquivoPath), { force: true });
  }
}

async function demonstrateReportRetry() {
  const reportId = "e2a4ce10-70d8-4f17-8c93-bf16f229f6e2";
  const row: any = { id: reportId, tipo: "equipamentos", formato: "JSON", status: "FAILED", expiraEm: new Date("2099-11-20T12:00:00.000Z"), criadoEm: new Date("2026-11-20T12:00:00.000Z"), jobId: "job-relatorio-retry-demo", organizacaoId: "b2a4ce10-70d8-4f17-8c93-bf16f229f6e1" };
  const outbox: any[] = [];
  const audit: any[] = [];
  const db: any = {
    async $transaction(callback: (tx: any) => Promise<any>) { return callback(this); },
    relatorioAssincrono: {
      findUnique: async () => row,
      updateMany: async ({ where, data }: any) => {
        if (where.status !== row.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    outboxEvento: { create: async ({ data }: any) => { outbox.push(data); } },
    eventoAuditoria: { create: async ({ data }: any) => { audit.push(data); } },
  };
  const service = new RelatoriosAsyncService(new RelatoriosAsyncRepository(db));
  const result = await service.reprocess(reportId, "user-demo", "request-retry-demo");
  return { obtained: { status: result.status, message: result.mensagem, event: outbox[0]?.evento, jobIdUsesRetrySuffix: outbox[0]?.payload?.jobId?.startsWith("job-relatorio-retry-demo-retry-") ?? false, auditAction: audit[0]?.acao } };
}

function readCommitHash(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "não disponível";
  } catch {
    return "não disponível nesta cópia";
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  await scenario(
    "Eficiência operacional: união de sessões por operador",
    "Verifica a atribuição exclusiva dos intervalos, médias/medianas por sessão, participação por lote e exclusão de sessão legada.",
    "serviço com repositório simulado",
    {
      lote1: ["A: 09:00–10:30", "B: 09:30–10:00 (sobreposição integral)", "B: 10:00–11:00"],
      lote2: ["A: 13:00–13:30", "B: 13:20–14:30", "AV2: 13:00–13:15 (não mensurável)"],
    },
    { tempoEfetivoTotalMinutos: 210, lotes: 2, operadorA: { total: 120, sessoes: 2, media: 60, mediana: 60, participacao: 57.14 }, operadorB: { total: 90, sessoes: 3, media: 30, mediana: 30, participacao: 42.86 } },
    demonstrateEfficiency,
    output => {
      const a = output.output.operadores[0]; const b = output.output.operadores[1];
      assert.equal(output.output.lotesConcluidos, 2);
      assert.equal(output.output.sessoesAv3Validas, 5);
      assert.equal(output.output.sessoesLegadas, 1);
      assert.equal(output.output.tempoEfetivoTotalMinutos, 210);
      assert.equal(output.output.mediaEfetivaPorLoteMinutos, 105);
      assert.deepEqual([a.tempoEfetivoTotalMinutos, a.sessoesConsideradas, a.mediaPorSessaoMinutos, a.medianaPorSessaoMinutos, a.participacaoPercentual], [120, 2, 60, 60, 57.14]);
      assert.deepEqual([b.tempoEfetivoTotalMinutos, b.sessoesConsideradas, b.mediaPorSessaoMinutos, b.medianaPorSessaoMinutos, b.participacaoPercentual], [90, 3, 30, 30, 42.86]);
    },
    ["Os dois lotes são contados uma vez cada.", "A interseção de intervalos não é duplicada.", "A sessão B totalmente coberta permanece na amostra como 0 minuto.", "O histórico AV2 não entra nas métricas por operador."],
  );

  await scenario(
    "Rentabilidade: valor estimado por peso e recuperação",
    "Executa a função de estimativa do serviço com uma referência cadastrada específica para tipo/marca/condição.",
    "serviço com repositório simulado",
    { equipamento: { tipo: "NOTEBOOK", marca: "ACME", estadoFisico: "BOM_ESTADO", pesoQuilogramas: 2 }, referencia: { valorMaterialPorKg: 20, percentualRecuperavel: 50 }, formula: "2 kg × R$ 20/kg × 50%" },
    { valorEstimado: 20, fonte: "REFERENCIA_CADASTRADA", materialRecuperavelKg: 1 },
    async () => ProfitabilityService.estimate(
      { tipo: "NOTEBOOK", marca: "ACME", estadoFisico: "BOM_ESTADO", pesoQuilogramas: 2 },
      [{ id: "ref-demo", tipo: "NOTEBOOK", marca: "ACME", estadoFisico: "BOM_ESTADO", valorMaterialPorKg: "20", percentualRecuperavel: "50" }],
    ),
    output => {
      assert.equal(output.valorEstimado, 20);
      assert.equal(output.fonte, "REFERENCIA_CADASTRADA");
      assert.equal(output.materialRecuperavelKg, 1);
    },
    ["O cálculo usa peso × preço/kg × percentual recuperável / 100.", "A fonte da referência é retornada.", "Valor estimado não é tratado como valor realizado."],
  );

  await scenario(
    "Vida útil: regressão linear OLS e disponibilidade",
    "Executa a regressão sobre três avaliações históricas e o serviço de vida útil com repository fake, verificando amostra, inclinação e R².",
    "serviço com repositório simulado",
    { anoFabricacao: 2020, avaliacoes: [{ data: "2021-01-01", valor: 800 }, { data: "2022-01-01", valor: 600 }, { data: "2023-01-01", valor: 400 }], valorAquisicao: 1000, condicao: "BOM_ESTADO" },
    { observacoes: 3, tendenciaNegativa: true, rSquaredMinimo: 0.35, previsaoDisponivel: true },
    async () => {
      const repository = {
        lifeData: async () => [{
          id: "equipment-demo", tipo: "NOTEBOOK", marca: "ACME", modelo: "NB-14", anoFabricacao: 2020,
          valorAquisicao: 1000, estadoFisico: "BOM_ESTADO",
          depreciacoes: [
            { id: "dep-1", equipamentoId: "equipment-demo", avaliadoEm: new Date("2021-01-01T00:00:00Z"), valorEstimado: 800 },
            { id: "dep-2", equipamentoId: "equipment-demo", avaliadoEm: new Date("2022-01-01T00:00:00Z"), valorEstimado: 600 },
            { id: "dep-3", equipamentoId: "equipment-demo", avaliadoEm: new Date("2023-01-01T00:00:00Z"), valorEstimado: 400 },
          ], falhas: [], manutencoes: [],
        }],
        saveRun: async () => undefined,
      } as unknown as AnalyticsRepository;
      const points: Array<[number, number]> = [[12, 800], [24, 600], [36, 400]];
      const regression = linearRegression(points)!;
      const result = await new UsefulLifeService(repository).execute();
      const prediction = result.previsoes[0]!;
      return {
        regressao: { slopeValorPorMes: regression.slope, interceptValor: regression.intercept, rSquared: regression.rSquared },
        resultadoServico: {
          observacoes: prediction.observacoes, tendenciaValorPorMes: prediction.tendenciaValorPorMes,
          rSquared: prediction.rSquared, mesesRemanescentesEstimados: prediction.mesesRemanescentesEstimados,
          indisponivel: prediction.indisponivel, motivoIndisponibilidade: prediction.motivoIndisponibilidade,
        },
      };
    },
    output => {
      assert.equal(output.resultadoServico.observacoes, 3);
      assert.ok(output.regressao.slopeValorPorMes < 0);
      assert.ok(output.resultadoServico.rSquared >= 0.35);
      assert.equal(output.resultadoServico.indisponivel, false);
      assert.ok(output.resultadoServico.mesesRemanescentesEstimados > 0);
    },
    ["A regressão recebe idade em meses e valor estimado.", "Amostra mínima de três observações é atendida.", "A inclinação é negativa e o R² supera 0,35.", "O resultado é estimativo e não probabilístico."],
  );

  await scenario(
    "API pública: autenticação, escopo, rate limit e submissão",
    "Exercita a rota Fastify real e o createApiKeyAuthenticator real; Prisma, controller e rate limiter usam doubles determinísticos, sem consulta ao PostgreSQL.",
    "rota HTTP real com autenticador/serviço simulado",
    { method: "POST", path: "/api/v1/public/lotes", apiKey: "[FICTÍCIA]", integrationId: "gci_DEMO", idempotencyKey: "demo-submission-001", body: { externalId: "erp-demo-001", notaFiscal: "NF-DEMO-001", transportadora: "Transportadora Exemplo", equipamentos: [{ tipo: "NOTEBOOK", marca: "Exemplo", modelo: "NB-14", anoFabricacao: 2024, estadoFisico: "BOM_ESTADO", pesoQuilogramas: "2.500" }] } },
    { submissao: 201, listagem: 200, consulta: 200, atualizacao: 200, cancelamento: 200, faltaEscopo: 403, limite: 429, apiKeyAusente: 401, apiKeyInvalida: 401, apiKeyRevogada: 401 },
    demonstratePublicApi,
    output => {
      assert.equal(output.scenarios.submissaoAutorizada.statusCode, 201);
      assert.equal(output.scenarios.semEscopo.statusCode, 403);
      assert.equal(output.scenarios.limiteExcedido.statusCode, 429);
      assert.equal(output.scenarios.limiteExcedido.retryAfter, "37");
      assert.equal(output.scenarios.semChave.statusCode, 401);
      assert.equal(output.scenarios.chaveInvalida.statusCode, 401);
      assert.equal(output.scenarios.chaveRevogada.statusCode, 401);
      assert.equal(output.scenarios.submissaoAutorizada.body.quantidadeEquipamentos, 1);
      assert.equal(output.scenarios.cicloDeVidaLote.listagem.statusCode, 200);
      assert.equal(output.scenarios.cicloDeVidaLote.consulta.statusCode, 200);
      assert.equal(output.scenarios.cicloDeVidaLote.atualizacao.statusCode, 200);
      assert.equal(output.scenarios.cicloDeVidaLote.atualizacao.body.versao, 2);
      assert.equal(output.scenarios.cicloDeVidaLote.cancelamento.statusCode, 200);
      assert.equal(output.scenarios.cicloDeVidaLote.cancelamento.body.status, "CANCELADO");
      assert.equal(output.scenarios.semEscopo.consultaSemEscopo.statusCode, 403);
      assert.equal(output.scenarios.semEscopo.escritaSemEscopo.statusCode, 403);
    },
    ["A rota Fastify real valida schema e headers obrigatórios.", "A submissão retorna HTTP 201; listagem e consulta retornam HTTP 200.", "A rota PATCH aplica a versão recebida e retorna versão 2.", "A rota DELETE demonstra cancelamento lógico sem exclusão física do contrato.", "O escopo lotes:read não autoriza escrita e lotes:write não autoriza leitura básica.", "O createApiKeyAuthenticator real valida formato/hash com registro Prisma simulado.", "Excesso retorna HTTP 429 com Retry-After.", "Chave ausente, inválida e revogada retornam HTTP 401.", "O Prisma, controller e limiter são simulados; não há prova de persistência PostgreSQL."],
  );

  await scenario(
    "Relatórios assíncronos: HTTP 202, identificador, status e Outbox",
    "Executa as rotas públicas Fastify reais e o serviço de solicitação/status com um cliente Prisma simulado; não publica no Redis nem executa worker real.",
    "rota HTTP real com autenticador/serviço simulado",
    { method: "POST", path: "/api/v1/public/relatorios", headers: { "x-api-key": "[FICTÍCIA]", "x-integration-id": "gci_0123456789abcdef0123456789abcdef" }, body: { tipo: "operacional", formato: "CSV" } },
    { acceptedStatus: 202, reportStatus: "PENDING", statusQuery: 200, writes: ["relatorio", "outbox", "auditoria"], outboxEvent: "GERAR_RELATORIO" },
    demonstrateAsyncReport,
    output => {
      assert.equal(output.obtained.accepted.statusCode, 202);
      assert.match(output.obtained.accepted.body.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.equal(output.obtained.accepted.body.status, "PENDING");
      assert.equal(output.obtained.status.statusCode, 200);
      assert.equal(output.obtained.status.body.status, "PENDING");
      assert.deepEqual(output.obtained.transactionWrites, ["relatorio", "outbox", "auditoria"]);
      assert.equal(output.obtained.outbox.evento, "GERAR_RELATORIO");
      assert.equal(output.obtained.outbox.reportIdMatches, true);
    },
    ["A rota real responde HTTP 202 com task ID gerado pelo serviço.", "O endpoint de status consulta o registro pendente.", "Registro, Outbox e auditoria são chamados na mesma transação simulada.", "O cliente Prisma é mock: não comprova persistência, Redis, worker, retry ou download em infraestrutura real."],
  );

  await scenario(
    "Worker de relatórios: processamento, arquivo, status e download",
    "Executa o método de processamento do serviço, grava arquivo CSV no armazenamento local, valida checksum e baixa o conteúdo; banco simulado, sem Redis/BullMQ real.",
    "serviço com repositório simulado",
    { reportId: "d2a4ce10-70d8-4f17-8c93-bf16f229f6e1", tipo: "equipamentos", formato: "CSV", fixture: [{ tipo: "NOTEBOOK", marca: "ACME", modelo: "NB-14", pesoQuilogramas: "2.500" }] },
    { status: "COMPLETED", progresso: 100, downloadDisponivel: true, contentType: "text/csv; charset=utf-8", csv: '"id","codigoBarrasInterno","tipo","marca","modelo","anoFabricacao","estadoFisico","pesoQuilogramas","statusRastreamento","valorAquisicao","createdAt"\r\n"equipment-demo-001","BC-DEMO-001","NOTEBOOK","ACME","NB-14","2024","BOM_ESTADO","2.500","AGUARDANDO_TRIAGEM","1000.00","2026-11-20T10:00:00.000Z"\r\n' },
    demonstrateWorkerReport,
    output => {
      assert.equal(output.obtained.status, "COMPLETED");
      assert.equal(output.obtained.progresso, 100);
      assert.equal(output.obtained.downloadDisponivel, true);
      assert.equal(output.obtained.contentType, "text/csv; charset=utf-8");
      assert.match(output.obtained.filename, /^greencode-relatorio-d2a4ce10-70d8-4f17-8c93-bf16f229f6e1\.csv$/);
      assert.equal(output.obtained.csv, '"id","codigoBarrasInterno","tipo","marca","modelo","anoFabricacao","estadoFisico","pesoQuilogramas","statusRastreamento","valorAquisicao","createdAt"\r\n"equipment-demo-001","BC-DEMO-001","NOTEBOOK","ACME","NB-14","2024","BOM_ESTADO","2.500","AGUARDANDO_TRIAGEM","1000.00","2026-11-20T10:00:00.000Z"\r\n');
      assert.ok(output.obtained.checksumValidatedByDownload);
    },
    ["O processamento real do serviço percorre o fluxo COMPLETED e gera arquivo local.", "O download lê o arquivo e compara seu SHA-256 antes de disponibilizá-lo.", "Fixture de banco simulada; não executa worker BullMQ nem conexão Redis."],
  );

  await scenario(
    "Relatórios assíncronos: retry após falha",
    "Executa a operação de reprocessamento do serviço para um relatório FAILED dentro da validade e confere novo evento Outbox e auditoria.",
    "serviço com repositório simulado",
    { reportId: "e2a4ce10-70d8-4f17-8c93-bf16f229f6e2", statusInicial: "FAILED", validadeAte: "2099-11-20T12:00:00.000Z" },
    { statusFinal: "PENDING", outboxEvent: "REPROCESSAR_RELATORIO", auditAction: "REPROCESSAMENTO_RELATORIO" },
    demonstrateReportRetry,
    output => {
      assert.equal(output.obtained.status, "PENDING");
      assert.equal(output.obtained.event, "REPROCESSAR_RELATORIO");
      assert.equal(output.obtained.jobIdUsesRetrySuffix, true);
      assert.equal(output.obtained.auditAction, "REPROCESSAMENTO_RELATORIO");
    },
    ["Somente relatório FAILED dentro da validade é reprocessado.", "Novo job recebe sufixo próprio e evento Outbox.", "Auditoria registra o reprocessamento.", "Persistência é simulada; envio e retry real da fila Redis não são executados."],
  );

  await scenario(
    "Relatório: serialização CSV",
    "Gera CSV com o serializador utilizado pelo worker de relatórios assíncronos.",
    "serializador puro",
    [{ tipo: "NOTEBOOK", quantidade: 1, valorEstimado: 20 }],
    '"tipo","quantidade","valorEstimado"\r\n"NOTEBOOK","1","20"\r\n',
    async () => serializeReport([{ tipo: "NOTEBOOK", quantidade: 1, valorEstimado: 20 }], "CSV"),
    output => assert.equal(output, '"tipo","quantidade","valorEstimado"\r\n"NOTEBOOK","1","20"\r\n'),
    ["Usa a função de serialização compartilhada com o worker.", "A saída CSV é comparada byte a byte com o contrato esperado."],
  );

  await scenario(
    "HTTP: saúde e documento OpenAPI",
    "Inicializa Fastify com o Swagger UI integrado, sem banco, consulta /health, /docs/json e /docs/ e confere a ordem oficial das tags no documento OpenAPI.",
    "Fastify sem banco",
    { endpoints: ["GET /health", "GET /docs/json", "GET /docs/"] },
    {
      health: 200,
      openapi: 200,
      openapiTags: [
        "Autenticação", "Saúde", "Usuários", "Organizações", "Contratos", "Parâmetros", "Auditoria",
        "Parceiros", "API Keys", "API Pública", "Rastreabilidade", "Análises", "Relatórios Assíncronos",
        "Relatórios", "Lotes", "Equipamentos", "Movimentações",
      ],
      swaggerHtml: 200,
    },
    async () => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = "test";
      const app = buildApp();
      try {
        const [health, openapi, docs] = await Promise.all([
          app.inject({ method: "GET", url: "/health" }),
          app.inject({ method: "GET", url: "/docs/json" }),
          app.inject({ method: "GET", url: "/docs/" }),
        ]);
        return {
          health: { statusCode: health.statusCode, body: health.json() },
          openapi: {
            statusCode: openapi.statusCode,
            title: openapi.json().info?.title,
            healthPath: Boolean(openapi.json().paths?.["/health"]),
            tags: openapi.json().tags?.map((tag: any) => tag.name) ?? [],
          },
          swaggerHtml: { statusCode: docs.statusCode, contentType: docs.headers["content-type"] },
        };
      } finally {
        await app.close();
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
      }
    },
    output => {
      assert.equal(output.health.statusCode, 200);
      assert.deepEqual(output.health.body, { status: "ok", service: "greencode-api" });
      assert.equal(output.openapi.statusCode, 200);
      assert.equal(output.openapi.title, "GreenCode API — AV3");
      assert.deepEqual(output.openapi.tags, [
        "Autenticação", "Saúde", "Usuários", "Organizações", "Contratos", "Parâmetros", "Auditoria",
        "Parceiros", "API Keys", "API Pública", "Rastreabilidade", "Análises", "Relatórios Assíncronos",
        "Relatórios", "Lotes", "Equipamentos", "Movimentações",
      ]);
      assert.equal(output.swaggerHtml.statusCode, 200);
      assert.match(output.swaggerHtml.contentType, /text\/html/);
    },
    ["O app responde sem dependência de banco no endpoint de saúde.", "O JSON OpenAPI é serializado pelo plugin @fastify/swagger.", "A página HTML vem do Swagger UI integrado ao Fastify."],
  );

  const passed = evidence.filter(item => item.status === "APROVADO").length;
  const failed = evidence.filter(item => item.status === "REPROVADO").length;
  const blocked = evidence.filter(item => item.status === "BLOQUEADO").length;
  const notExecuted = evidence.filter(item => item.status === "NAO_EXECUTADO").length;
  const markdown = [
    "# Evidências da demonstração automatizada — GreenCode AV3", "",
    `- Executado em: ${startedAt}`, `- Commit: ${readCommitHash()}`, `- Runtime: ${process.version}`, `- Plataforma: ${process.platform}/${process.arch}`,
    `- Tipo de execução: teste demonstrativo (Fastify com doubles e serviços de domínio)`,
    `- Cenários: ${evidence.length}`, `- Aprovados: ${passed}`, `- Reprovados: ${failed}`, `- Bloqueados: ${blocked}`, `- Não executados neste modo: ${notExecuted}`, "",
    "> Esta demonstração registra valores retornados nesta execução. Cenários que usam mocks estão identificados; não equivalem a integração com PostgreSQL/Redis.", "",
    ...evidence.flatMap((item, index) => [
      `## ${index + 1}. ${item.name}`, "", `**Objetivo:** ${item.objective}`, "",
      `**Módulo:** ${item.module}  `, `**Natureza:** ${item.nature}  `, `**Classificação:** ${item.testLevel}  `,
      `**Dependências:** ${item.dependencies.join(", ")}  `, `**Arquivo do cenário:** ${item.sourceFile}  `, `**Duração:** ${item.durationMs.toFixed(2)} ms`, "",
      "**Entrada**", "```json", JSON.stringify(item.input, null, 2), "```", "",
      "**Resultado esperado (asserts)**", "```json", JSON.stringify(item.expected, null, 2), "```", "",
      "**Resultado obtido (retorno real)**", "```json", JSON.stringify(item.obtained, null, 2), "```", "",
      "**Validações**", ...item.validations.map(value => `- ${value}`), "",
      `**Diferença nos critérios assertivos:** ${item.status === "APROVADO" ? "Nenhuma; todos os asserts foram satisfeitos." : item.failure ?? "Os asserts não foram satisfeitos."}`, "",
      `**Status:** ${item.status}`, ...(item.failure ? [`**Falha:** ${item.failure}`] : []), "",
    ]),
    "## Escopo não coberto por este modo demonstrativo", "",
    "A criação e o processamento assíncrono de relatórios (Outbox → Redis/BullMQ → worker → arquivo persistido), isolamento real de parceiros/API Keys, revogação no PostgreSQL, migrations e retentativas dependem de PostgreSQL 17 e Redis 7. Esses fluxos permanecem cobertos pelos testes de integração em `src/tests/integration/`; devem ser executados com `npm run test:integration` no ambiente de testes dedicado. Este relatório não os apresenta como executados.", "",
    "As demonstrações de eficiência, rentabilidade e vida útil utilizam repositórios fictícios determinísticos, mas chamam os serviços/funções analíticas da aplicação. A demonstração HTTP pública executa a rota Fastify e o `createApiKeyAuthenticator` reais, incluindo geração efêmera e validação de formato/hash de API Key; o registro Prisma, o controller e o rate limiter são simulados. Isso não comprova persistência, revogação consultada no PostgreSQL nem limitação concorrente entre instâncias.", "",
  ].join("\n");
  const reportPath = join(process.cwd(), "docs", "evidencias-testes-av3.md");
  const generatedSectionMarker = "<!-- EXECUCOES_DEMONSTRATIVAS_ATUAIS -->";
  let historicalContent = "";
  try {
    historicalContent = await readFile(reportPath, "utf8");
  } catch {
    // O relatório histórico pode ainda não existir em uma instalação nova.
  }
  const markerIndex = historicalContent.indexOf(generatedSectionMarker);
  const preservedHistory = markerIndex >= 0
    ? historicalContent.slice(0, markerIndex).trimEnd()
    : historicalContent.trimEnd();
  await writeFile(reportPath, `${preservedHistory}\n\n${generatedSectionMarker}\n\n${markdown}\n`, "utf8");

  console.log("\n========== GREENCODE AV3 · TESTES DEMONSTRATIVOS ==========");
  console.log(`Início: ${startedAt} | Node: ${process.version} | Plataforma: ${process.platform}/${process.arch} | Commit: ${readCommitHash()}`);
  for (const [index, item] of evidence.entries()) {
    console.log(`\n[${item.status}] ${index + 1}. ${item.name}`);
    console.log(`MÓDULO: ${item.module} | TIPO: ${item.testLevel} | DURAÇÃO: ${item.durationMs.toFixed(2)} ms`);
    console.log(`DEPENDÊNCIAS: ${item.dependencies.join(", ")} | ARQUIVO: ${item.sourceFile}`);
    console.log("ENTRADA:", JSON.stringify(item.input, null, 2));
    console.log("ESPERADO (critérios verificados):", JSON.stringify(item.expected, null, 2));
    console.log("OBTIDO (retorno desta execução):", JSON.stringify(item.obtained, null, 2));
    console.log("VALIDAÇÕES:");
    for (const validation of item.validations) console.log(`  - ${validation}`);
    console.log("DIFERENÇA NOS ASSERTS:", item.status === "APROVADO" ? "Nenhuma; todos os asserts foram satisfeitos." : item.failure ?? "As condições esperadas não foram satisfeitas.");
    if (item.failure) console.log("FALHA:", item.failure);
  }
  console.log(`\nResumo: ${evidence.length} cenários | ${passed} aprovados | ${failed} reprovados | ${blocked} bloqueados | ${notExecuted} não executados. Evidências: ${reportPath}`);
  if (failed > 0 || blocked > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error("Falha ao executar a demonstração GreenCode AV3:", error);
  process.exitCode = 1;
});
