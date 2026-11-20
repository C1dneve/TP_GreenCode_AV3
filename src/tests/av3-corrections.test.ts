import test from "node:test";
import assert from "node:assert/strict";
import { ensureAnalyticsSchedules, getAnalyticsScheduleIntervals, SCHEDULED_ANALYSES } from "../infrastructure/queue/analytics-scheduler.js";
import { executeScheduledAnalysis } from "../modules/analytics/scheduled-analytics.js";
import { AnalyticsRepository, ANALYTICS_QUERY_LIMIT } from "../modules/analytics/analytics.repository.js";

const oneHour = 60 * 60 * 1000;
const intervals = {
  EFICIENCIA_OPERACIONAL: oneHour,
  RENTABILIDADE_EQUIPAMENTOS: 6 * oneHour,
  VIDA_UTIL_REMANESCENTE: 24 * oneHour,
};

test("scheduler cria exatamente os três agendamentos recorrentes com IDs estáveis", async () => {
  const schedulers = new Map<string, unknown>();
  const calls: Array<{ id: string; repeat: { every: number }; template: any }> = [];
  const queue = {
    async upsertJobScheduler(id: string, repeat: { every: number }, template: any) {
      calls.push({ id, repeat, template });
      schedulers.set(id, { repeat, template });
      return {};
    },
  };

  const first = await ensureAnalyticsSchedules(queue as any, intervals);
  const second = await ensureAnalyticsSchedules(queue as any, intervals);
  assert.equal(first.length, 3);
  assert.deepEqual(second, first);
  assert.equal(schedulers.size, 3, "upsert repetido mantém um registro por schedulerId");
  assert.equal(calls.length, 6, "cada inicialização atualiza os mesmos três schedulers");
  assert.deepEqual([...schedulers.keys()], SCHEDULED_ANALYSES.map(item => item.schedulerId));
  for (const call of calls) {
    assert.equal(call.repeat.every, intervals[call.template.data.tipo as keyof typeof intervals]);
    assert.equal(call.template.name, "executar-analise-agendada");
    assert.equal(call.template.opts.attempts, 5);
    assert.equal(call.template.opts.backoff.type, "exponential");
  }
});

test("intervalos recorrentes são configuráveis e rejeitam valores inseguros", () => {
  const values = getAnalyticsScheduleIntervals({
    ANALYTICS_EFFICIENCY_INTERVAL_MS: "120000",
    ANALYTICS_PROFITABILITY_INTERVAL_MS: "360000",
    ANALYTICS_USEFUL_LIFE_INTERVAL_MS: "86400000",
  } as NodeJS.ProcessEnv);
  assert.equal(values.EFICIENCIA_OPERACIONAL, 120_000);
  assert.equal(values.RENTABILIDADE_EQUIPAMENTOS, 360_000);
  assert.throws(() => getAnalyticsScheduleIntervals({ ANALYTICS_EFFICIENCY_INTERVAL_MS: "10" } as NodeJS.ProcessEnv), /pelo menos 60000/);
  assert.throws(() => getAnalyticsScheduleIntervals({ ANALYTICS_EFFICIENCY_INTERVAL_MS: "invalid" } as NodeJS.ProcessEnv), /inteiro/);
});

test("runner despacha eficiência, rentabilidade e vida útil sem misturar dados demonstrativos", async () => {
  const calls: Array<{ name: string; filters: any }> = [];
  const services = {
    efficiency: { execute: async (filters: any) => { calls.push({ name: "efficiency", filters }); return { ok: true }; } },
    profitability: { execute: async (filters: any) => { calls.push({ name: "profitability", filters }); return { ok: true }; } },
    usefulLife: { execute: async (filters: any) => { calls.push({ name: "usefulLife", filters }); return { ok: true }; } },
  };
  const cases = [
    ["EFICIENCIA_OPERACIONAL", "efficiency"],
    ["RENTABILIDADE_EQUIPAMENTOS", "profitability"],
    ["VIDA_UTIL_REMANESCENTE", "usefulLife"],
  ] as const;
  for (const [tipo, expected] of cases) {
    await executeScheduledAnalysis(services, tipo, `scheduler-${expected}`, `job-${expected}`);
  }
  assert.deepEqual(calls.map(call => call.name), cases.map(([, expected]) => expected));
  for (const call of calls) {
    assert.equal(call.filters.incluirDemonstracao, false);
    assert.equal(call.filters.origemExecucao, "AGENDADA");
    assert.match(call.filters.schedulerId, /^scheduler-/);
    assert.match(call.filters.jobId, /^job-/);
  }
});

test("runner rejeita job agendado sem identidade para impedir persistência não rastreável", async () => {
  const noOp = { execute: async () => ({}) };
  await assert.rejects(
    executeScheduledAnalysis({ efficiency: noOp, profitability: noOp, usefulLife: noOp }, "EFICIENCIA_OPERACIONAL", "", "job-1"),
    /schedulerId e jobId/,
  );
});

test("repositório torna persistência de execução agendada idempotente", async () => {
  const upserts: any[] = [];
  const creates: any[] = [];
  const prisma = {
    execucaoAnalise: {
      upsert: async (args: any) => { upserts.push(args); return { id: "execution-1" }; },
      create: async (args: any) => { creates.push(args); return { id: "execution-2" }; },
    },
  } as any;
  const repository = new AnalyticsRepository(prisma);
  await repository.saveRun({ tipo: "EFICIENCIA_OPERACIONAL", chaveExecucao: "scheduler:job-1", resultado: {} });
  await repository.saveRun({ tipo: "EFICIENCIA_OPERACIONAL", chaveExecucao: "scheduler:job-1", resultado: {} });
  await repository.saveRun({ tipo: "EFICIENCIA_OPERACIONAL", resultado: {} });
  assert.equal(upserts.length, 2);
  assert.equal(upserts[0].where.chaveExecucao, "scheduler:job-1");
  assert.deepEqual(upserts[0].update, {});
  assert.equal(creates.length, 1);
});


test("filtro de período recupera o início anterior da sessão concluída dentro do período", async () => {
  const calls: any[] = [];
  const start = { sessaoId: "s1", etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date("2026-10-31T23:30:00Z") };
  const finish = { sessaoId: "s1", etapa: "TRIAGEM_CONCLUIDA", ocorridoEm: new Date("2026-11-01T00:30:00Z") };
  const prisma = { historicoTriagem: { findMany: async (args: any) => { calls.push(args); return calls.length === 1 ? [{ sessaoId: "s1" }] : [start, finish]; } } } as any;
  const rows = await new AnalyticsRepository(prisma).triageEvents({ de: new Date("2026-11-01T00:00:00Z") });
  assert.deepEqual(rows, [start, finish]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].where.etapa, "TRIAGEM_CONCLUIDA");
  assert.equal(calls[1].where.sessaoId.in[0], "s1");
  assert.equal("ocorridoEm" in calls[1].where, false, "o início anterior ao período não pode ser descartado");
});

test("repositório rejeita datasets analíticos acima de 20 mil em vez de persistir resultados truncados", async () => {
  const prisma = {
    historicoTriagem: { findMany: async () => Array.from({ length: ANALYTICS_QUERY_LIMIT + 1 }, (_, index) => ({ id: String(index) })) },
  } as any;
  const repository = new AnalyticsRepository(prisma);
  await assert.rejects(repository.triageEvents({}), (error: any) => {
    assert.equal(error.code, "ANALYTICS_DATASET_TOO_LARGE");
    assert.match(error.message, /nenhum resultado parcial/i);
    return true;
  });
});
