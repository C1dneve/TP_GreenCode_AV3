import { AnalyticsRepository, type AnalyticsFilters, type AnalyticsLifeEquipmentRecord } from "./analytics.repository.js";
import { linearRegression, median, round } from "./statistics.js";

type RegressionPoint = [number, number];

export interface LifePrediction {
  equipamentoId: string;
  tipo: string;
  marca: string;
  modelo: string;
  idadeAnos: number;
  estadoFisico: string;
  falhasObservadas: number;
  falhasNaoResolvidas: number;
  falhasPorSeveridade: Array<{ severidade: string; quantidade: number }>;
  intervaloMedioEntreFalhasDias: number | null;
  manutencoesObservadas: number;
  observacoes: number;
  mesesRemanescentesEstimados: number | null;
  dataEstimadaInservivel: string | null;
  tendenciaValorPorMes: number | null;
  rSquared: number | null;
  confiabilidade: number | null;
  metodo: string;
  indisponivel: boolean;
  motivoIndisponibilidade: string | null;
}

/** Resultado público e persistível da análise de vida útil remanescente. */
export interface UsefulLifeTypeSummary {
  tipo: string;
  equipamentosAnalisados: number;
  previsoesDisponiveis: number;
  previsoesIndisponiveis: number;
  vidaUtilRemanescenteMediaMeses: number | null;
  vidaUtilRemanescenteMedianaMeses: number | null;
  observacoesHistoricas: number;
  falhasObservadas: number;
  falhasNaoResolvidas: number;
  falhasPorCategoria: Array<{ categoria: string; quantidade: number }>;
  falhasPorSeveridade: Array<{ severidade: string; quantidade: number }>;
  ultimaFalhaEm: string | null;
  confiabilidadeMedia: number | null;
}

export interface UsefulLifeAnalysisResult {
  equipamentosAnalisados: number;
  previsoesDisponiveis: number;
  previsoesIndisponiveis: number;
  vidaUtilRemanescenteMediaMeses: number | null;
  confiabilidadeMedia: number | null;
  previsoesPorTipo: UsefulLifeTypeSummary[];
  previsoes: LifePrediction[];
  limitacao: string;
}

type AvailableLifePrediction = LifePrediction & {
  mesesRemanescentesEstimados: number;
  confiabilidade: number;
};

function isAvailablePrediction(prediction: LifePrediction): prediction is AvailableLifePrediction {
  return prediction.mesesRemanescentesEstimados !== null && prediction.confiabilidade !== null;
}

export class UsefulLifeService {
  constructor(private readonly repo: AnalyticsRepository) {}

  async execute(filters: AnalyticsFilters = {}): Promise<UsefulLifeAnalysisResult> {
    const equipment = await this.repo.lifeData(filters);
    const predictions: LifePrediction[] = equipment.map((item: AnalyticsLifeEquipmentRecord): LifePrediction => {
      const base = item.valorAquisicao > 0 ? item.valorAquisicao : null;
      const now = new Date();
      const sourcePoints = item.depreciacoes
        .filter(entry => entry.avaliadoEm <= now && Number.isFinite(Number(entry.valorEstimado)) && Number(entry.valorEstimado) >= 0)
        .map((entry): RegressionPoint => {
          const ageMonths = (entry.avaliadoEm.getTime() - Date.UTC(item.anoFabricacao, 0, 1)) / (30.4375 * 86400000);
          return [ageMonths, Number(entry.valorEstimado)];
        })
        .filter(([age]) => age >= 0);
      const points = sourcePoints;

      const regression = linearRegression(points);
      const failureHistory = [...item.falhas]
        .filter((failure) => failure.ocorridoEm <= now)
        .sort((a, b) => a.ocorridoEm.getTime() - b.ocorridoEm.getTime());
      const failures = failureHistory.length;
      const unresolvedFailures = failureHistory.filter((failure) => failure.resolvidaEm === null).length;
      const severityCounts = [...failureHistory.reduce((counts, failure) => {
        counts.set(failure.severidade, (counts.get(failure.severidade) ?? 0) + 1);
        return counts;
      }, new Map<string, number>())]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([severidade, quantidade]) => ({ severidade, quantidade }));
      const failureIntervals = failureHistory.slice(1).map((failure, index) =>
        (failure.ocorridoEm.getTime() - failureHistory[index]!.ocorridoEm.getTime()) / 86_400_000,
      );
      const meanFailureInterval = failureIntervals.length
        ? round(failureIntervals.reduce((sum, interval) => sum + interval, 0) / failureIntervals.length, 1)
        : null;
      const maintenances = item.manutencoes.length;
      let remainingMonths: number | null = null;
      let unavailableReason: string | null = null;
      const distinctObservations = new Set<number>(points.map(([age]: RegressionPoint) => age)).size;
      if (!base || points.length < 3 || distinctObservations < 3 || !regression) unavailableReason = "São necessárias pelo menos três avaliações válidas, em datas distintas, e valor de aquisição positivo.";
      else if (item.estadoFisico === "INSERVIVEL") unavailableReason = "O equipamento já foi classificado como INSERVIVEL; não há vida útil remanescente a projetar.";
      else if (regression.slope >= 0) unavailableReason = "A série histórica não demonstra tendência de depreciação.";
      else if (regression.rSquared < 0.35) unavailableReason = "Ajuste estatístico insuficiente (R² inferior a 0,35); projeção não disponibilizada.";
      else {
        const lastAge = points[points.length - 1]![0];
        const zeroAge = -regression.intercept / regression.slope;
        if (!Number.isFinite(zeroAge) || zeroAge <= lastAge) unavailableReason = "O modelo indica que o limite de depreciação já teria sido atingido; não há horizonte futuro confiável.";
        else remainingMonths = zeroAge - lastAge;
      }
      const adjustedMonths = remainingMonths === null ? null : round(Math.max(0, remainingMonths), 1);
      return {
        equipamentoId: item.id,
        tipo: item.tipo,
        marca: item.marca,
        modelo: item.modelo,
        idadeAnos: Math.max(0, new Date().getUTCFullYear() - item.anoFabricacao),
        estadoFisico: item.estadoFisico,
        falhasObservadas: failures,
        falhasNaoResolvidas: unresolvedFailures,
        falhasPorSeveridade: severityCounts,
        intervaloMedioEntreFalhasDias: meanFailureInterval,
        manutencoesObservadas: maintenances,
        observacoes: points.length,
        mesesRemanescentesEstimados: adjustedMonths,
        dataEstimadaInservivel: adjustedMonths === null ? null : new Date(Date.now() + adjustedMonths * 30.4375 * 86400000).toISOString(),
        tendenciaValorPorMes: regression ? round(regression.slope, 4) : null,
        rSquared: regression ? round(regression.rSquared, 4) : null,
        confiabilidade: regression && adjustedMonths !== null ? round(regression.rSquared, 4) : null,
        metodo: "Regressão linear OLS sobre valor estimado de depreciação x idade em meses; falhas e manutenções são indicadores históricos, sem peso preditivo não calibrado",
        indisponivel: adjustedMonths === null,
        motivoIndisponibilidade: unavailableReason,
      };
    });
    const valid: AvailableLifePrediction[] = predictions.filter(isAvailablePrediction);
    const byType = new Map<string, LifePrediction[]>();
    for (const prediction of predictions) {
      const items = byType.get(prediction.tipo) ?? [];
      items.push(prediction);
      byType.set(prediction.tipo, items);
    }
    const typeSummaries: UsefulLifeTypeSummary[] = [...byType]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tipo, items]) => {
        const available = items.filter(isAvailablePrediction);
        const remaining = available.map(item => item.mesesRemanescentesEstimados);
        const confidence = available.map(item => item.confiabilidade);
        const medianRemaining = median(remaining);
        const sourceItems = equipment.filter(item => item.tipo === tipo);
        const failures = sourceItems.flatMap(item => item.falhas);
        const failuresBySeverity = [...failures.reduce((counts, failure) => {
          counts.set(failure.severidade, (counts.get(failure.severidade) ?? 0) + 1);
          return counts;
        }, new Map<string, number>())]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([severidade, quantidade]) => ({ severidade, quantidade }));
        const failuresByCategory = [...failures.reduce((counts, failure) => {
          counts.set(failure.categoria, (counts.get(failure.categoria) ?? 0) + 1);
          return counts;
        }, new Map<string, number>())]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([categoria, quantidade]) => ({ categoria, quantidade }));
        const latestFailure = failures.reduce<Date | null>(
          (latest, failure) => !latest || failure.ocorridoEm > latest ? failure.ocorridoEm : latest,
          null,
        );
        return {
          tipo,
          equipamentosAnalisados: items.length,
          previsoesDisponiveis: available.length,
          previsoesIndisponiveis: items.length - available.length,
          vidaUtilRemanescenteMediaMeses: remaining.length
            ? round(remaining.reduce((sum, value) => sum + value, 0) / remaining.length, 1)
            : null,
          vidaUtilRemanescenteMedianaMeses: medianRemaining === null ? null : round(medianRemaining, 1),
          observacoesHistoricas: items.reduce((sum, item) => sum + item.observacoes, 0),
          falhasObservadas: failures.length,
          falhasNaoResolvidas: failures.filter(failure => failure.resolvidaEm === null).length,
          falhasPorCategoria: failuresByCategory,
          falhasPorSeveridade: failuresBySeverity,
          ultimaFalhaEm: latestFailure?.toISOString() ?? null,
          confiabilidadeMedia: confidence.length
            ? round(confidence.reduce((sum, value) => sum + value, 0) / confidence.length, 4)
            : null,
        };
      });
    const result: UsefulLifeAnalysisResult = {
      equipamentosAnalisados: predictions.length,
      previsoesDisponiveis: valid.length,
      previsoesIndisponiveis: predictions.length - valid.length,
      vidaUtilRemanescenteMediaMeses: valid.length ? round(valid.reduce((sum: number, item: AvailableLifePrediction) => sum + item.mesesRemanescentesEstimados, 0) / valid.length, 1) : null,
      confiabilidadeMedia: valid.length ? round(valid.reduce((sum: number, item: AvailableLifePrediction) => sum + item.confiabilidade, 0) / valid.length, 4) : null,
      previsoesPorTipo: typeSummaries,
      previsoes: predictions,
      limitacao: "Previsões dependem de avaliações válidas e não futuras. Exige no mínimo três observações em datas distintas, tendência negativa e R² mínimo de 0,35; equipamento já INSERVIVEL ou projeção cujo limite tenha sido ultrapassado não recebe previsão futura. Falhas (datas, severidade, categoria, resolução e intervalo médio entre ocorrências) e manutenções são apresentadas como indicadores descritivos; não alteram os meses estimados porque o conjunto disponível não fornece uma relação histórica validada entre esses eventos e a vida útil. R² representa a qualidade do ajuste linear, não uma probabilidade de sobrevivência. O resultado é estimativo, não uma garantia de duração real.",
    };
    await this.repo.saveRun({
      tipo: "VIDA_UTIL_REMANESCENTE",
      organizacaoId: filters.organizacaoId ?? null,
      metodo: "Regressão linear OLS; falhas e manutenções são indicadores descritivos sem ponderação preditiva não calibrada",
      versaoModelo: "1.2.0",
      filtros: { ...filters },
      resultado: result,
      observacoes: valid.length,
      confiabilidade: result.confiabilidadeMedia,
      indisponivel: valid.length === 0,
      motivo: valid.length ? null : "Dados históricos insuficientes para estimativa sustentada.",
      demonstracao: Boolean(filters.incluirDemonstracao),
      origemExecucao: filters.origemExecucao ?? "MANUAL",
      schedulerId: filters.schedulerId ?? null,
      jobId: filters.jobId ?? null,
      chaveExecucao: filters.schedulerId && filters.jobId ? `${filters.schedulerId}:${filters.jobId}` : null,
    });
    return result;
  }
}
