import { AnalyticsRepository, type AnalyticsFilters } from "./analytics.repository.js";
import { average, round } from "./statistics.js";

const FALLBACK_RATE: Record<string, number> = { COMPUTADOR_MESA: 7.5, NOTEBOOK: 9.5, MONITOR: 4, IMPRESSORA: 3, SERVIDOR: 8, ROTEADOR: 6, CABO_ESTRUTURADO: 2.5, FONTE_ALIMENTACAO: 5 };
const CONDITION_FACTOR: Record<string, number> = { NOVO: 1, BOM_ESTADO: .9, USADO_LEVE: .8, USADO_MODERADO: .65, DANIFICADO_LEVE: .45, DANIFICADO_GRAVE: .2, INSERVIVEL: .05 };

export class ProfitabilityService {
  constructor(private readonly repo: AnalyticsRepository) {}
  static selectReference(input: { tipo: string; marca: string; modelo?: string; estadoFisico: string; demonstracao?: boolean }, references: any[]) {
    const normalized = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("pt-BR");
    const matches = references.filter(x => x.tipo === input.tipo && x.estadoFisico === input.estadoFisico && (input.demonstracao === undefined || Boolean(x.demonstracao) === input.demonstracao));
    const brand = normalized(input.marca);
    const model = normalized(input.modelo);
    // 1. Tipo + estado + marca + modelo.
    const exactModel = matches.find(x => normalized(x.marca) === brand && normalized(x.modelo) === model && model.length > 0);
    if (exactModel) return exactModel;
    // 2. Tipo + estado + marca, sem modelo específico.
    const brandOnly = matches.find(x => normalized(x.marca) === brand && !x.modelo);
    if (brandOnly) return brandOnly;
    // 3. Tipo + estado sem marca ou modelo.
    return matches.find(x => !x.marca && !x.modelo) ?? null;
  }
  static estimate(input: { tipo: string; marca: string; modelo?: string; estadoFisico: string; pesoQuilogramas: number; demonstracao?: boolean }, references: any[]) {
    const reference = ProfitabilityService.selectReference(input, references);
    const pricePerKg = reference ? Number(reference.valorMaterialPorKg) : FALLBACK_RATE[input.tipo] ?? 0;
    const recoveryPercent = reference ? Number(reference.percentualRecuperavel) : (CONDITION_FACTOR[input.estadoFisico] ?? 0) * 100;
    const value = Math.max(0, input.pesoQuilogramas) * Math.max(0, pricePerKg) * Math.min(100, Math.max(0, recoveryPercent)) / 100;
    return { valorEstimado: round(value), valorReferenciaPorKg: pricePerKg, percentualRecuperavel: recoveryPercent, fonte: reference ? "REFERENCIA_CADASTRADA" : "TABELA_BASE_ESTIMATIVA", referenciaId: reference?.id ?? null };
  }
  async execute(filters: AnalyticsFilters = {}) {
    const [equipments, references] = await Promise.all([this.repo.equipment(filters), this.repo.recoveryReferences(Boolean(filters.incluirDemonstracao))]);
    const rows = equipments.map((equipment: any) => {
      const estimation = ProfitabilityService.estimate({ tipo: equipment.tipo, marca: equipment.marca, modelo: equipment.modelo, estadoFisico: equipment.estadoFisico, pesoQuilogramas: Number(equipment.pesoQuilogramas), demonstracao: Boolean(equipment.demonstracao) }, references);
      const latest = (equipment.avaliacoesRecuperacao ?? []).find((item: any) => Boolean(item.demonstracao) === Boolean(equipment.demonstracao));
      return { tipo: equipment.tipo, marca: equipment.marca, modelo: equipment.modelo, estadoFisico: equipment.estadoFisico, pesoQuilogramas: Number(equipment.pesoQuilogramas), valorEstimado: latest ? Number(latest.valorEstimado) : estimation.valorEstimado, valorRealizado: latest?.valorRealizado == null ? null : Number(latest.valorRealizado), fonteEstimativa: latest ? latest.metodo : estimation.fonte, equipamentoId: equipment.id };
    });
    const realized = rows.filter((x: any) => x.valorRealizado !== null);
    const grouped = (key: string) => {
      const groups = new Map<string, any[]>();
      for (const row of rows as any[]) { const group = String(row[key]); const list = groups.get(group) ?? []; list.push(row); groups.set(group, list); }
      return [...groups].map(([nome, values]) => ({ nome, equipamentos: values.length, estimadoMedio: round(average(values.map(x => x.valorEstimado))!), realizadoMedio: average(values.filter(x => x.valorRealizado !== null).map(x => x.valorRealizado)) === null ? null : round(average(values.filter(x => x.valorRealizado !== null).map(x => x.valorRealizado))!) }));
    };
    const result = {
      equipamentosAvaliados: rows.length, avaliacoesComRealizacao: realized.length,
      valorEstimadoTotal: round(rows.reduce((sum: number, x: any) => sum + x.valorEstimado, 0)),
      valorRealizadoTotal: round(realized.reduce((sum: number, x: any) => sum + (x.valorRealizado as number), 0)),
      desvioRealizadoVsEstimado: realized.length ? round(realized.reduce((sum: number, x: any) => sum + ((x.valorRealizado as number) - x.valorEstimado), 0)) : null,
      porTipo: grouped("tipo"), porMarca: grouped("marca"), porModelo: grouped("modelo"), porEstadoFisico: grouped("estadoFisico"),
      relacaoPesoValor: rows.map((x: any) => ({ pesoQuilogramas: x.pesoQuilogramas, valorEstimado: x.valorEstimado, valorRealizado: x.valorRealizado })),
      observacao: "Valores estimados usam referência da mesma origem do equipamento (real ou demonstrativa), priorizando modelo, marca e referência genérica, ou tabela-base conservadora. A avaliação realizada também deve ter a mesma origem. Realização só é apresentada quando registrada; valores estimados não são resultados financeiros reais.",
    };
    await this.repo.saveRun({ tipo: "RENTABILIDADE_EQUIPAMENTOS", organizacaoId: filters.organizacaoId ?? null, metodo: "Peso x valor por kg x percentual recuperável", versaoModelo: "1.0.0", filtros: filters as any, resultado: result as any, observacoes: rows.length, indisponivel: rows.length === 0, motivo: rows.length ? null : "Nenhum equipamento elegível foi encontrado.", demonstracao: Boolean(filters.incluirDemonstracao), origemExecucao: filters.origemExecucao ?? "MANUAL", schedulerId: filters.schedulerId ?? null, jobId: filters.jobId ?? null, chaveExecucao: filters.schedulerId && filters.jobId ? `${filters.schedulerId}:${filters.jobId}` : null });
    return result;
  }
}
