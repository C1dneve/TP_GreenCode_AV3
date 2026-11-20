import { Queue } from "bullmq";
import type { PrismaClient } from "../../generated/prisma/client.js";
export const REPORT_QUEUE_NAME = "greencode-relatorios";
export const REPORT_JOB_DEFAULT_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 3_000 },
  removeOnComplete: 500,
  removeOnFail: 1_000,
};
export function createRedisConnection() {
  const url = new URL(process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379");
  const database = Number(url.pathname.slice(1) || 0);
  return {
    host: url.hostname,
    port: Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379)),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isInteger(database) && database >= 0 ? database : 0,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null as null,
    enableReadyCheck: true,
  };
}
export function createReportQueue() {
  return new Queue(REPORT_QUEUE_NAME, { connection: createRedisConnection(), defaultJobOptions: REPORT_JOB_DEFAULT_OPTIONS });
}
/** Publica eventos de outbox com jobId estável; publicação duplicada é idempotente. */
export async function dispatchReportOutbox(prisma: PrismaClient, queue: Queue) {
  const db = prisma as any;
  const events = await db.outboxEvento.findMany({ where: { publicadoEm: null, OR: [{ proximaTentativaEm: null }, { proximaTentativaEm: { lte: new Date() } }] }, orderBy: { criadoEm: "asc" }, take: 50 });
  let published = 0;
  for (const event of events) {
    try {
      const payload = event.payload as { reportId: string; jobId: string };
      if (!payload?.reportId || !payload?.jobId) throw new Error("Evento outbox sem identificadores obrigatórios.");
      await queue.add("gerar-relatorio", { reportId: payload.reportId }, { jobId: payload.jobId });
      await db.outboxEvento.update({ where: { id: event.id }, data: { publicadoEm: new Date(), tentativas: { increment: 1 }, ultimoErro: null } });
      published += 1;
    } catch (error) {
      const attempts = event.tentativas + 1;
      await db.outboxEvento.update({ where: { id: event.id }, data: { tentativas: { increment: 1 }, proximaTentativaEm: new Date(Date.now() + Math.min(300000, 1000 * 2 ** Math.min(attempts, 8))), ultimoErro: error instanceof Error ? error.message.slice(0, 900) : "Erro desconhecido ao publicar evento." } });
    }
  }
  const staleBefore = new Date(Date.now() - 90_000);
  const staleReports = await db.relatorioAssincrono.findMany({ where: { status: "PROCESSING", OR: [{ heartbeatEm: null }, { heartbeatEm: { lt: staleBefore } }] }, select: { id: true, heartbeatEm: true }, take: 50 });
  for (const report of staleReports) {
    const leaseVersion = Math.floor(Date.now() / 90_000);
    await queue.add("gerar-relatorio", { reportId: report.id }, { jobId: `greencode-report-recovery-${report.id}-${leaseVersion}` });
  }
  return published;
}
