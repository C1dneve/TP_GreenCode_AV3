import type { PrismaClient } from "../../generated/prisma/client.js";
import { errors } from "../../shared/domain-error.js";

export interface AnalyticsFilters { organizacaoId?: string; de?: Date; ate?: Date; incluirDemonstracao?: boolean; origemExecucao?: "MANUAL" | "AGENDADA"; schedulerId?: string; jobId?: string }

interface FindManyDelegate {
  findMany<TResult = unknown>(args: Record<string, unknown>): Promise<TResult[]>;
}

export interface AnalyticsTriageEventRecord {
  sessaoId: string;
  responsavelId: string;
  responsavel: { id: string; nome: string } | null;
  lote: { organizacaoId: string } | null;
  etapa: string;
  ocorridoEm: Date;
  origemSessao: string | null;
  mensuravel: boolean;
}

export interface AnalyticsLotRecord {
  id: string;
  organizacaoId: string;
  statusProcessamento: string;
  dataEntrada: Date;
}

type NumericValue = number | string | { toString(): string };
interface LifeEquipmentSource {
  id: string;
  tipo: string;
  marca: string;
  modelo: string;
  anoFabricacao: number;
  valorAquisicao: NumericValue;
  estadoFisico: string;
  demonstracao: boolean;
}
interface EquipmentHistorySource { id: string; equipamentoId: string }
interface DepreciationSource extends EquipmentHistorySource {
  avaliadoEm: Date;
  valorEstimado: NumericValue;
}
export interface AnalyticsLifeEquipmentRecord extends Omit<LifeEquipmentSource, "valorAquisicao" | "demonstracao"> {
  valorAquisicao: number;
  depreciacoes: Array<EquipmentHistorySource & { avaliadoEm: Date; valorEstimado: number }>;
  falhas: EquipmentHistorySource[];
  manutencoes: EquipmentHistorySource[];
}

/** Limite duro para impedir que um resultado parcial seja apresentado como completo. */
export const ANALYTICS_QUERY_LIMIT = 20_000;
const queryLimit = ANALYTICS_QUERY_LIMIT + 1;
function ensureWithinLimit(resource: string, rows: unknown[]) {
  if (rows.length > ANALYTICS_QUERY_LIMIT) {
    throw errors.badRequest("ANALYTICS_DATASET_TOO_LARGE", `A consulta de ${resource} excedeu ${ANALYTICS_QUERY_LIMIT} registros. Refine o período ou os filtros; nenhum resultado parcial foi persistido.`);
  }
}
function dateFilter(field: string, filters: AnalyticsFilters) {
  return filters.de || filters.ate ? { [field]: { ...(filters.de ? { gte: filters.de } : {}), ...(filters.ate ? { lte: filters.ate } : {}) } } : {};
}
function demonstrationFilter(filters: AnalyticsFilters) { return filters.incluirDemonstracao ? {} : { demonstracao: false }; }

/** Repositório isolado da camada analítica; mantém os serviços independentes do Prisma. */
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async triageEvents(filters: AnalyticsFilters): Promise<AnalyticsTriageEventRecord[]> {
    const model = (this.prisma as unknown as { historicoTriagem: FindManyDelegate }).historicoTriagem;
    const baseWhere = { ...(filters.organizacaoId ? { lote: { organizacaoId: filters.organizacaoId } } : {}), ...demonstrationFilter(filters) };
    let where: Record<string, unknown> = baseWhere;
    if (filters.de || filters.ate) {
      // O período classifica sessões pela conclusão. Busca também o início
      // anterior ao período para que a duração nunca seja subestimada.
      const completed = await model.findMany<{ sessaoId: string }>({
        where: { ...baseWhere, etapa: "TRIAGEM_CONCLUIDA", ...dateFilter("ocorridoEm", filters) },
        select: { sessaoId: true }, distinct: ["sessaoId"], take: queryLimit,
      });
      ensureWithinLimit("sessões concluídas no período", completed);
      const sessionIds = completed.map((row: { sessaoId: string }) => row.sessaoId);
      if (!sessionIds.length) return [];
      where = { ...baseWhere, sessaoId: { in: sessionIds } };
    }
    const rows = await model.findMany<AnalyticsTriageEventRecord>({
      where,
      include: { responsavel: { select: { id: true, nome: true } }, lote: { select: { organizacaoId: true } } },
      orderBy: [{ ocorridoEm: "asc" }, { id: "asc" }], take: queryLimit,
    });
    ensureWithinLimit("histórico de triagem", rows);
    return rows;
  }
  async lots(filters: AnalyticsFilters): Promise<AnalyticsLotRecord[]> {
    const model = (this.prisma as unknown as { lote: FindManyDelegate }).lote;
    const rows = await model.findMany<AnalyticsLotRecord>({
      where: { ...demonstrationFilter(filters), ...(filters.organizacaoId ? { organizacaoId: filters.organizacaoId } : {}), ...dateFilter("dataEntrada", filters) },
      select: { id: true, organizacaoId: true, statusProcessamento: true, dataEntrada: true },
      orderBy: [{ dataEntrada: "asc" }, { id: "asc" }], take: queryLimit,
    });
    ensureWithinLimit("lotes", rows);
    return rows;
  }
  async equipment(filters: AnalyticsFilters) {
    const where = { ativo: true, ...demonstrationFilter(filters), ...(filters.organizacaoId ? { lote: { organizacaoId: filters.organizacaoId } } : {}), ...dateFilter("createdAt", filters) };
    const equipment = await (this.prisma as any).equipamento.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: queryLimit });
    ensureWithinLimit("equipamentos", equipment);
    if (!equipment.length) return equipment;
    const realIds = equipment.filter((row: any) => !row.demonstracao).map((row: any) => row.id);
    const demoIds = equipment.filter((row: any) => Boolean(row.demonstracao)).map((row: any) => row.id);
    const originBranches = [
      ...(realIds.length ? [{ equipamentoId: { in: realIds }, demonstracao: false }] : []),
      ...(demoIds.length ? [{ equipamentoId: { in: demoIds }, demonstracao: true }] : []),
    ];
    const evaluations = await (this.prisma as any).avaliacaoRecuperacao.findMany({
      where: { OR: originBranches, ...dateFilter("avaliadoEm", filters) },
      orderBy: [{ avaliadoEm: "desc" }, { id: "desc" }], take: queryLimit,
    });
    ensureWithinLimit("avaliações de recuperação", evaluations);
    const byEquipment = new Map<string, any[]>();
    for (const evaluation of evaluations) { const items = byEquipment.get(evaluation.equipamentoId) ?? []; items.push(evaluation); byEquipment.set(evaluation.equipamentoId, items); }
    return equipment.map((row: any) => ({ ...row, avaliacoesRecuperacao: byEquipment.get(row.id) ?? [] }));
  }
  async recoveryReferences(incluirDemonstracao = false) {
    const rows = await (this.prisma as any).referenciaRecuperacao.findMany({
      where: { ativa: true, ...(incluirDemonstracao ? {} : { demonstracao: false }), vigenciaInicio: { lte: new Date() }, OR: [{ vigenciaFim: null }, { vigenciaFim: { gt: new Date() } }] },
      orderBy: [{ modelo: "desc" }, { marca: "desc" }, { vigenciaInicio: "desc" }], take: queryLimit,
    });
    ensureWithinLimit("referências financeiras", rows);
    return rows;
  }
  async lifeData(filters: AnalyticsFilters): Promise<AnalyticsLifeEquipmentRecord[]> {
    const equipmentModel = (this.prisma as unknown as { equipamento: FindManyDelegate }).equipamento;
    const equipment = await equipmentModel.findMany<LifeEquipmentSource>({
      where: { ativo: true, ...demonstrationFilter(filters), ...(filters.organizacaoId ? { lote: { organizacaoId: filters.organizacaoId } } : {}) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: queryLimit,
    });
    ensureWithinLimit("equipamentos para previsão de vida útil", equipment);
    if (!equipment.length) return [];
    const realIds = equipment.filter((row: LifeEquipmentSource) => !row.demonstracao).map((row: LifeEquipmentSource) => row.id);
    const demoIds = equipment.filter((row: LifeEquipmentSource) => row.demonstracao).map((row: LifeEquipmentSource) => row.id);
    const originBranches = [
      ...(realIds.length ? [{ equipamentoId: { in: realIds }, demonstracao: false }] : []),
      ...(demoIds.length ? [{ equipamentoId: { in: demoIds }, demonstracao: true }] : []),
    ];
    const common = { OR: originBranches };
    const historyModels = this.prisma as unknown as {
      historicoDepreciacao: FindManyDelegate;
      falhaEquipamento: FindManyDelegate;
      manutencaoEquipamento: FindManyDelegate;
    };
    const [depreciations, failures, maintenances] = await Promise.all([
      historyModels.historicoDepreciacao.findMany<DepreciationSource>({ where: { ...common, ...dateFilter("avaliadoEm", filters) }, orderBy: [{ avaliadoEm: "asc" }, { id: "asc" }], take: queryLimit }),
      historyModels.falhaEquipamento.findMany<EquipmentHistorySource>({ where: { ...common, ...dateFilter("ocorridoEm", filters) }, orderBy: [{ ocorridoEm: "desc" }, { id: "desc" }], take: queryLimit }),
      historyModels.manutencaoEquipamento.findMany<EquipmentHistorySource>({ where: { ...common, ...dateFilter("realizadaEm", filters) }, orderBy: [{ realizadaEm: "desc" }, { id: "desc" }], take: queryLimit }),
    ]);
    ensureWithinLimit("históricos de depreciação", depreciations);
    ensureWithinLimit("históricos de falhas", failures);
    ensureWithinLimit("históricos de manutenção", maintenances);
    const group = <T extends EquipmentHistorySource>(rows: readonly T[]): Map<string, T[]> => {
      const result = new Map<string, T[]>();
      for (const row of rows) {
        const items = result.get(row.equipamentoId) ?? [];
        items.push(row);
        result.set(row.equipamentoId, items);
      }
      return result;
    };
    const depreciationByEquipment = group(depreciations);
    const failureByEquipment = group(failures);
    const maintenanceByEquipment = group(maintenances);
    return equipment.map((row: LifeEquipmentSource): AnalyticsLifeEquipmentRecord => ({
      id: row.id,
      tipo: row.tipo,
      marca: row.marca,
      modelo: row.modelo,
      anoFabricacao: row.anoFabricacao,
      valorAquisicao: Number(row.valorAquisicao),
      estadoFisico: row.estadoFisico,
      depreciacoes: (depreciationByEquipment.get(row.id) ?? []).map((entry: DepreciationSource) => ({
        id: entry.id,
        equipamentoId: entry.equipamentoId,
        avaliadoEm: entry.avaliadoEm,
        valorEstimado: Number(entry.valorEstimado),
      })),
      falhas: failureByEquipment.get(row.id) ?? [],
      manutencoes: maintenanceByEquipment.get(row.id) ?? [],
    }));
  }
  async saveRun(data: Record<string, unknown>) {
    const model = (this.prisma as any).execucaoAnalise;
    const key = data.chaveExecucao;
    // BullMQ pode repetir um job após queda do worker. A chave única transforma
    // a persistência do resultado em operação idempotente no PostgreSQL.
    if (typeof key === "string" && key.length > 0) return model.upsert({ where: { chaveExecucao: key }, create: data, update: {} });
    return model.create({ data });
  }
  previousRuns(tipo: string, organizacaoId?: string, take = 20, incluirDemonstracao = true) {
    return (this.prisma as any).execucaoAnalise.findMany({ where: { tipo: tipo as never, ...(organizacaoId ? { organizacaoId } : {}), ...(incluirDemonstracao ? {} : { demonstracao: false }) }, orderBy: { executadoEm: "desc" }, take });
  }
  async hasActivePartnerOrganization(parceiroId: string, organizacaoId: string) {
    const association = await (this.prisma as any).parceiroOrganizacao.findFirst({ where: { parceiroId, organizacaoId, ativo: true, organizacao: { ativo: true } }, select: { id: true } });
    return Boolean(association);
  }
  recordPublicExecutionAudit(data: Record<string, unknown>) { return (this.prisma as any).eventoAuditoria.create({ data }); }
}
