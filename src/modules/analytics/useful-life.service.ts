import { AnalyticsRepository, type AnalyticsFilters, type AnalyticsLifeEquipmentRecord } from "./analytics.repository.js";
import { linearRegression, round } from "./statistics.js";

const STATE_SCORE: Record<string, number> = { NOVO: 1, BOM_ESTADO: .9, USADO_LEVE: .78, USADO_MODERADO: .62, DANIFICADO_LEVE: .4, DANIFICADO_GRAVE: .2, INSERVIVEL: 0 };
type RegressionPoint = [number, number];

export interface LifePrediction {
  equipamentoId: string;
  tipo: string;
  marca: string;
  modelo: string;
  idadeAnos: number;
  estadoFisico: string;
  falhasObservadas: number;
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
export interface UsefulLifeAnalysisResult {
  equipamentosAnalisados: number;
  previsoesDisponiveis: number;
  previsoesIndisponiveis: number;
  vidaUtilRemanescenteMediaMeses: number | null;
  confiabilidadeMedia: number | null;
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
      const points: Array<[number, number]> = item.depreciacoes.map((entry): RegressionPoint => {
        const ageMonths = Math.max(0, (entry.avaliadoEm.getTime() - Date.UTC(item.anoFabricacao, 0, 1)) / (30.4375 * 86400000));
        return [ageMonths, Number(entry.valorEstimado)];
      });
      const regression = linearRegression(points);
      const failures = item.falhas.length;
      const maintenances = item.manutencoes.length;
      const stateScore = STATE_SCORE[item.estadoFisico] ?? 0;
      let remainingMonths: number | null = null;
      let unavailableReason: string | null = null;
      const distinctObservations = new Set<number>(points.map(([age]: RegressionPoint) => age)).size;
      if (!base || points.length < 3 || distinctObservations < 3 || !regression) unavailableReason = "São necessárias pelo menos três avaliações de depreciação em datas distintas e valor de aquisição positivo.";
      else if (regression.slope >= 0) unavailableReason = "A série histórica não demonstra tendência de depreciação.";
      else {
        const lastAge = points[points.length - 1]![0];
        const zeroAge = -regression.intercept / regression.slope;
        remainingMonths = Math.max(0, zeroAge - lastAge);
      }
      const penalty = Math.min(.5, failures * .06);
      const maintenanceCredit = Math.min(.15, maintenances * .02);
      const adjustedMonths = remainingMonths === null ? null : round(Math.max(0, remainingMonths * (1 - penalty + maintenanceCredit)), 1);
      return {
        equipamentoId: item.id,
        tipo: item.tipo,
        marca: item.marca,
        modelo: item.modelo,
        idadeAnos: Math.max(0, new Date().getUTCFullYear() - item.anoFabricacao),
        estadoFisico: item.estadoFisico,
        falhasObservadas: failures,
        manutencoesObservadas: maintenances,
        observacoes: points.length,
        mesesRemanescentesEstimados: adjustedMonths,
        dataEstimadaInservivel: adjustedMonths === null ? null : new Date(Date.now() + adjustedMonths * 30.4375 * 86400000).toISOString(),
        tendenciaValorPorMes: regression ? round(regression.slope, 4) : null,
        rSquared: regression ? round(regression.rSquared, 4) : null,
        confiabilidade: regression ? round(regression.rSquared * stateScore * Math.max(.35, 1 - penalty + maintenanceCredit), 4) : null,
        metodo: "Regressão linear OLS sobre valor estimado de depreciação x idade em meses, ajustada por condição física, falhas e manutenções",
        indisponivel: adjustedMonths === null,
        motivoIndisponibilidade: unavailableReason,
      };
    });
    const valid: AvailableLifePrediction[] = predictions.filter(isAvailablePrediction);
    const result: UsefulLifeAnalysisResult = {
      equipamentosAnalisados: predictions.length,
      previsoesDisponiveis: valid.length,
      previsoesIndisponiveis: predictions.length - valid.length,
      vidaUtilRemanescenteMediaMeses: valid.length ? round(valid.reduce((sum: number, item: AvailableLifePrediction) => sum + item.mesesRemanescentesEstimados, 0) / valid.length, 1) : null,
      confiabilidadeMedia: valid.length ? round(valid.reduce((sum: number, item: AvailableLifePrediction) => sum + item.confiabilidade, 0) / valid.length, 4) : null,
      previsoes: predictions,
      limitacao: "Previsões dependem de histórico real de depreciação; sem no mínimo três avaliações em datas distintas, o resultado é explicitamente indisponível.",
    };
    await this.repo.saveRun({
      tipo: "VIDA_UTIL_REMANESCENTE",
      organizacaoId: filters.organizacaoId ?? null,
      metodo: "Regressão linear OLS + ajuste por estado, falhas e manutenção",
      versaoModelo: "1.0.0",
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
