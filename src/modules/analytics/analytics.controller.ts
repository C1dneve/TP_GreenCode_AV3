import { errors } from "../../shared/domain-error.js";
import type { IntegrationIdentity } from "../api-publica/integration-auth.js";
import { AnalyticsRepository, type AnalyticsFilters } from "./analytics.repository.js";
import { OperationalEfficiencyService } from "./operational-efficiency.service.js";
import { ProfitabilityService } from "./profitability.service.js";
import { UsefulLifeService, type UsefulLifeAnalysisResult } from "./useful-life.service.js";
const ANALYSIS_TYPES: Record<string, string> = { "eficiencia-operacional": "EFICIENCIA_OPERACIONAL", rentabilidade: "RENTABILIDADE_EQUIPAMENTOS", "vida-util": "VIDA_UTIL_REMANESCENTE" };

/** União dos resultados retornados pelos três serviços analíticos públicos. */
export type AnalyticsExecutionResult =
  | Awaited<ReturnType<OperationalEfficiencyService["execute"]>>
  | Awaited<ReturnType<ProfitabilityService["execute"]>>
  | UsefulLifeAnalysisResult;

export class AnalyticsController {
  private readonly efficiency: OperationalEfficiencyService;
  private readonly profitability: ProfitabilityService;
  private readonly life: UsefulLifeService;
  constructor(private readonly repo: AnalyticsRepository) { this.efficiency = new OperationalEfficiencyService(repo); this.profitability = new ProfitabilityService(repo); this.life = new UsefulLifeService(repo); }
  execute(type: string, filters: AnalyticsFilters): Promise<AnalyticsExecutionResult> {
    if (type === "eficiencia-operacional") return this.efficiency.execute(filters);
    if (type === "rentabilidade") return this.profitability.execute(filters);
    if (type === "vida-util") return this.life.execute(filters);
    throw errors.notFound("ANALYTICS_TYPE_NOT_FOUND", "Tipo de análise desconhecido.");
  }
  history(type: string, organizationId?: string) { const value = ANALYSIS_TYPES[type]; if (!value) throw errors.notFound("ANALYTICS_TYPE_NOT_FOUND", "Tipo de análise desconhecido."); return this.repo.previousRuns(value, organizationId); }
  async executePublic(type: string, filters: AnalyticsFilters & { organizacaoId: string }, identity: IntegrationIdentity, requestId: string): Promise<AnalyticsExecutionResult> {
    if (!await this.repo.hasActivePartnerOrganization(identity.parceiroId, filters.organizacaoId)) throw errors.forbidden("O parceiro não possui vínculo ativo com a organização solicitada.");
    const result = await this.execute(type, { ...filters, incluirDemonstracao: false });
    await this.repo.recordPublicExecutionAudit({ atorTipo: "PARCEIRO", parceiroId: identity.parceiroId, apiKeyId: identity.apiKeyId, organizacaoId: filters.organizacaoId, acao: "EXECUCAO_ANALISE_PUBLICA", entidade: "ExecucaoAnalise", entidadeId: type, resultado: "SUCESSO", requestId });
    return result;
  }
  async historyPublic(type: string, organizationId: string, identity: IntegrationIdentity, take = 20) {
    if (!await this.repo.hasActivePartnerOrganization(identity.parceiroId, organizationId)) throw errors.notFound("ANALYTICS_NOT_FOUND", "Análises não encontradas para a organização.");
    const value = ANALYSIS_TYPES[type]; if (!value) throw errors.notFound("ANALYTICS_TYPE_NOT_FOUND", "Tipo de análise desconhecido.");
    return this.repo.previousRuns(value, organizationId, take, false);
  }
}
