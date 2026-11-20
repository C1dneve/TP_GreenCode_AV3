import { errors } from "../../shared/domain-error.js";
import { ProfitabilityService } from "../analytics/profitability.service.js";
import { HistoricoEquipamentosRepository } from "./historico.repository.js";
export function calculateDepreciatedValue(acquisitionValue: number, annualRatePercent: number, manufactureYear: number, referenceDate = new Date()) {
  const age = Math.max(0, referenceDate.getUTCFullYear() - manufactureYear);
  return Math.round(Math.max(0, acquisitionValue * (1 - annualRatePercent / 100 * age)) * 100) / 100;
}
export class HistoricoEquipamentosService {
  constructor(private readonly repo: HistoricoEquipamentosRepository) {}
  private get db() { return this.repo.db(); }
  private async equipment(id: string) { const item = await this.db.equipamento.findUnique({ where: { id }, include: { lote: { select: { organizacaoId: true } } } }); if (!item) throw errors.notFound("EQUIPMENT_NOT_FOUND", "Equipamento não encontrado."); return item; }
  async addFailure(id: string, input: any, actorId: string, requestId: string) {
    const equipment = await this.equipment(id); if (!input.categoria?.trim() || !input.severidade || !input.descricao?.trim()) throw errors.badRequest("VALIDATION_ERROR", "Categoria, severidade e descrição são obrigatórias.");
    if (!["BAIXA", "MEDIA", "ALTA", "CRITICA"].includes(input.severidade)) throw errors.badRequest("VALIDATION_ERROR", "Severidade inválida.");
    const occurredAt = input.ocorridoEm ? new Date(input.ocorridoEm) : new Date(); if (!Number.isFinite(occurredAt.getTime())) throw errors.badRequest("VALIDATION_ERROR", "Data da falha inválida.");
    return this.db.$transaction(async (tx: any) => { const failure = await tx.falhaEquipamento.create({ data: { equipamentoId: id, categoria: input.categoria.trim(), severidade: input.severidade, descricao: input.descricao.trim(), ocorridoEm: occurredAt, demonstracao: equipment.demonstracao } }); await tx.eventoAuditoria.create({ data: { atorUsuarioId: actorId, atorTipo: "USUARIO", organizacaoId: equipment.lote?.organizacaoId, acao: "REGISTRO_FALHA_EQUIPAMENTO", entidade: "FalhaEquipamento", entidadeId: failure.id, resultado: "SUCESSO", requestId, detalhes: { equipamentoId: id, severidade: input.severidade } } }); return failure; });
  }
  async addMaintenance(id: string, input: any, actorId: string, requestId: string) {
    const equipment = await this.equipment(id); if (!input.tipo?.trim() || !input.descricao?.trim()) throw errors.badRequest("VALIDATION_ERROR", "Tipo e descrição da manutenção são obrigatórios.");
    const when = input.realizadaEm ? new Date(input.realizadaEm) : new Date(); if (!Number.isFinite(when.getTime())) throw errors.badRequest("VALIDATION_ERROR", "Data de manutenção inválida.");
    const cost = input.custo === undefined ? null : Number(input.custo); if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw errors.badRequest("VALIDATION_ERROR", "Custo deve ser um número não negativo.");
    return this.db.$transaction(async (tx: any) => { const maintenance = await tx.manutencaoEquipamento.create({ data: { equipamentoId: id, tipo: input.tipo.trim(), descricao: input.descricao.trim(), realizadaEm: when, custo: cost === null ? null : cost.toFixed(2), demonstracao: equipment.demonstracao } }); await tx.eventoAuditoria.create({ data: { atorUsuarioId: actorId, atorTipo: "USUARIO", organizacaoId: equipment.lote?.organizacaoId, acao: "REGISTRO_MANUTENCAO_EQUIPAMENTO", entidade: "ManutencaoEquipamento", entidadeId: maintenance.id, resultado: "SUCESSO", requestId, detalhes: { equipamentoId: id } } }); return maintenance; });
  }
  async evaluateDepreciation(id: string, actorId: string, requestId: string, input: Record<string, never>) {
    const equipment = await this.equipment(id); const params = await this.db.parametroGlobal.findUnique({ where: { id: "global" } }); const rate = Number(params?.taxaDepreciacaoAnualPercentual ?? 15); const value = calculateDepreciatedValue(Number(equipment.valorAquisicao), rate, equipment.anoFabricacao);
    return this.db.$transaction(async (tx: any) => { const result = await tx.historicoDepreciacao.create({ data: { equipamentoId: id, valorEstimado: value.toFixed(2), taxaAnualPercentual: rate.toFixed(4), estadoFisico: equipment.estadoFisico, metodo: "Depreciação linear anual sobre valor de aquisição", demonstracao: equipment.demonstracao } }); await tx.eventoAuditoria.create({ data: { atorUsuarioId: actorId, atorTipo: "USUARIO", organizacaoId: equipment.lote?.organizacaoId, acao: "AVALIACAO_DEPRECIACAO", entidade: "HistoricoDepreciacao", entidadeId: result.id, resultado: "SUCESSO", requestId, detalhes: { equipamentoId: id, valorEstimado: value } } }); return result; });
  }
  async evaluateRecovery(id: string, actorId: string, requestId: string, input: { observacao?: string }) {
    const equipment = await this.equipment(id);
    const now = new Date();
    const references = await this.db.referenciaRecuperacao.findMany({ where: { tipo: equipment.tipo, estadoFisico: equipment.estadoFisico, ativa: true, demonstracao: equipment.demonstracao, vigenciaInicio: { lte: now }, OR: [{ vigenciaFim: null }, { vigenciaFim: { gt: now } }] }, orderBy: [{ modelo: "desc" }, { marca: "desc" }, { vigenciaInicio: "desc" }] });
    const estimate = ProfitabilityService.estimate({ tipo: equipment.tipo, marca: equipment.marca, modelo: equipment.modelo, estadoFisico: equipment.estadoFisico, pesoQuilogramas: Number(equipment.pesoQuilogramas) }, references);
    const ref = references.find((item: any) => item.id === estimate.referenciaId) ?? null;
    const value = estimate.valorEstimado;
    return this.db.$transaction(async (tx: any) => { const evaluation = await tx.avaliacaoRecuperacao.create({ data: { equipamentoId: id, valorEstimado: value.toFixed(2), metodo: ref ? "Referência por tipo, estado, marca e modelo com fallback hierárquico" : "Tabela-base conservadora por tipo e estado", quantidadeKg: equipment.pesoQuilogramas, demonstracao: equipment.demonstracao, observacao: input.observacao?.trim() || null } }); await tx.eventoAuditoria.create({ data: { atorUsuarioId: actorId, atorTipo: "USUARIO", organizacaoId: equipment.lote?.organizacaoId, acao: "AVALIACAO_RECUPERACAO", entidade: "AvaliacaoRecuperacao", entidadeId: evaluation.id, resultado: "SUCESSO", requestId, detalhes: { equipamentoId: id, valorEstimado: value, referenciaId: ref?.id ?? null } } }); return { ...evaluation, valorEstimado: value, valorReferenciaPorKg: estimate.valorReferenciaPorKg, percentualRecuperavel: estimate.percentualRecuperavel, fonte: estimate.fonte }; });
  }
  async recordRealization(equipmentId: string, evaluationId: string, value: number, actorId: string, requestId: string) {
    if (!Number.isFinite(value) || value < 0) throw errors.badRequest("VALIDATION_ERROR", "Valor realizado deve ser não negativo.");
    const current = await this.db.avaliacaoRecuperacao.findFirst({ where: { id: evaluationId, equipamentoId: equipmentId } });
    if (!current) throw errors.notFound("RECOVERY_EVALUATION_NOT_FOUND", "Avaliação de recuperação não encontrada.");
    if (current.valorRealizado !== null) throw errors.conflict("RECOVERY_ALREADY_REALIZED", "Esta avaliação já possui valor realizado.");
    return this.db.$transaction(async (tx: any) => {
      // Compare-and-set atômico: somente uma requisição pode preencher o valor realizado.
      const changed = await tx.avaliacaoRecuperacao.updateMany({ where: { id: evaluationId, equipamentoId: equipmentId, valorRealizado: null }, data: { valorRealizado: value.toFixed(2), realizadoEm: new Date() } });
      if (changed.count !== 1) throw errors.conflict("RECOVERY_ALREADY_REALIZED", "Esta avaliação já foi realizada por outra operação.");
      const updated = await tx.avaliacaoRecuperacao.findUnique({ where: { id: evaluationId } });
      await tx.eventoAuditoria.create({ data: { atorUsuarioId: actorId, atorTipo: "USUARIO", acao: "REGISTRO_VALOR_RECUPERADO", entidade: "AvaliacaoRecuperacao", entidadeId: evaluationId, resultado: "SUCESSO", requestId, detalhes: { equipamentoId: equipmentId, valorRealizado: value } } });
      return updated;
    });
  }
  async history(id: string) { await this.equipment(id); const [failures, maintenance, depreciation, recovery] = await Promise.all([this.db.falhaEquipamento.findMany({ where: { equipamentoId: id }, orderBy: { ocorridoEm: "desc" } }), this.db.manutencaoEquipamento.findMany({ where: { equipamentoId: id }, orderBy: { realizadaEm: "desc" } }), this.db.historicoDepreciacao.findMany({ where: { equipamentoId: id }, orderBy: { avaliadoEm: "desc" } }), this.db.avaliacaoRecuperacao.findMany({ where: { equipamentoId: id }, orderBy: { avaliadoEm: "desc" } })]); return { falhas: failures, manutencoes: maintenance, depreciacoes: depreciation, recuperacao: recovery }; }
}
