import { randomUUID } from "node:crypto";
import { errors, isPrismaCode } from "../../shared/domain-error.js";
import { TriagemRepository } from "./triagem.repository.js";
export class TriagemService {
  constructor(private readonly repo: TriagemRepository) {}
  private get db() { return this.repo.db(); }
  private async transaction<T>(callback: (tx: any) => Promise<T>) {
    try {
      return await this.db.$transaction(callback, { isolationLevel: "Serializable" });
    } catch (error) {
      if (isPrismaCode(error, "P2034")) throw errors.conflict("CONCURRENT_MODIFICATION", "A triagem foi alterada por outra operação. Consulte o histórico e tente novamente.");
      throw error;
    }
  }
  async start(loteId: string, actorId: string, requestId: string, observacao?: string) {
    const sessaoId = randomUUID();
    return this.transaction(async (tx: any) => {
      const lote = await tx.lote.findUnique({ where: { id: loteId }, select: { id: true, organizacaoId: true, demonstracao: true, statusProcessamento: true, ativo: true, versao: true } });
      if (!lote) throw errors.notFound("LOT_NOT_FOUND", "Lote não encontrado.");
      if (!lote.ativo || lote.statusProcessamento !== "RECEBIDO") throw errors.conflict("INVALID_TRIAGE_STATE", "Somente lote ativo e recebido pode iniciar a triagem.");
      const count = await tx.equipamento.count({ where: { loteId, ativo: true, statusRastreamento: "AGUARDANDO_TRIAGEM" } });
      const total = await tx.equipamento.count({ where: { loteId } });
      if (!total || count !== total) throw errors.conflict("EQUIPMENT_STATE_CONFLICT", "Todos os equipamentos devem estar ativos e aguardando triagem.");
      const updated = await tx.lote.updateMany({ where: { id: loteId, versao: lote.versao, statusProcessamento: "RECEBIDO", ativo: true }, data: { statusProcessamento: "EM_TRIAGEM", versao: { increment: 1 } } });
      if (updated.count !== 1) throw errors.conflict("CONCURRENT_MODIFICATION", "O lote foi alterado durante o início da triagem.");
      const history = await tx.historicoTriagem.create({ data: { sessaoId, loteId, responsavelId: actorId, etapa: "TRIAGEM_INICIADA", demonstracao: lote.demonstracao, observacao: observacao?.trim() || null } });
      await tx.eventoAuditoria.create({ data: { atorUsuarioId: actorId, atorTipo: "USUARIO", acao: "INICIO_TRIAGEM", entidade: "Lote", entidadeId: loteId, organizacaoId: lote.organizacaoId, resultado: "SUCESSO", requestId, detalhes: { sessaoId } } });
      return { sessaoId, loteId, status: "EM_TRIAGEM", iniciadoEm: history.ocorridoEm, responsavelId: actorId };
    });
  }
  async complete(loteId: string, sessaoId: string, actorId: string, requestId: string, observacao?: string) {
    return this.transaction(async (tx: any) => {
      const lote = await tx.lote.findUnique({ where: { id: loteId }, select: { id: true, organizacaoId: true, demonstracao: true, statusProcessamento: true, ativo: true, versao: true } });
      if (!lote) throw errors.notFound("LOT_NOT_FOUND", "Lote não encontrado.");
      const started = await tx.historicoTriagem.findFirst({ where: { loteId, sessaoId, etapa: "TRIAGEM_INICIADA" } });
      if (!started) throw errors.notFound("TRIAGE_SESSION_NOT_FOUND", "Sessão de triagem não encontrada para este lote.");
      const finished = await tx.historicoTriagem.findFirst({ where: { loteId, sessaoId, etapa: "TRIAGEM_CONCLUIDA" } });
      if (finished) throw errors.conflict("TRIAGE_ALREADY_COMPLETED", "Esta sessão de triagem já foi concluída.");
      if (!lote.ativo || lote.statusProcessamento !== "EM_TRIAGEM") throw errors.conflict("INVALID_TRIAGE_STATE", "O lote não está em triagem.");
      const items = await tx.equipamento.findMany({ where: { loteId, ativo: true, statusRastreamento: "AGUARDANDO_TRIAGEM" }, select: { id: true, versao: true } });
      const total = await tx.equipamento.count({ where: { loteId } });
      if (!total || items.length !== total) throw errors.conflict("EQUIPMENT_STATE_CONFLICT", "O estado dos equipamentos não permite concluir a triagem.");
      for (const item of items) {
        const changed = await tx.equipamento.updateMany({ where: { id: item.id, loteId, versao: item.versao, statusRastreamento: "AGUARDANDO_TRIAGEM", ativo: true }, data: { statusRastreamento: "AGUARDANDO_DESMONTE", versao: { increment: 1 } } });
        if (changed.count !== 1) throw errors.conflict("CONCURRENT_MODIFICATION", "Um equipamento foi alterado durante a conclusão.");
      }
      const updated = await tx.lote.updateMany({ where: { id: loteId, versao: lote.versao, statusProcessamento: "EM_TRIAGEM", ativo: true }, data: { statusProcessamento: "TRIAGEM_CONCLUIDA", versao: { increment: 1 } } });
      if (updated.count !== 1) throw errors.conflict("CONCURRENT_MODIFICATION", "O lote foi alterado durante a conclusão.");
      const history = await tx.historicoTriagem.create({ data: { sessaoId, loteId, responsavelId: actorId, etapa: "TRIAGEM_CONCLUIDA", demonstracao: lote.demonstracao, observacao: observacao?.trim() || null } });
      await tx.eventoAuditoria.create({ data: { atorUsuarioId: actorId, atorTipo: "USUARIO", acao: "CONCLUSAO_TRIAGEM", entidade: "Lote", entidadeId: loteId, organizacaoId: lote.organizacaoId, resultado: "SUCESSO", requestId, detalhes: { sessaoId, duracaoMs: history.ocorridoEm.getTime() - started.ocorridoEm.getTime() } } });
      return { sessaoId, loteId, status: "TRIAGEM_CONCLUIDA", concluidoEm: history.ocorridoEm, duracaoMs: history.ocorridoEm.getTime() - started.ocorridoEm.getTime() };
    });
  }
  async occurrence(loteId: string, sessaoId: string, actorId: string, requestId: string, observacao: string) {
    const note = observacao?.trim(); if (!note || note.length > 2000) throw errors.badRequest("VALIDATION_ERROR", "A ocorrência deve conter de 1 a 2000 caracteres.");
    return this.transaction(async (tx: any) => {
      const lote = await tx.lote.findUnique({ where: { id: loteId }, select: { id: true, organizacaoId: true, demonstracao: true, statusProcessamento: true } });
      if (!lote) throw errors.notFound("LOT_NOT_FOUND", "Lote não encontrado.");
      if (lote.statusProcessamento !== "EM_TRIAGEM") throw errors.conflict("INVALID_TRIAGE_STATE", "Ocorrências desta sessão só podem ser registradas durante a triagem.");
      const started = await tx.historicoTriagem.findFirst({ where: { loteId, sessaoId, etapa: "TRIAGEM_INICIADA" } });
      if (!started) throw errors.notFound("TRIAGE_SESSION_NOT_FOUND", "Sessão de triagem não encontrada para este lote.");
      const history = await tx.historicoTriagem.create({ data: { sessaoId, loteId, responsavelId: actorId, etapa: "OCORRENCIA", demonstracao: lote.demonstracao, observacao: note } });
      await tx.eventoAuditoria.create({ data: { atorUsuarioId: actorId, atorTipo: "USUARIO", acao: "OCORRENCIA_TRIAGEM", entidade: "Lote", entidadeId: loteId, organizacaoId: lote.organizacaoId, resultado: "SUCESSO", requestId, detalhes: { sessaoId } } });
      return history;
    });
  }
  history(loteId: string) { return this.db.historicoTriagem.findMany({ where: { loteId }, include: { responsavel: { select: { id: true, nome: true } } }, orderBy: { ocorridoEm: "asc" } }); }
}
