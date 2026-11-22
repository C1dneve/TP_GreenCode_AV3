import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { DomainError, errors, isPrismaCode } from "../../shared/domain-error.js";
import { normalizeEquipmentCreateInput, generateInternalBarcode, type EquipmentCreateInput } from "../equipamentos/equipamento-domain.js";
import { normalizeLoteCreateInput, type LoteCreateInput } from "../lotes/lote-domain.js";
import type { IntegrationIdentity } from "./integration-auth.js";
import { semanticHash } from "../integracoes/normalization.js";
import { hasScope } from "../integracoes/scopes.js";

export interface PublicSubmissionInput extends LoteCreateInput {
  externalId?: string;
  equipamentos?: EquipmentCreateInput[];
}

const TRACKING_AUDIT_ACTIONS = [
  "CRIACAO_LOTE", "ATUALIZACAO_LOTE", "TRIAGEM_LOTE", "ENCAMINHAMENTO_LOTE",
  "FINALIZACAO_LOTE", "DESATIVACAO_LOTE", "REATIVACAO_LOTE", "SUBMISSAO_PUBLICA_LOTE",
  "ATUALIZACAO_PUBLICA_LOTE", "CANCELAMENTO_PUBLICO_LOTE",
];

function safeSubmissionView(lot: {
  publicId: string; statusProcessamento: string; dataEntrada: Date; createdAt: Date;
  equipamentos: Array<{ tipo: string; marca: string; modelo: string; estadoFisico: string; statusRastreamento: string }>;
}, externalId?: string) {
  return {
    identificadorPublico: lot.publicId,
    ...(externalId ? { externalId } : {}),
    status: lot.statusProcessamento,
    dataEntrada: lot.dataEntrada,
    criadoEm: lot.createdAt,
    quantidadeEquipamentos: lot.equipamentos.length,
    equipamentos: lot.equipamentos.map(({ tipo, marca, modelo, estadoFisico, statusRastreamento }) => ({ tipo, marca, modelo, estadoFisico, statusRastreamento })),
  };
}

export class ApiPublicaService {
  constructor(private readonly prisma: PrismaClient) {}

  async submit(input: PublicSubmissionInput, context: IntegrationIdentity, integrationIdentifier: string, idempotencyKey: string, requestId: string) {
    if (!hasScope(context.escoposEfetivos, "lotes:write")) throw errors.forbidden("A API Key não possui o escopo lotes:write.");
    if (input.equipamentos !== undefined && !Array.isArray(input.equipamentos)) throw errors.badRequest("VALIDATION_ERROR", "equipamentos deve ser uma lista.");
    const normalizedLot = normalizeLoteCreateInput(input);
    const normalizedEquipment = (input.equipamentos ?? []).map((equipment) => normalizeEquipmentCreateInput(equipment));
    if (normalizedEquipment.length > context.maxEquipamentosPorSubmissao) throw new DomainError(429, "SUBMISSION_EQUIPMENT_LIMIT_EXCEEDED", `A submissão excede o limite de ${context.maxEquipamentosPorSubmissao} equipamentos.`, { limite: context.maxEquipamentosPorSubmissao, recebido: normalizedEquipment.length });
    if (normalizedEquipment.length === 0 && !context.permiteLoteSemEquipamentos) throw errors.badRequest("EMPTY_LOT_NOT_ALLOWED", "Este parceiro não está autorizado a submeter lotes sem equipamentos.");
    if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length < 1 || idempotencyKey.length > 200) throw errors.badRequest("INVALID_IDEMPOTENCY_KEY", "O cabeçalho Idempotency-Key é obrigatório e deve ter até 200 caracteres.");
    const externalId = input.externalId?.trim() || undefined;
    if (externalId && externalId.length > 200) throw errors.badRequest("VALIDATION_ERROR", "externalId deve ter até 200 caracteres.");

    // A data default é usada para a persistência, mas não entra no hash; retries sem data explícita continuam semanticamente idênticos.
    const requestHash = semanticHash({
      associacaoPublica: integrationIdentifier,
      externalId: externalId ?? null,
      lote: {
        dataEntrada: input.dataEntrada ? normalizedLot.dataEntrada.toISOString() : null,
        notaFiscal: normalizedLot.notaFiscal,
        transportadora: normalizedLot.transportadora,
        observacoes: normalizedLot.observacoes,
      },
      equipamentos: normalizedEquipment.map(({ tipo, marca, modelo, anoFabricacao, estadoFisico, pesoQuilogramas, valorAquisicao }) => ({
        tipo, marca, modelo, anoFabricacao, estadoFisico, pesoQuilogramas, valorAquisicao,
      })),
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // Serializa retries simultâneos da mesma chave no banco, inclusive entre instâncias da API.
          // ReadCommitted permite que a transação que aguardou o lock veja o registro confirmado pela primeira.
          const lockKey = `${context.parceiroId}:${idempotencyKey.trim()}`;
          await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))) AS acquired_lock`;

          const association = await tx.parceiroOrganizacao.findFirst({
            where: { identificadorPublico: integrationIdentifier, parceiroId: context.parceiroId, ativo: true, organizacao: { ativo: true } },
            select: { id: true, organizacaoId: true },
          });
          if (!association) throw errors.forbidden("Identificador de integração inexistente, revogado ou não autorizado.");

          const existingByKey = await tx.requisicaoIdempotencia.findUnique({
            where: { parceiroId_chave: { parceiroId: context.parceiroId, chave: idempotencyKey.trim() } },
            select: { requestHash: true, loteId: true },
          });
          if (existingByKey) {
            if (existingByKey.requestHash !== requestHash) throw errors.conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key já foi utilizada com conteúdo diferente.");
            const original = await this.findSafeLot(tx, existingByKey.loteId);
            await this.recordExternalAudit(tx, context, association.organizacaoId, original.id, requestId, "SUBMISSAO_PUBLICA_IDEMPOTENTE", { externalId: externalId ?? null, quantidadeEquipamentos: normalizedEquipment.length });
            return safeSubmissionView(original, externalId);
          }

          if (externalId) {
            const existingExternal = await tx.referenciaExternaParceiro.findUnique({
              where: { parceiroId_externalId: { parceiroId: context.parceiroId, externalId } },
              select: { requestHash: true, loteId: true },
            });
            if (existingExternal) {
              if (existingExternal.requestHash !== requestHash) throw errors.conflict("EXTERNAL_ID_REUSED", "externalId já foi utilizado com conteúdo diferente.");
              await tx.requisicaoIdempotencia.create({ data: { parceiroId: context.parceiroId, chave: idempotencyKey.trim(), requestHash, loteId: existingExternal.loteId } });
              const original = await this.findSafeLot(tx, existingExternal.loteId);
              await this.recordExternalAudit(tx, context, association.organizacaoId, original.id, requestId, "SUBMISSAO_PUBLICA_IDEMPOTENTE", { externalId, quantidadeEquipamentos: normalizedEquipment.length });
              return safeSubmissionView(original, externalId);
            }
          }

          const lot = await tx.lote.create({ data: {
            organizacaoId: association.organizacaoId,
            ...normalizedLot,
            statusProcessamento: "RECEBIDO",
            ativo: true,
          }, select: { id: true, publicId: true, statusProcessamento: true, dataEntrada: true, createdAt: true } });

          const currentMax = await tx.equipamento.aggregate({ where: { loteId: lot.id }, _max: { posicaoNoLote: true } });
          let position = (currentMax._max.posicaoNoLote ?? 0) + 1;
          for (const equipment of normalizedEquipment) {
            let created = false;
            for (let tries = 0; tries < 5; tries += 1) {
              try {
                await tx.equipamento.create({ data: {
                  codigoBarrasInterno: generateInternalBarcode(equipment.prefixo),
                  tipo: equipment.tipo as never,
                  marca: equipment.marca,
                  modelo: equipment.modelo,
                  anoFabricacao: equipment.anoFabricacao,
                  estadoFisico: equipment.estadoFisico as never,
                  pesoQuilogramas: equipment.pesoQuilogramas,
                  valorAquisicao: equipment.valorAquisicao,
                  loteId: lot.id,
                  posicaoNoLote: position,
                  statusRastreamento: "AGUARDANDO_TRIAGEM",
                  ativo: true,
                } });
                created = true;
                break;
              } catch (error) {
                if (!isPrismaCode(error, "P2002") || tries === 4) throw error;
              }
            }
            if (!created) throw errors.conflict("CODE_GENERATION_CONFLICT", "Não foi possível gerar código interno único; tente novamente.");
            position += 1;
          }

          if (externalId) await tx.referenciaExternaParceiro.create({ data: { parceiroId: context.parceiroId, externalId, requestHash, loteId: lot.id } });
          await tx.requisicaoIdempotencia.create({ data: { parceiroId: context.parceiroId, chave: idempotencyKey.trim(), requestHash, loteId: lot.id } });
          await this.recordExternalAudit(tx, context, association.organizacaoId, lot.id, requestId, "SUBMISSAO_PUBLICA_LOTE", {
            externalId: externalId ?? null,
            identificadorPublico: lot.publicId,
            quantidadeEquipamentos: normalizedEquipment.length,
          });
          const created = await this.findSafeLot(tx, lot.id);
          return safeSubmissionView(created, externalId);
        }, { isolationLevel: "ReadCommitted" });
      } catch (error) {
        if (error instanceof Error && "statusCode" in error) throw error;
        if ((isPrismaCode(error, "P2034") || isPrismaCode(error, "P2002")) && attempt < 3) continue;
        if (isPrismaCode(error, "P2002")) throw errors.conflict("IDEMPOTENCY_CONFLICT", "A requisição conflitou com uma submissão concorrente. Repita com a mesma Idempotency-Key.");
        if (isPrismaCode(error, "P2034")) throw errors.conflict("CONCURRENT_SUBMISSION", "A submissão conflitou com outra operação. Repita com a mesma Idempotency-Key.");
        throw error;
      }
    }
    throw errors.conflict("CONCURRENT_SUBMISSION", "Não foi possível resolver a submissão concorrente. Repita a requisição com a mesma Idempotency-Key.");
  }

  private async authorizedOrganizationIds(db: Prisma.TransactionClient | PrismaClient, partnerId: string): Promise<string[]> {
    const associations = await db.parceiroOrganizacao.findMany({
      where: { parceiroId: partnerId, ativo: true, organizacao: { ativo: true } },
      select: { organizacaoId: true },
    });
    return [...new Set(associations.map((association) => association.organizacaoId))];
  }

  private async publicLotView(db: Prisma.TransactionClient | PrismaClient, lotId: string, partnerId: string) {
    const lot = await db.lote.findUnique({
      where: { id: lotId },
      select: {
        publicId: true, statusProcessamento: true, ativo: true, versao: true,
        dataEntrada: true, notaFiscal: true, transportadora: true, observacoes: true,
        createdAt: true, updatedAt: true,
        _count: { select: { equipamentos: true } },
        referenciasExternas: { where: { parceiroId: partnerId }, select: { externalId: true }, take: 1 },
      },
    });
    if (!lot) throw errors.notFound("LOT_NOT_FOUND", "Lote não encontrado.");
    const cancelled = !lot.ativo && lot.statusProcessamento === "RECEBIDO";
    return {
      identificadorPublico: lot.publicId,
      ...(lot.referenciasExternas[0] ? { externalId: lot.referenciasExternas[0].externalId } : {}),
      status: cancelled ? "CANCELADO" : lot.statusProcessamento,
      ativo: lot.ativo,
      versao: lot.versao,
      dataEntrada: lot.dataEntrada,
      notaFiscal: lot.notaFiscal,
      transportadora: lot.transportadora,
      observacoes: lot.observacoes,
      criadoEm: lot.createdAt,
      atualizadoEm: lot.updatedAt,
      quantidadeEquipamentos: lot._count.equipamentos,
    };
  }

  async listLots(query: {
    page?: number; pageSize?: number; status?: string; externalId?: string;
    dataEntradaDe?: string; dataEntradaAte?: string; ativo?: boolean;
  }, context: IntegrationIdentity) {
    if (!hasScope(context.escoposEfetivos, "lotes:read")) throw errors.forbidden("A API Key não possui o escopo lotes:read.");
    const page = Math.max(1, Math.min(10_000, Number(query.page) || 1));
    const pageSize = Math.max(1, Math.min(100, Number(query.pageSize) || 20));
    const organizationIds = await this.authorizedOrganizationIds(this.prisma, context.parceiroId);
    if (!organizationIds.length) return { data: [], meta: { page, pageSize, total: 0, totalPages: 0 } };

    const from = query.dataEntradaDe ? new Date(query.dataEntradaDe) : undefined;
    const to = query.dataEntradaAte ? new Date(query.dataEntradaAte) : undefined;
    if (from && !Number.isFinite(from.getTime())) throw errors.badRequest("VALIDATION_ERROR", "dataEntradaDe inválida.");
    if (to && !Number.isFinite(to.getTime())) throw errors.badRequest("VALIDATION_ERROR", "dataEntradaAte inválida.");
    if (from && to && from > to) throw errors.badRequest("VALIDATION_ERROR", "dataEntradaDe não pode ser posterior a dataEntradaAte.");
    if (query.status && !["RECEBIDO", "EM_TRIAGEM", "TRIAGEM_CONCLUIDA", "ENCAMINHADO", "FINALIZADO", "CANCELADO"].includes(query.status)) {
      throw errors.badRequest("VALIDATION_ERROR", "Status de lote inválido.");
    }
    if (query.externalId !== undefined && (!query.externalId.trim() || query.externalId.length > 200)) {
      throw errors.badRequest("VALIDATION_ERROR", "externalId deve conter entre 1 e 200 caracteres.");
    }

    const statusFilter: Prisma.LoteWhereInput = query.status === "CANCELADO"
      ? { statusProcessamento: "RECEBIDO", ativo: false }
      : query.status ? { statusProcessamento: query.status as never } : {};
    const where: Prisma.LoteWhereInput = {
      organizacaoId: { in: organizationIds },
      OR: [
        { idempotencias: { some: { parceiroId: context.parceiroId } } },
        { referenciasExternas: { some: { parceiroId: context.parceiroId } } },
      ],
      ...statusFilter,
      ...(query.ativo !== undefined ? { ativo: query.ativo } : {}),
      ...(from || to ? { dataEntrada: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(query.externalId ? { referenciasExternas: { some: { parceiroId: context.parceiroId, externalId: query.externalId.trim() } } } : {}),
    };
    const [lots, total] = await Promise.all([
      this.prisma.lote.findMany({
        where, orderBy: [{ dataEntrada: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true },
      }),
      this.prisma.lote.count({ where }),
    ]);
    const data = await Promise.all(lots.map((lot) => this.publicLotView(this.prisma, lot.id, context.parceiroId)));
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async getLot(publicId: string, context: IntegrationIdentity) {
    if (!hasScope(context.escoposEfetivos, "lotes:read")) throw errors.forbidden("A API Key não possui o escopo lotes:read.");
    const organizationIds = await this.authorizedOrganizationIds(this.prisma, context.parceiroId);
    const lot = await this.prisma.lote.findFirst({
      where: {
        publicId,
        organizacaoId: { in: organizationIds },
        OR: [
          { idempotencias: { some: { parceiroId: context.parceiroId } } },
          { referenciasExternas: { some: { parceiroId: context.parceiroId } } },
        ],
      },
      select: { id: true },
    });
    if (!lot) throw errors.notFound("LOT_NOT_FOUND", "Lote não encontrado.");
    return this.publicLotView(this.prisma, lot.id, context.parceiroId);
  }

  async updateLot(publicId: string, input: {
    versaoEsperada: number; notaFiscal?: string; transportadora?: string; observacoes?: string;
  }, context: IntegrationIdentity, requestId: string) {
    if (!hasScope(context.escoposEfetivos, "lotes:write")) throw errors.forbidden("A API Key não possui o escopo lotes:write.");
    if (!Number.isInteger(input.versaoEsperada) || input.versaoEsperada < 1) throw errors.badRequest("VALIDATION_ERROR", "versaoEsperada deve ser um inteiro positivo.");
    const data: Prisma.LoteUpdateManyMutationInput = {};
    const changedFields: string[] = [];
    if (input.notaFiscal !== undefined) {
      const value = input.notaFiscal.trim();
      if (!value || value.length > 100) throw errors.badRequest("VALIDATION_ERROR", "notaFiscal deve conter entre 1 e 100 caracteres.");
      data.notaFiscal = value; changedFields.push("notaFiscal");
    }
    if (input.transportadora !== undefined) {
      const value = input.transportadora.trim();
      if (!value || value.length > 120) throw errors.badRequest("VALIDATION_ERROR", "transportadora deve conter entre 1 e 120 caracteres.");
      data.transportadora = value; changedFields.push("transportadora");
    }
    if (input.observacoes !== undefined) {
      const value = input.observacoes.trim();
      if (value.length > 2000) throw errors.badRequest("VALIDATION_ERROR", "observacoes excede 2000 caracteres.");
      data.observacoes = value; changedFields.push("observacoes");
    }
    if (!changedFields.length) throw errors.badRequest("VALIDATION_ERROR", "Informe ao menos um campo editável além de versaoEsperada.");

    try {
      return await this.prisma.$transaction(async (tx) => {
      const organizationIds = await this.authorizedOrganizationIds(tx, context.parceiroId);
      const lot = await tx.lote.findFirst({ where: {
        publicId, organizacaoId: { in: organizationIds },
        OR: [
          { idempotencias: { some: { parceiroId: context.parceiroId } } },
          { referenciasExternas: { some: { parceiroId: context.parceiroId } } },
        ],
      }, select: { id: true, organizacaoId: true, statusProcessamento: true, ativo: true, versao: true } });
      if (!lot) throw errors.notFound("LOT_NOT_FOUND", "Lote não encontrado.");
      if (lot.versao !== input.versaoEsperada) throw errors.conflict("VERSION_CONFLICT", "Lote alterado por outra operação; consulte a versão atual antes de tentar novamente.");
      if (!lot.ativo || lot.statusProcessamento !== "RECEBIDO") throw errors.conflict("LOT_NOT_EDITABLE", "O parceiro só pode editar lotes ativos que ainda estejam em RECEBIDO.");
      const [equipmentInProgress, triageEvents] = await Promise.all([
        tx.equipamento.count({ where: { loteId: lot.id, OR: [{ statusRastreamento: { not: "AGUARDANDO_TRIAGEM" } }, { movimentacoes: { some: {} } }] } }),
        tx.historicoTriagem.count({ where: { loteId: lot.id } }),
      ]);
      if (equipmentInProgress > 0 || triageEvents > 0) throw errors.conflict("LOT_OPERATION_STARTED", "O lote possui triagem ou movimentação registrada e não pode mais ser editado pelo parceiro.");
      const updated = await tx.lote.updateMany({
        where: { id: lot.id, versao: input.versaoEsperada, ativo: true, statusProcessamento: "RECEBIDO" },
        data: { ...data, versao: { increment: 1 } },
      });
      if (updated.count !== 1) throw errors.conflict("VERSION_CONFLICT", "Lote alterado por outra operação; consulte a versão atual antes de tentar novamente.");
      await this.recordExternalAudit(tx, context, lot.organizacaoId, lot.id, requestId, "ATUALIZACAO_PUBLICA_LOTE", {
        camposAlterados: changedFields.join(","), versaoEsperada: input.versaoEsperada,
      });
      return this.publicLotView(tx, lot.id, context.parceiroId);
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (isPrismaCode(error, "P2034")) throw errors.conflict("VERSION_CONFLICT", "O lote foi alterado simultaneamente. Consulte a versão atual antes de tentar novamente.");
      throw error;
    }
  }

  async cancelLot(publicId: string, expectedVersion: number, context: IntegrationIdentity, requestId: string) {
    if (!hasScope(context.escoposEfetivos, "lotes:write")) throw errors.forbidden("A API Key não possui o escopo lotes:write.");
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw errors.badRequest("VALIDATION_ERROR", "versaoEsperada deve ser um inteiro positivo.");
    try {
      return await this.prisma.$transaction(async (tx) => {
      const organizationIds = await this.authorizedOrganizationIds(tx, context.parceiroId);
      const lot = await tx.lote.findFirst({ where: {
        publicId, organizacaoId: { in: organizationIds },
        OR: [
          { idempotencias: { some: { parceiroId: context.parceiroId } } },
          { referenciasExternas: { some: { parceiroId: context.parceiroId } } },
        ],
      }, select: { id: true, organizacaoId: true, statusProcessamento: true, ativo: true, versao: true } });
      if (!lot) throw errors.notFound("LOT_NOT_FOUND", "Lote não encontrado.");
      // Repetir DELETE sobre um cancelamento já concluído não executa outra alteração.
      if (!lot.ativo && lot.statusProcessamento === "RECEBIDO") return this.publicLotView(tx, lot.id, context.parceiroId);
      if (lot.versao !== expectedVersion) throw errors.conflict("VERSION_CONFLICT", "Lote alterado por outra operação; consulte a versão atual antes de tentar novamente.");
      if (!lot.ativo || lot.statusProcessamento !== "RECEBIDO") throw errors.conflict("LOT_NOT_CANCELLABLE", "Somente lotes ativos que ainda estejam em RECEBIDO podem ser cancelados pelo parceiro.");
      const [equipmentInProgress, triageEvents] = await Promise.all([
        tx.equipamento.count({ where: { loteId: lot.id, OR: [{ statusRastreamento: { not: "AGUARDANDO_TRIAGEM" } }, { movimentacoes: { some: {} } }] } }),
        tx.historicoTriagem.count({ where: { loteId: lot.id } }),
      ]);
      if (equipmentInProgress > 0 || triageEvents > 0) throw errors.conflict("LOT_OPERATION_STARTED", "O lote possui triagem ou movimentação registrada e não pode ser cancelado.");
      const cancelled = await tx.lote.updateMany({
        where: { id: lot.id, versao: expectedVersion, ativo: true, statusProcessamento: "RECEBIDO" },
        data: { ativo: false, versao: { increment: 1 } },
      });
      if (cancelled.count !== 1) throw errors.conflict("VERSION_CONFLICT", "Lote alterado por outra operação; consulte a versão atual antes de tentar novamente.");
      await this.recordExternalAudit(tx, context, lot.organizacaoId, lot.id, requestId, "CANCELAMENTO_PUBLICO_LOTE", {
        versaoEsperada: expectedVersion,
      });
      return this.publicLotView(tx, lot.id, context.parceiroId);
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (isPrismaCode(error, "P2034")) throw errors.conflict("VERSION_CONFLICT", "O lote foi alterado simultaneamente. Consulte a versão atual antes de tentar novamente.");
      throw error;
    }
  }

  async getByPublicId(publicId: string, context: IntegrationIdentity, requestId: string) {
    if (!hasScope(context.escoposEfetivos, "rastreabilidade:read")) throw errors.forbidden("A API Key não possui o escopo rastreabilidade:read.");
    const lot = await this.prisma.lote.findFirst({ where: {
      publicId,
      OR: [
        { idempotencias: { some: { parceiroId: context.parceiroId } } },
        { referenciasExternas: { some: { parceiroId: context.parceiroId } } },
      ],
    }, select: { id: true, organizacaoId: true } });
    if (!lot) throw errors.notFound("TRACKING_NOT_FOUND", "Referência de rastreabilidade não encontrada.");
    return this.trackingForAuthorizedOrganization(lot.id, lot.organizacaoId, context, requestId, "PUBLIC_ID");
  }

  async getByExternalId(externalId: string, context: IntegrationIdentity, requestId: string) {
    if (!hasScope(context.escoposEfetivos, "rastreabilidade:read")) throw errors.forbidden("A API Key não possui o escopo rastreabilidade:read.");
    const reference = await this.prisma.referenciaExternaParceiro.findUnique({
      where: { parceiroId_externalId: { parceiroId: context.parceiroId, externalId } },
      select: { loteId: true, lote: { select: { organizacaoId: true } } },
    });
    if (!reference) throw errors.notFound("TRACKING_NOT_FOUND", "Referência de rastreabilidade não encontrada.");
    return this.trackingForAuthorizedOrganization(reference.loteId, reference.lote.organizacaoId, context, requestId, "EXTERNAL_ID", externalId);
  }

  private async trackingForAuthorizedOrganization(lotId: string, organizationId: string, context: IntegrationIdentity, requestId: string, referenceType: string, externalId?: string) {
    const association = await this.prisma.parceiroOrganizacao.findFirst({ where: { parceiroId: context.parceiroId, organizacaoId: organizationId, ativo: true, organizacao: { ativo: true } }, select: { id: true } });
    if (!association) throw errors.notFound("TRACKING_NOT_FOUND", "Referência de rastreabilidade não encontrada.");
    const ownedLot = await this.prisma.lote.findFirst({ where: {
      id: lotId,
      organizacaoId: organizationId,
      OR: [
        { idempotencias: { some: { parceiroId: context.parceiroId } } },
        { referenciasExternas: { some: { parceiroId: context.parceiroId } } },
      ],
    }, select: { id: true } });
    if (!ownedLot) throw errors.notFound("TRACKING_NOT_FOUND", "Referência de rastreabilidade não encontrada.");

    const lot = await this.prisma.lote.findUnique({ where: { id: lotId }, select: {
      id: true, publicId: true, statusProcessamento: true, dataEntrada: true, createdAt: true, updatedAt: true,
      equipamentos: { select: {
        tipo: true, marca: true, modelo: true, estadoFisico: true, statusRastreamento: true,
        movimentacoes: { select: { dataHora: true, origem: true, destino: true }, orderBy: [{ dataHora: "asc" }, { id: "asc" }] },
      }, orderBy: [{ posicaoNoLote: "asc" }, { id: "asc" }] },
    } });
    if (!lot) throw errors.notFound("TRACKING_NOT_FOUND", "Referência de rastreabilidade não encontrada.");

    const [history, partnerReference] = await Promise.all([
      this.prisma.eventoAuditoria.findMany({ where: { entidade: "Lote", entidadeId: lotId, acao: { in: TRACKING_AUDIT_ACTIONS } }, select: { instante: true, acao: true, resultado: true }, orderBy: [{ instante: "asc" }, { id: "asc" }] }),
      this.prisma.referenciaExternaParceiro.findFirst({ where: { parceiroId: context.parceiroId, loteId: lotId }, select: { externalId: true } }),
    ]);

    await this.prisma.eventoAuditoria.create({ data: {
      atorTipo: "PARCEIRO", parceiroId: context.parceiroId, apiKeyId: context.apiKeyId, organizacaoId: organizationId,
      acao: "CONSULTA_RASTREABILIDADE_PUBLICA", entidade: "Lote", entidadeId: lotId,
      resultado: "SUCESSO", requestId,
      detalhes: { tipoReferencia: referenceType },
    } });

    return {
      identificadorPublico: lot.publicId,
      ...(externalId ? { externalId } : partnerReference ? { externalId: partnerReference.externalId } : {}),
      status: lot.statusProcessamento,
      dataEntrada: lot.dataEntrada,
      criadoEm: lot.createdAt,
      atualizadoEm: lot.updatedAt,
      quantidadeEquipamentos: lot.equipamentos.length,
      historicoOperacional: history.map((event) => ({ instante: event.instante, acao: event.acao, resultado: event.resultado })),
      equipamentos: lot.equipamentos.map((equipment) => ({
        tipo: equipment.tipo,
        marca: equipment.marca,
        modelo: equipment.modelo,
        estadoFisico: equipment.estadoFisico,
        statusRastreamento: equipment.statusRastreamento,
        movimentacoes: equipment.movimentacoes.map(({ dataHora, origem, destino }) => ({ dataHora, origem, destino })),
      })),
    };
  }

  private async findSafeLot(tx: Prisma.TransactionClient, lotId: string) {
    const lot = await tx.lote.findUnique({ where: { id: lotId }, select: {
      id: true, publicId: true, statusProcessamento: true, dataEntrada: true, createdAt: true,
      equipamentos: { select: { tipo: true, marca: true, modelo: true, estadoFisico: true, statusRastreamento: true }, orderBy: [{ posicaoNoLote: "asc" }, { id: "asc" }] },
    } });
    if (!lot) throw errors.notFound("LOT_NOT_FOUND", "Lote vinculado à idempotência não foi encontrado.");
    return lot;
  }

  private async recordExternalAudit(tx: Prisma.TransactionClient, context: IntegrationIdentity, organizationId: string, lotId: string, requestId: string, action: string, details: Record<string, string | number | boolean | null>) {
    await tx.eventoAuditoria.create({ data: {
      atorTipo: "PARCEIRO", parceiroId: context.parceiroId, apiKeyId: context.apiKeyId, organizacaoId: organizationId,
      acao: action, entidade: "Lote", entidadeId: lotId, resultado: "SUCESSO", requestId,
      detalhes: details as Prisma.InputJsonObject,
    } });
  }
}
