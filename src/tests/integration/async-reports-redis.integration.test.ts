import "dotenv/config";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Queue, Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { createPrismaClient } from "../../infrastructure/database/prisma.js";
import { generateApiKey } from "../../modules/integracoes/api-key-security.js";
import { createRedisConnection, createReportQueue, dispatchReportOutbox, REPORT_JOB_DEFAULT_OPTIONS, REPORT_QUEUE_NAME } from "../../infrastructure/queue/report-queue.js";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const previousNodeEnv = process.env.NODE_ENV;
const previousReportsDir = process.env.REPORTS_DIR;
const previousRedisUrl = process.env.REDIS_URL;
let prisma: PrismaClient | undefined;
let app: FastifyInstance | undefined;
let queue: Queue | undefined;
let worker: Worker | undefined;
let reportsDirectory: string | undefined;
let organizationId: string | undefined;
let partnerId: string | undefined;
let associationId: string | undefined;
let apiKeyId: string | undefined;
let reportId: string | undefined;
const reportIds: string[] = [];
let generatedApiKey = "";
let publicIntegrationId = "";
let transientFailureInjected = false;

function validCnpj(): string {
  const base = String(randomInt(0, 1_000_000_000_000)).padStart(12, "0");
  const digit = (value: string, weights: number[]) => {
    const sum = [...value].reduce((total, char, index) => total + Number(char) * weights[index]!, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = digit(`${base}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${first}${second}`;
}

async function waitFor<T>(load: () => Promise<T | null | undefined>, predicate: (value: T) => boolean, timeoutMs = 45_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await load();
    if (value !== null && value !== undefined && predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Tempo esgotado aguardando condição de integração (${timeoutMs} ms).`);
}

before(async () => {
  if (!databaseUrl) throw new Error("Integração de relatórios bloqueada: DATABASE_URL deve apontar para uma base dedicada com 'test' no nome.");
  const parsedDatabase = new URL(databaseUrl);
  const configuredDatabase = decodeURIComponent(parsedDatabase.pathname.replace(/^\//, ""));
  if (!/(^|[_-])test($|[_-])/i.test(configuredDatabase)) throw new Error("Segurança: a integração Redis/PostgreSQL foi recusada porque o nome da base não contém 'test'.");
  if (!redisUrl) throw new Error("Integração de relatórios bloqueada: configure REDIS_URL para uma instância Redis 7 de teste.");

  prisma = createPrismaClient(databaseUrl);
  await prisma.$connect();
  const actualDatabase = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  if (!actualDatabase[0]?.name || !/(^|[_-])test($|[_-])/i.test(actualDatabase[0].name)) {
    await prisma.$disconnect();
    prisma = undefined;
    throw new Error("Segurança: conexão recusada porque current_database() não identifica uma base de teste.");
  }

  process.env.NODE_ENV = "test";
  reportsDirectory = await mkdtemp(join(tmpdir(), "greencode-reports-integration-"));
  process.env.REPORTS_DIR = reportsDirectory;

  organizationId = randomUUID();
  partnerId = randomUUID();
  associationId = randomUUID();
  const generated = generateApiKey();
  const associationPublicId = `gci_${randomBytes(24).toString("base64url")}`;
  generatedApiKey = generated.valorCompleto;
  publicIntegrationId = associationPublicId;

  await prisma.organizacao.create({ data: {
    id: organizationId,
    razaoSocial: `Organização de integração ${suffix}`,
    cnpj: validCnpj(),
    email: `reports-${suffix}@example.test`,
  } });
  await prisma.parceiro.create({ data: {
    id: partnerId,
    nome: `Parceiro de relatórios ${suffix}`,
    escopos: ["reports:read", "reports:write"],
  } });
  await prisma.parceiroOrganizacao.create({ data: {
    id: associationId,
    parceiroId: partnerId,
    organizacaoId,
    identificadorPublico: associationPublicId,
  } });
  const apiKey = await prisma.apiKey.create({ data: {
    parceiroId: partnerId,
    nome: "Chave temporária para integração Redis",
    prefixo: generated.prefixo,
    segredoHash: generated.segredoHash,
    escopos: ["reports:read", "reports:write"],
  } });
  apiKeyId = apiKey.id;

  // Importar o módulo somente depois de REPORTS_DIR estar definido, pois o serviço
  // resolve o diretório de armazenamento durante a avaliação do módulo.
  const [{ buildApp }, { RelatoriosAsyncRepository }, { RelatoriosAsyncService }] = await Promise.all([
    import("../../app.js"),
    import("../../modules/relatorios-async/relatorios-async.repository.js"),
    import("../../modules/relatorios-async/relatorios-async.service.js"),
  ]);
  app = buildApp({ prisma, jwtSecret: "redis-report-integration-only-jwt-secret-32-bytes-minimum" });
  await app.ready();

  queue = createReportQueue();
  await queue.waitUntilReady();
  const reportService = new RelatoriosAsyncService(new RelatoriosAsyncRepository(prisma));
  let injectedTransientFailure = false;
  worker = new Worker(REPORT_QUEUE_NAME, async job => {
    if (job.name === "terminal-failure-test") {
      throw new Error("Falha terminal injetada para verificar o estado failed do BullMQ.");
    }
    if (job.data.reportId === reportId && !injectedTransientFailure) {
      injectedTransientFailure = true;
      transientFailureInjected = true;
      throw new Error("Falha transitória injetada pelo teste para exercitar retry do BullMQ.");
    }
    await reportService.process(job.data.reportId);
  }, { connection: createRedisConnection(), concurrency: 1 });
  await worker.waitUntilReady();

});

after(async () => {
  if (worker) await worker.close();
  if (queue) {
    try {
      // Um relatório recuperado pode possuir, além do job original, um job com
      // lease-version próprio. Remover somente report.jobId deixaria esse job
      // órfão no Redis entre execuções.
      const jobs = await queue.getJobs(["waiting", "active", "completed", "failed", "delayed", "paused"], 0, -1);
      const ownedIds = new Set(reportIds);
      for (const job of jobs) {
        if (ownedIds.has(String(job.data?.reportId ?? ""))) await job.remove();
      }
    } catch { /* limpeza best-effort dos jobs exclusivos desta execução */ }
  }
  if (queue) await queue.close();
  if (app) await app.close();
  if (prisma) {
    try {
      if (reportIds.length) {
        await prisma.eventoAuditoria.deleteMany({ where: { entidadeId: { in: reportIds } } });
        await prisma.outboxEvento.deleteMany({ where: { agregadoId: { in: reportIds } } });
        await prisma.relatorioAssincrono.deleteMany({ where: { id: { in: reportIds } } });
      }
      if (apiKeyId) await prisma.apiKey.deleteMany({ where: { id: apiKeyId } });
      if (associationId) await prisma.parceiroOrganizacao.deleteMany({ where: { id: associationId } });
      if (partnerId) {
        await prisma.eventoAuditoria.deleteMany({ where: { parceiroId: partnerId } });
        await prisma.parceiro.deleteMany({ where: { id: partnerId } });
      }
      if (organizationId) {
        await prisma.eventoAuditoria.deleteMany({ where: { organizacaoId: organizationId } });
        await prisma.organizacao.deleteMany({ where: { id: organizationId } });
      }
    } finally {
      await prisma.$disconnect();
    }
  }
  if (reportsDirectory) await rm(reportsDirectory, { recursive: true, force: true });
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousReportsDir === undefined) delete process.env.REPORTS_DIR;
  else process.env.REPORTS_DIR = previousReportsDir;
  if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = previousRedisUrl;
  generatedApiKey = "";
  publicIntegrationId = "";
  transientFailureInjected = false;
});

test("relatório público percorre PostgreSQL, Outbox, Redis/BullMQ, worker, arquivo e download com retry", async () => {
  assert.ok(app);
  assert.ok(prisma);
  assert.ok(queue);
  assert.ok(reportId === undefined);
  const apiKey = generatedApiKey;
  const integrationId = publicIntegrationId;
  assert.ok(apiKey && integrationId);

  const accepted = await app.inject({
    method: "POST",
    url: "/api/v1/public/relatorios",
    headers: { "x-api-key": apiKey, "x-integration-id": integrationId },
    payload: { tipo: "equipamentos", formato: "JSON" },
  });
  assert.equal(accepted.statusCode, 202, accepted.body);
  const acceptedBody = accepted.json();
  reportId = acceptedBody.id as string;
  reportIds.push(reportId);
  assert.match(reportId, /^[0-9a-f-]{36}$/i);
  assert.equal(acceptedBody.status, "PENDING");

  const reportInitially = await prisma.relatorioAssincrono.findUnique({ where: { id: reportId } });
  assert.ok(reportInitially, "A solicitação deve ser persistida antes de retornar HTTP 202.");
  assert.equal(reportInitially.status, "PENDING");
  assert.equal(reportInitially.parceiroId, partnerId);
  assert.equal(reportInitially.organizacaoId, organizationId);
  const outboxBefore = await prisma.outboxEvento.findFirst({ where: { agregadoId: reportId, evento: "GERAR_RELATORIO" } });
  assert.ok(outboxBefore, "O evento Outbox deve estar registrado na mesma transação do relatório.");
  assert.equal(outboxBefore.publicadoEm, null);

  // Tenta publicar usando um endpoint Redis isolado que recusa conexão. A fila
  // principal continua conectada ao Redis real e será usada na recuperação.
  const unavailableRedisQueue = new Queue(REPORT_QUEUE_NAME, {
    connection: {
      host: "127.0.0.1", port: 1, maxRetriesPerRequest: null,
      enableReadyCheck: true, enableOfflineQueue: false, retryStrategy: () => null,
    },
    defaultJobOptions: REPORT_JOB_DEFAULT_OPTIONS,
  });
  unavailableRedisQueue.on("error", () => undefined);
  const failedPublishCount = await dispatchReportOutbox(prisma, unavailableRedisQueue);
  await unavailableRedisQueue.close();
  assert.equal(failedPublishCount, 0);
  const outboxPending = await prisma.outboxEvento.findUnique({ where: { id: outboxBefore.id } });
  assert.equal(outboxPending?.publicadoEm, null, "A Outbox deve permanecer pendente quando o produtor não consegue publicar.");
  assert.equal(outboxPending?.tentativas, 1);
  assert.ok(outboxPending?.ultimoErro, "A falha de publicação deve ser persistida para diagnóstico.");

  // Simula o momento em que a janela de retry da Outbox vence após a conexão
  // com Redis ser restabelecida, sem aguardar o backoff completo da suíte.
  await queue.waitUntilReady();
  await prisma.outboxEvento.update({ where: { id: outboxBefore.id }, data: { proximaTentativaEm: new Date(Date.now() - 1_000) } });
  const publishedCount = await dispatchReportOutbox(prisma, queue);
  assert.ok(publishedCount >= 1);
  const outboxAfter = await prisma.outboxEvento.findUnique({ where: { id: outboxBefore.id } });
  assert.ok(outboxAfter?.publicadoEm, "A Outbox deve marcar o evento depois que o BullMQ aceitar o job.");
  assert.equal(outboxAfter?.ultimoErro, null);

  const completed = await waitFor(
    () => prisma!.relatorioAssincrono.findUnique({ where: { id: reportId! } }),
    row => row.status === "COMPLETED",
  );
  assert.equal(completed.status, "COMPLETED", completed.mensagemErro ?? "Worker não concluiu o relatório.");
  assert.equal(transientFailureInjected, true, "O primeiro processamento deve ter falhado para demonstrar o retry real da fila.");
  assert.ok(completed.arquivoPath);
  assert.ok(completed.arquivoSha256);
  assert.ok(Number(completed.tamanhoBytes) > 0);

  const storedFile = await readFile(join(reportsDirectory!, completed.arquivoPath!), "utf8");
  const actualChecksum = createHash("sha256").update(Buffer.from(storedFile, "utf8")).digest("hex");
  assert.equal(actualChecksum, completed.arquivoSha256, "O SHA-256 do arquivo persistido deve corresponder ao metadado gravado no PostgreSQL.");
  assert.deepEqual(JSON.parse(storedFile), [], "O relatório JSON deve refletir o conjunto de equipamentos desta organização de teste.");

  const status = await app.inject({ method: "GET", url: `/api/v1/public/relatorios/${reportId}`, headers: { "x-api-key": apiKey } });
  assert.equal(status.statusCode, 200, status.body);
  assert.equal(status.json().status, "COMPLETED");
  assert.equal(status.json().downloadDisponivel, true);
  assert.equal("arquivoPath" in status.json(), false, "A resposta pública não expõe o caminho físico.");

  const downloaded = await app.inject({ method: "GET", url: `/api/v1/public/relatorios/${reportId}/download`, headers: { "x-api-key": apiKey } });
  assert.equal(downloaded.statusCode, 200, downloaded.body);
  assert.match(downloaded.headers["content-type"] as string, /application\/json/);
  assert.equal(downloaded.body, storedFile);
  const downloadedChecksum = createHash("sha256").update(Buffer.from(downloaded.body, "utf8")).digest("hex");
  assert.equal(downloadedChecksum, completed.arquivoSha256, "O conteúdo recebido pela API deve conservar o checksum validado pelo serviço.");

  const job = await queue.getJob(reportInitially.jobId);
  assert.ok(job, "O job real deve continuar consultável no Redis após a conclusão.");
  assert.equal(await job.getState(), "completed");
  assert.equal(job.opts.attempts, 5);
  assert.deepEqual(job.opts.backoff, { type: "exponential", delay: 3_000 });
  assert.ok(job.attemptsMade >= 1, "A falha injetada deve ter provocado ao menos uma tentativa adicional do BullMQ.");

  // Uma publicação posterior do mesmo evento não deve duplicar o job: o evento
  // já foi marcado como publicado e o jobId original permanece consultável.
  assert.equal(await dispatchReportOutbox(prisma, queue), 0);
  const terminalJobId = `terminal-failure-${randomUUID()}`;
  const terminalJob = await queue.add("terminal-failure-test", { reportId: `terminal-${suffix}` }, {
    jobId: terminalJobId, attempts: 2, backoff: { type: "fixed", delay: 50 }, removeOnFail: false,
  });
  const terminalResult = await waitFor(async () => {
    const current = await queue!.getJob(terminalJobId);
    if (!current) return null;
    return { job: current, state: await current.getState() };
  }, result => result.state === "failed");
  assert.equal(terminalResult.state, "failed");
  assert.equal(terminalResult.job.attemptsMade, 2);
  assert.match(terminalResult.job.failedReason ?? "", /Falha terminal injetada/);
  await terminalResult.job.remove();

  // Recuperação de uma execução que já havia sido marcada PROCESSING, mas perdeu
  // o worker antes de atualizar o heartbeat. O dispatcher detecta o lease vencido
  // no PostgreSQL e cria um job real de recuperação no Redis.
  const interruptedAccepted = await app.inject({
    method: "POST", url: "/api/v1/public/relatorios",
    headers: { "x-api-key": apiKey, "x-integration-id": integrationId },
    payload: { tipo: "equipamentos", formato: "CSV" },
  });
  assert.equal(interruptedAccepted.statusCode, 202, interruptedAccepted.body);
  const interruptedReportId = interruptedAccepted.json().id as string;
  reportIds.push(interruptedReportId);
  const interruptedOutbox = await prisma.outboxEvento.findFirst({ where: { agregadoId: interruptedReportId, evento: "GERAR_RELATORIO" } });
  assert.ok(interruptedOutbox);
  await prisma.outboxEvento.update({ where: { id: interruptedOutbox.id }, data: { publicadoEm: new Date() } });
  await prisma.relatorioAssincrono.update({ where: { id: interruptedReportId }, data: {
    status: "PROCESSING", iniciadoEm: new Date(Date.now() - 120_000), heartbeatEm: new Date(Date.now() - 120_000),
  } });
  await dispatchReportOutbox(prisma, queue);
  const recovered = await waitFor(
    () => prisma!.relatorioAssincrono.findUnique({ where: { id: interruptedReportId } }),
    row => row.status === "COMPLETED",
  );
  assert.equal(recovered.status, "COMPLETED", recovered.mensagemErro ?? "Worker não recuperou a execução interrompida.");
  assert.ok(recovered.arquivoPath);
  assert.ok(recovered.arquivoSha256);
  const recoveryJobs = await queue.getJobs(["completed"], 0, -1);
  const recoveryJob = recoveryJobs.find(candidate => candidate.data.reportId === interruptedReportId);
  assert.ok(recoveryJob, "O dispatcher deve publicar um job de recuperação para o relatório sem heartbeat.");
  assert.match(recoveryJob!.id ?? "", new RegExp(`^greencode-report-recovery-${interruptedReportId}-`));
});
