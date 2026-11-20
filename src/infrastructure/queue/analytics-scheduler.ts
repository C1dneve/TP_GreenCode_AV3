import { Queue } from "bullmq";
import { createRedisConnection } from "./report-queue.js";

export const ANALYTICS_QUEUE_NAME = "greencode-analises";

export const SCHEDULED_ANALYSES = [
  { tipo: "EFICIENCIA_OPERACIONAL", schedulerId: "greencode-analytics-efficiency", env: "ANALYTICS_EFFICIENCY_INTERVAL_MS" },
  { tipo: "RENTABILIDADE_EQUIPAMENTOS", schedulerId: "greencode-analytics-profitability", env: "ANALYTICS_PROFITABILITY_INTERVAL_MS" },
  { tipo: "VIDA_UTIL_REMANESCENTE", schedulerId: "greencode-analytics-useful-life", env: "ANALYTICS_USEFUL_LIFE_INTERVAL_MS" },
] as const;

export type ScheduledAnalysisType = typeof SCHEDULED_ANALYSES[number]["tipo"];
export type ScheduleIntervals = Record<ScheduledAnalysisType, number>;

export function getAnalyticsScheduleIntervals(env: NodeJS.ProcessEnv = process.env): ScheduleIntervals {
  const defaults: ScheduleIntervals = {
    EFICIENCIA_OPERACIONAL: 60 * 60 * 1000,
    RENTABILIDADE_EQUIPAMENTOS: 6 * 60 * 60 * 1000,
    VIDA_UTIL_REMANESCENTE: 24 * 60 * 60 * 1000,
  };
  const values = { ...defaults };
  for (const schedule of SCHEDULED_ANALYSES) {
    const raw = env[schedule.env];
    if (raw === undefined || raw.trim() === "") continue;
    const interval = Number(raw);
    if (!Number.isSafeInteger(interval) || interval < 60_000) {
      throw new Error(`${schedule.env} deve ser um inteiro de pelo menos 60000 milissegundos.`);
    }
    values[schedule.tipo] = interval;
  }
  return values;
}

export function createAnalyticsQueue() {
  return new Queue(ANALYTICS_QUEUE_NAME, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 200,
      removeOnFail: 1_000,
    },
  });
}

/**
 * BullMQ upsertJobScheduler armazena cada scheduler sob uma chave estável no
 * Redis. Várias instâncias do worker atualizam o mesmo registro, em vez de
 * criarem cronogramas concorrentes para uma mesma análise.
 */
export async function ensureAnalyticsSchedules(
  queue: Pick<Queue, "upsertJobScheduler">,
  intervals: ScheduleIntervals = getAnalyticsScheduleIntervals(),
) {
  const registered: string[] = [];
  for (const schedule of SCHEDULED_ANALYSES) {
    await queue.upsertJobScheduler(
      schedule.schedulerId,
      { every: intervals[schedule.tipo] },
      {
        name: "executar-analise-agendada",
        data: { tipo: schedule.tipo, schedulerId: schedule.schedulerId },
        opts: {
          attempts: 5,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: 200,
          removeOnFail: 1_000,
        },
      },
    );
    registered.push(schedule.schedulerId);
  }
  return registered;
}
