import { errors } from "../../shared/domain-error.js";
import type { IntegrationIdentity } from "../api-publica/integration-auth.js";
import { AnalyticsRepository, type AnalyticsFilters } from "./analytics.repository.js";
import { OperationalEfficiencyService } from "./operational-efficiency.service.js";
import { ProfitabilityService } from "./profitability.service.js";
import { UsefulLifeService, type UsefulLifeAnalysisResult } from "./useful-life.service.js";
import { UsefulLifeBacktestingService } from "./backtesting.service.js";
import { publicAnalyticsProjection } from "./public-analytics.dto.js";
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
  private readonly backtesting: UsefulLifeBacktestingService;
  constructor(private readonly repo: AnalyticsRepository) { this.efficiency = new OperationalEfficiencyService(repo); this.profitability = new ProfitabilityService(repo); this.life = new UsefulLifeService(repo); this.backtesting = new UsefulLifeBacktestingService(repo); }
  execute(type: string, filters: AnalyticsFilters): Promise<AnalyticsExecutionResult> {
    if (type === "eficiencia-operacional") return this.efficiency.execute(filters);
    if (type === "rentabilidade") return this.profitability.execute(filters);
    if (type === "vida-util") return this.life.execute(filters);
    throw errors.notFound("ANALYTICS_TYPE_NOT_FOUND", "Tipo de análise desconhecido.");
  }
  backtestLife(filters: AnalyticsFilters = {}) { return this.backtesting.execute(filters); }
  history(type: string, organizationId?: string) { const value = ANALYSIS_TYPES[type]; if (!value) throw errors.notFound("ANALYTICS_TYPE_NOT_FOUND", "Tipo de análise desconhecido."); return this.repo.previousRuns(value, organizationId); }
  async executePublicByIntegration(type: string, filters: AnalyticsFilters, identity: IntegrationIdentity, requestId: string, identificadorPublico: string): Promise<unknown> {
    const organizacaoId = await this.repo.organizationForIntegration(identity.parceiroId, identificadorPublico);
    if (!organizacaoId) throw errors.notFound("INTEGRATION_NOT_FOUND", "Integração não encontrada.");
    return this.executePublic(type, { ...filters, organizacaoId }, identity, requestId);
  }
  async historyPublicByIntegration(type: string, identity: IntegrationIdentity, identificadorPublico: string, take = 20) {
    const organizacaoId = await this.repo.organizationForIntegration(identity.parceiroId, identificadorPublico);
    if (!organizacaoId) throw errors.notFound("INTEGRATION_NOT_FOUND", "Integração não encontrada.");
    return this.historyPublic(type, organizacaoId, identity, take);
  }
  async executePublic(type: string, filters: AnalyticsFilters & { organizacaoId: string }, identity: IntegrationIdentity, requestId: string): Promise<unknown> {
    if (!await this.repo.hasActivePartnerOrganization(identity.parceiroId, filters.organizacaoId)) throw errors.forbidden("O parceiro não possui vínculo ativo com a organização solicitada.");
    const result = await this.execute(type, { ...filters, incluirDemonstracao: false });
    await this.repo.recordPublicExecutionAudit({ atorTipo: "PARCEIRO", parceiroId: identity.parceiroId, apiKeyId: identity.apiKeyId, organizacaoId: filters.organizacaoId, acao: "EXECUCAO_ANALISE_PUBLICA", entidade: "ExecucaoAnalise", entidadeId: type, resultado: "SUCESSO", requestId });
    return publicAnalyticsProjection(type, result);
  }
  async historyPublic(type: string, organizationId: string, identity: IntegrationIdentity, take = 20) {
    if (!await this.repo.hasActivePartnerOrganization(identity.parceiroId, organizationId)) throw errors.notFound("ANALYTICS_NOT_FOUND", "Análises não encontradas para a organização.");
    const value = ANALYSIS_TYPES[type]; if (!value) throw errors.notFound("ANALYTICS_TYPE_NOT_FOUND", "Tipo de análise desconhecido.");
    const rows = await this.repo.previousRuns(value, organizationId, take, false);
    return rows.map((row: any) => ({
      tipo: row.tipo,
      metodo: row.metodo,
      versaoModelo: row.versaoModelo,
      executadoEm: row.executadoEm,
      observacoes: row.observacoes,
      confiabilidade: row.confiabilidade,
      indisponivel: row.indisponivel,
      motivo: row.motivo,
      filtros: {
        ...(row.filtros?.de ? { de: row.filtros.de } : {}),
        ...(row.filtros?.ate ? { ate: row.filtros.ate } : {}),
      },
      resultado: publicAnalyticsProjection(type, row.resultado),
    }));
  }
}
