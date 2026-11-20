import "dotenv/config";
import { Worker } from "bullmq";
import { loadConfig } from "./config/env.js";
import { createPrismaClient } from "./infrastructure/database/prisma.js";
import { createRedisConnection, createReportQueue, dispatchReportOutbox, REPORT_QUEUE_NAME } from "./infrastructure/queue/report-queue.js";
import { ANALYTICS_QUEUE_NAME, createAnalyticsQueue, ensureAnalyticsSchedules } from "./infrastructure/queue/analytics-scheduler.js";
import { AnalyticsRepository } from "./modules/analytics/analytics.repository.js";
import { OperationalEfficiencyService } from "./modules/analytics/operational-efficiency.service.js";
import { ProfitabilityService } from "./modules/analytics/profitability.service.js";
import { UsefulLifeService } from "./modules/analytics/useful-life.service.js";
import { executeScheduledAnalysis } from "./modules/analytics/scheduled-analytics.js";
import { RelatoriosAsyncRepository } from "./modules/relatorios-async/relatorios-async.repository.js";
import { RelatoriosAsyncService } from "./modules/relatorios-async/relatorios-async.service.js";

async function main() {
  const config = loadConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  const queue = createReportQueue();
  const analyticsQueue = createAnalyticsQueue();
  const reports = new RelatoriosAsyncService(new RelatoriosAsyncRepository(prisma));
  const analyticsRepository = new AnalyticsRepository(prisma);
  const scheduledServices = {
    efficiency: new OperationalEfficiencyService(analyticsRepository),
    profitability: new ProfitabilityService(analyticsRepository),
    usefulLife: new UsefulLifeService(analyticsRepository),
  };
  const worker = new Worker(REPORT_QUEUE_NAME, async job => {
    if (job.name !== "gerar-relatorio" || typeof job.data?.reportId !== "string") throw new Error("Job de relatório inválido.");
    await reports.process(job.data.reportId);
    return { reportId: job.data.reportId, processedAt: new Date().toISOString() };
  }, { connection: createRedisConnection(), concurrency: Math.max(1, Math.min(10, Number(process.env.WORKER_CONCURRENCY ?? 3) || 3)) });
  worker.on("failed", (job, error) => console.error(JSON.stringify({ level: "error", jobId: job?.id, reportId: job?.data?.reportId, message: error.message })));
  worker.on("completed", job => console.info(JSON.stringify({ level: "info", jobId: job.id, reportId: job.data.reportId, message: "Relatório concluído" })));

  // O scheduler possui IDs estáveis. Repetir esta chamada em outro processo
  // worker executa upsert no Redis, não registra outro agendamento.
  await ensureAnalyticsSchedules(analyticsQueue);
  const analyticsWorker = new Worker(ANALYTICS_QUEUE_NAME, async job => {
    if (job.name !== "executar-analise-agendada" || typeof job.data?.tipo !== "string" || typeof job.data?.schedulerId !== "string" || typeof job.id !== "string") {
      throw new Error("Job de análise agendada inválido.");
    }
    const result = await executeScheduledAnalysis(
      scheduledServices,
      job.data.tipo as Parameters<typeof executeScheduledAnalysis>[1],
      job.data.schedulerId,
      job.id,
    );
    return { tipo: job.data.tipo, schedulerId: job.data.schedulerId, jobId: job.id, executedAt: new Date().toISOString(), result };
  }, { connection: createRedisConnection(), concurrency: Math.max(1, Math.min(5, Number(process.env.ANALYTICS_WORKER_CONCURRENCY ?? 2) || 2)) });
  analyticsWorker.on("failed", (job, error) => console.error(JSON.stringify({ level: "error", queue: ANALYTICS_QUEUE_NAME, jobId: job?.id, schedulerId: job?.data?.schedulerId, message: error.message })));
  analyticsWorker.on("completed", job => console.info(JSON.stringify({ level: "info", queue: ANALYTICS_QUEUE_NAME, jobId: job.id, schedulerId: job.data.schedulerId, tipo: job.data.tipo, message: "Análise agendada concluída" })));

  let dispatching = false;
  const dispatch = async () => {
    if (dispatching) return;
    dispatching = true;
    try { await dispatchReportOutbox(prisma, queue); }
    catch (error) { console.error(JSON.stringify({ level: "warn", message: "Outbox indisponível; eventos permanecem persistidos para nova tentativa.", error: error instanceof Error ? error.message : "unknown" })); }
    finally { dispatching = false; }
  };
  const dispatchTimer = setInterval(() => void dispatch(), 1500);
  const cleanupTimer = setInterval(() => void reports.cleanupExpired().catch(error => console.error(JSON.stringify({ level: "warn", message: "Limpeza de relatórios expirados falhou.", error: error instanceof Error ? error.message : "unknown" }))), 60 * 60 * 1000);
  await dispatch();
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return; closing = true;
    clearInterval(dispatchTimer); clearInterval(cleanupTimer);
    console.info(JSON.stringify({ level: "info", signal, message: "Encerrando worker" }));
    await Promise.all([worker.close(), analyticsWorker.close()]);
    await Promise.all([queue.close(), analyticsQueue.close()]);
    await prisma.$disconnect();
  };
  process.once("SIGINT", () => void shutdown("SIGINT").then(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown("SIGTERM").then(() => process.exit(0)));
}
main().catch(error => { console.error("Falha ao inicializar worker GreenCode:", error instanceof Error ? error.message : "erro desconhecido"); process.exitCode = 1; });
