import { AnalyticsRepository, type AnalyticsFilters } from "./analytics.repository.js";
import { average, round } from "./statistics.js";

const DAY_MS = 86_400_000;
interface ForecastSnapshot {
  executadoEm: Date;
  resultado: unknown;
}
interface ActualTransition {
  entidadeId: string;
  instante: Date;
  detalhes: unknown;
}
interface BacktestError {
  equipamentoId: string;
  erroDias: number;
  erroAbsolutoDias: number;
  erroPercentualAbsoluto: number | null;
}

/**
 * Avalia somente previsões históricas reais cuja data-alvo já amadureceu.
 * O alvo observado é a primeira transição auditada para INSERVIVEL após a previsão.
 * Registros sem transição são contabilizados como maduros sem evento observado,
 * mas não entram artificialmente no erro numérico.
 */
export class UsefulLifeBacktestingService {
  constructor(private readonly repo: AnalyticsRepository) {}

  async execute(filters: AnalyticsFilters = {}, now = new Date()) {
    const [runs, transitions] = await Promise.all([
      this.repo.lifePredictionRuns(filters),
      this.repo.inservibleTransitions(filters),
    ]);
    const actualByEquipment = new Map<string, Date[]>();
    for (const transition of transitions as ActualTransition[]) {
      const list = actualByEquipment.get(transition.entidadeId) ?? [];
      list.push(transition.instante);
      actualByEquipment.set(transition.entidadeId, list);
    }
    const errors: BacktestError[] = [];
    let maturedWithoutEvent = 0;
    let notMatured = 0;
    let forecastsSeen = 0;

    for (const run of runs as ForecastSnapshot[]) {
      if (!run.resultado || typeof run.resultado !== "object") continue;
      const predictions = (run.resultado as { previsoes?: unknown }).previsoes;
      if (!Array.isArray(predictions)) continue;
      for (const raw of predictions) {
        if (!raw || typeof raw !== "object") continue;
        const prediction = raw as Record<string, unknown>;
        if (typeof prediction.equipamentoId !== "string" || typeof prediction.dataEstimadaInservivel !== "string") continue;
        const target = new Date(prediction.dataEstimadaInservivel);
        if (!Number.isFinite(target.getTime()) || target < run.executadoEm) continue;
        forecastsSeen += 1;
        if (target > now) { notMatured += 1; continue; }
        const actual = (actualByEquipment.get(prediction.equipamentoId) ?? [])
          .filter(date => date > run.executadoEm && date <= now)
          .sort((a, b) => a.getTime() - b.getTime())[0];
        if (!actual) { maturedWithoutEvent += 1; continue; }
        const signedDays = (actual.getTime() - target.getTime()) / DAY_MS;
        const absoluteDays = Math.abs(signedDays);
        const predictedHorizon = (target.getTime() - run.executadoEm.getTime()) / DAY_MS;
        errors.push({
          equipamentoId: prediction.equipamentoId,
          erroDias: signedDays,
          erroAbsolutoDias: absoluteDays,
          erroPercentualAbsoluto: predictedHorizon > 0 ? absoluteDays / predictedHorizon * 100 : null,
        });
      }
    }
    const absolute = errors.map(item => item.erroAbsolutoDias);
    const signed = errors.map(item => item.erroDias);
    const percentage = errors.map(item => item.erroPercentualAbsoluto).filter((value): value is number => value !== null);
    const result = {
      periodo: { de: filters.de?.toISOString() ?? null, ate: filters.ate?.toISOString() ?? null, avaliadoAte: now.toISOString() },
      previsoesEncontradas: forecastsSeen,
      previsoesAindaNaoMaduras: notMatured,
      previsoesMadurasSemEventoObservado: maturedWithoutEvent,
      previsoesAvaliadas: errors.length,
      erroMedioDias: average(signed) === null ? null : round(average(signed)! , 2),
      erroAbsolutoMedioDias: average(absolute) === null ? null : round(average(absolute)!, 2),
      erroPercentualAbsolutoMedio: average(percentage) === null ? null : round(average(percentage)!, 2),
      metodo: "Erro entre data prevista e primeira transição auditada para INSERVIVEL posterior à execução da previsão. MAPE usa o horizonte previsto como denominador; previsões sem evento observado são reportadas separadamente.",
      limitacao: "O evento real depende do registro explícito da alteração de estado físico para INSERVIVEL. Ausência de evento não prova que o equipamento permaneceu utilizável; pode representar censura ou falta de registro.",
    };
    await this.repo.saveRun({
      tipo: "BACKTESTING_VIDA_UTIL",
      organizacaoId: filters.organizacaoId ?? null,
      metodo: "Backtesting temporal por transição auditada para INSERVIVEL",
      versaoModelo: "1.0.0",
      filtros: { ...filters, avaliadoAte: now.toISOString() },
      resultado: result,
      observacoes: errors.length,
      indisponivel: errors.length === 0,
      motivo: errors.length ? null : "Nenhuma previsão madura possui evento real posterior à execução para comparação.",
      demonstracao: false,
      origemExecucao: filters.origemExecucao ?? "MANUAL",
      schedulerId: filters.schedulerId ?? null,
      jobId: filters.jobId ?? null,
      chaveExecucao: filters.schedulerId && filters.jobId ? `${filters.schedulerId}:${filters.jobId}` : null,
    });
    return result;
  }
}
