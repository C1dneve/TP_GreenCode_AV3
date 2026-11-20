import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { REPORT_JOB_DEFAULT_OPTIONS } from "../infrastructure/queue/report-queue.js";
import type { IntegrationIdentity } from "../modules/api-publica/integration-auth.js";
import { RelatoriosAsyncRepository } from "../modules/relatorios-async/relatorios-async.repository.js";
import { RelatoriosAsyncService } from "../modules/relatorios-async/relatorios-async.service.js";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const partnerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const apiKeyId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const identity: IntegrationIdentity = {
  parceiroId: partnerId,
  apiKeyId,
  escoposEfetivos: ["reports:read", "reports:write"],
  limiteRequisicoesPorMinuto: 60,
  limiteParceiroPorMinuto: 60,
  limiteChavePorMinuto: 60,
  maxEquipamentosPorSubmissao: 100,
  maxPayloadBytes: 1_000_000,
  permiteLoteSemEquipamentos: false,
};

test("fila de relatórios declara cinco tentativas com backoff exponencial", () => {
  assert.equal(REPORT_JOB_DEFAULT_OPTIONS.attempts, 5);
  assert.equal(REPORT_JOB_DEFAULT_OPTIONS.backoff.type, "exponential");
  assert.equal(REPORT_JOB_DEFAULT_OPTIONS.backoff.delay, 3_000);
});

test("solicitação pública grava relatório, Outbox e auditoria na mesma transação", async () => {
  const writes: string[] = [];
  const report = { id: randomUUID(), tipo: "equipamentos", formato: "JSON", status: "PENDING", criadoEm: new Date(), expiraEm: new Date(Date.now() + 86_400_000) };
  const db: any = {
    async $transaction(callback: (tx: any) => Promise<any>) { return callback(this); },
    organizacao: { findFirst: async () => ({ id: organizationId }) },
    parceiroOrganizacao: { findFirst: async () => ({ id: "association" }) },
    relatorioAssincrono: { count: async () => 0, create: async ({ data }: any) => { writes.push("report"); return { ...report, ...data }; } },
    outboxEvento: { create: async () => { writes.push("outbox"); return {}; } },
    eventoAuditoria: { create: async () => { writes.push("audit"); return {}; } },
  };
  const service = new RelatoriosAsyncService(new RelatoriosAsyncRepository(db));
  const result = await service.requestPublic({ tipo: "equipamentos", formato: "JSON", organizacaoId: organizationId }, identity, "request-123");
  assert.equal(result.status, "PENDING");
  assert.ok(result.id);
  assert.deepEqual(writes, ["report", "outbox", "audit"]);
});

test("parceiro sem vínculo não consegue solicitar relatório para outra organização", async () => {
  let outboxWrites = 0;
  const db: any = {
    async $transaction(callback: (tx: any) => Promise<any>) { return callback(this); },
    organizacao: { findFirst: async () => ({ id: organizationId }) },
    parceiroOrganizacao: { findFirst: async () => null },
    relatorioAssincrono: { count: async () => 0, create: async () => { throw new Error("não deveria persistir"); } },
    outboxEvento: { create: async () => { outboxWrites += 1; } },
    eventoAuditoria: { create: async () => undefined },
  };
  const service = new RelatoriosAsyncService(new RelatoriosAsyncRepository(db));
  await assert.rejects(service.requestPublic({ tipo: "equipamentos", formato: "CSV", organizacaoId: organizationId }, identity, "request-456"), (error: any) => error.statusCode === 403);
  assert.equal(outboxWrites, 0);
});

test("consulta pública filtra relatório pelo parceiro proprietário", async () => {
  let where: any;
  const db: any = { relatorioAssincrono: { findFirst: async (args: any) => { where = args.where; return null; } } };
  const service = new RelatoriosAsyncService(new RelatoriosAsyncRepository(db));
  await assert.rejects(service.getPublic(randomUUID(), identity), (error: any) => error.statusCode === 404);
  assert.equal(where.parceiroId, partnerId);
  assert.ok(where.organizacao.parceiros.some.parceiroId === partnerId);
});

test("download CSV/JSON verifica escopo, vínculo e checksum antes de expor o arquivo", async () => {
  const reportId = randomUUID();
  const filename = `test-report-${randomUUID()}.json`;
  const contents = JSON.stringify({ valid: true, reportId });
  const baseDir = resolve("./storage/reports");
  const filePath = resolve(baseDir, filename);
  await mkdir(baseDir, { recursive: true });
  await writeFile(filePath, contents, "utf8");
  const digest = createHash("sha256").update(contents).digest("hex");
  const report = { id: reportId, parceiroId: partnerId, organizacaoId: organizationId, expiraEm: new Date(Date.now() + 60_000), status: "COMPLETED", arquivoPath: filename, arquivoSha256: digest, formato: "JSON" };
  const audit: any[] = [];
  const db: any = {
    relatorioAssincrono: { findUnique: async () => report },
    parceiroOrganizacao: { findFirst: async ({ where }: any) => where.parceiroId === partnerId && where.organizacaoId === organizationId ? ({ id: "association" }) : null },
    eventoAuditoria: { create: async ({ data }: any) => { audit.push(data); } },
  };
  try {
    const service = new RelatoriosAsyncService(new RelatoriosAsyncRepository(db));
    const result = await service.download(reportId, { parceiroId: partnerId, apiKeyId, escoposEfetivos: ["reports:read"] }, "request-download");
    assert.equal(result.filename, `greencode-relatorio-${reportId}.json`);
    assert.equal(result.contentType, "application/json; charset=utf-8");
    let streamed = "";
    for await (const chunk of result.stream as any) streamed += chunk.toString();
    assert.equal(streamed, contents);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].acao, "DOWNLOAD_RELATORIO");
  } finally {
    await rm(filePath, { force: true });
    const remaining = await readFile(resolve(baseDir, filename)).catch(() => null);
    assert.equal(remaining, null);
  }
});

test("processamento com falha registra FAILED para permitir retry do BullMQ", async () => {
  const reportId = randomUUID();
  const report = { id: reportId, status: "PENDING", expiraEm: new Date(Date.now() + 60_000), iniciadoEm: null, filtros: {}, organizacaoId: organizationId, formato: "JSON", tipo: "equipamentos" };
  const updates: any[] = [];
  const db: any = {
    relatorioAssincrono: {
      findUnique: async () => report,
      updateMany: async ({ data }: any) => { updates.push(data); return { count: 1 }; },
      count: async () => 1,
    },
    equipamento: { findMany: async () => { throw new Error("falha transitória simulada"); } },
  };
  const service = new RelatoriosAsyncService(new RelatoriosAsyncRepository(db));
  await assert.rejects(service.process(reportId), /falha transitória simulada/);
  assert.ok(updates.some(update => update.status === "PROCESSING"));
  assert.ok(updates.some(update => update.status === "FAILED"));
  assert.equal(updates.at(-1)?.mensagemErro, "Falha ao gerar o arquivo. A tarefa poderá ser reprocessada.");
});
