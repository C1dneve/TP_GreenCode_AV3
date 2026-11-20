import type { AnalyticsFilters } from "./analytics.repository.js";
import type { ScheduledAnalysisType } from "../../infrastructure/queue/analytics-scheduler.js";

export interface ScheduledAnalysisServices {
  efficiency: { execute(filters?: AnalyticsFilters): Promise<unknown> };
  profitability: { execute(filters?: AnalyticsFilters): Promise<unknown> };
  usefulLife: { execute(filters?: AnalyticsFilters): Promise<unknown> };
}

export async function executeScheduledAnalysis(
  services: ScheduledAnalysisServices,
  tipo: ScheduledAnalysisType,
  schedulerId: string,
  jobId: string,
) {
  if (!schedulerId.trim() || !jobId.trim()) throw new Error("Execução agendada exige schedulerId e jobId.");
  const filters: AnalyticsFilters = {
    incluirDemonstracao: false,
    origemExecucao: "AGENDADA",
    schedulerId,
    jobId,
  };
  switch (tipo) {
    case "EFICIENCIA_OPERACIONAL":
      return services.efficiency.execute(filters);
    case "RENTABILIDADE_EQUIPAMENTOS":
      return services.profitability.execute(filters);
    case "VIDA_UTIL_REMANESCENTE":
      return services.usefulLife.execute(filters);
    default: {
      const exhaustive: never = tipo;
      throw new Error(`Tipo de análise agendada não suportado: ${String(exhaustive)}`);
    }
  }
}
