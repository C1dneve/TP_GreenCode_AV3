import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { errors } from "../../shared/domain-error.js";
import { pageMeta } from "../../shared/pagination.js";
import { generateApiKey } from "../integracoes/api-key-security.js";
import { normalizeScopes } from "../integracoes/scopes.js";

const SAFE_PARTNER_SELECT = {
  id: true, nome: true, descricao: true, ativo: true, escopos: true,
  limiteRequisicoesPorMinuto: true, maxEquipamentosPorSubmissao: true,
  maxPayloadBytes: true, permiteLoteSemEquipamentos: true,
  createdAt: true, updatedAt: true,
} as const;
const SAFE_KEY_SELECT = {
  id: true, parceiroId: true, nome: true, prefixo: true, escopos: true,
  limiteRequisicoesPorMinuto: true, maxEquipamentosPorSubmissao: true,
  maxPayloadBytes: true, expiraEm: true, revogadaEm: true, ultimoUsoEm: true,
  createdAt: true, updatedAt: true,
} as const;

interface Actor { usuarioId: string; requestId: string }

function validatePositiveInt(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw errors.badRequest("VALIDATION_ERROR", `${name} deve ser inteiro entre ${min} e ${max}.`);
  }
  return value as number;
}

function validateOptionalKeyLimit(value: unknown, name: string, partnerValue: number, min: number, max: number): number | null {
  if (value === undefined || value === null) return null;
  const checked = validatePositiveInt(value, name, min, max);
  if (checked > partnerValue) throw errors.badRequest("KEY_LIMIT_CANNOT_EXCEED_PARTNER", `${name} da chave não pode ser maior que o limite do parceiro.`);
  return checked;
}

export class ParceirosService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(input: { page?: number; pageSize?: number; q?: string; ativo?: boolean }) {
    const page = Math.max(1, Math.trunc(input.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(input.pageSize ?? 20)));
    const where: Prisma.ParceiroWhereInput = {
      ...(input.ativo === undefined ? {} : { ativo: input.ativo }),
      ...(input.q?.trim() ? { OR: [
        { nome: { contains: input.q.trim(), mode: "insensitive" } },
        { descricao: { contains: input.q.trim(), mode: "insensitive" } },
      ] } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.parceiro.findMany({ where, select: SAFE_PARTNER_SELECT, orderBy: [{ nome: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.parceiro.count({ where }),
    ]);
    return { data, meta: pageMeta(page, pageSize, total) };
  }

  async get(id: string) {
    const row = await this.prisma.parceiro.findUnique({ where: { id }, select: SAFE_PARTNER_SELECT });
    if (!row) throw errors.notFound("PARTNER_NOT_FOUND", "Parceiro não encontrado.");
    return row;
  }

  async create(input: {
    nome: string; descricao?: string; escopos?: unknown;
    limiteRequisicoesPorMinuto?: number; maxEquipamentosPorSubmissao?: number;
    maxPayloadBytes?: number; permiteLoteSemEquipamentos?: boolean;
  }, actor: Actor) {
    const nome = input.nome.trim();
    if (!nome || nome.length > 160) throw errors.badRequest("VALIDATION_ERROR", "Nome do parceiro é obrigatório e deve ter até 160 caracteres.");
    const descricao = input.descricao?.trim() || null;
    if (descricao && descricao.length > 1000) throw errors.badRequest("VALIDATION_ERROR", "Descrição excede 1000 caracteres.");
    let escopos: string[];
    try { escopos = input.escopos === undefined ? [] : normalizeScopes(input.escopos); }
    catch (error) { throw errors.badRequest("INVALID_SCOPES", error instanceof Error ? error.message : "Escopos inválidos."); }
    const limits = {
      limiteRequisicoesPorMinuto: validatePositiveInt(input.limiteRequisicoesPorMinuto ?? 60, "Limite de requisições por minuto", 1, 10000),
      maxEquipamentosPorSubmissao: validatePositiveInt(input.maxEquipamentosPorSubmissao ?? 100, "Máximo de equipamentos por submissão", 0, 5000),
      maxPayloadBytes: validatePositiveInt(input.maxPayloadBytes ?? 1_048_576, "Payload máximo em bytes", 1024, 10_485_760),
    };
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.parceiro.create({ data: { nome, descricao, escopos, ...limits, permiteLoteSemEquipamentos: input.permiteLoteSemEquipamentos ?? true }, select: SAFE_PARTNER_SELECT });
      await tx.eventoAuditoria.create({ data: {
        atorUsuarioId: actor.usuarioId, atorNomeSnapshot: (await tx.usuario.findUnique({ where: { id: actor.usuarioId }, select: { nome: true } }))?.nome ?? null, atorTipo: "USUARIO", acao: "CRIACAO_PARCEIRO", entidade: "Parceiro", entidadeId: created.id,
        resultado: "SUCESSO", requestId: actor.requestId, detalhes: { nome, escopos, ...limits },
      } });
      return created;
    });
  }

  async update(id: string, input: {
    nome?: string; descricao?: string | null; escopos?: unknown;
    limiteRequisicoesPorMinuto?: number; maxEquipamentosPorSubmissao?: number;
    maxPayloadBytes?: number; permiteLoteSemEquipamentos?: boolean;
  }, actor: Actor) {
    const data: Prisma.ParceiroUpdateInput = {};
    const changed: Record<string, string | number | boolean | null | string[]> = {};
    if (input.nome !== undefined) {
      const value = input.nome.trim();
      if (!value || value.length > 160) throw errors.badRequest("VALIDATION_ERROR", "Nome do parceiro inválido.");
      data.nome = value; changed.nome = value;
    }
    if (input.descricao !== undefined) {
      const value = input.descricao?.trim() || null;
      if (value && value.length > 1000) throw errors.badRequest("VALIDATION_ERROR", "Descrição excede 1000 caracteres.");
      data.descricao = value; changed.descricao = value;
    }
    if (input.escopos !== undefined) {
      try { const value = normalizeScopes(input.escopos); data.escopos = value; changed.escopos = value; }
      catch (error) { throw errors.badRequest("INVALID_SCOPES", error instanceof Error ? error.message : "Escopos inválidos."); }
    }
    if (input.limiteRequisicoesPorMinuto !== undefined) { const value = validatePositiveInt(input.limiteRequisicoesPorMinuto, "Limite de requisições por minuto", 1, 10000); data.limiteRequisicoesPorMinuto = value; changed.limiteRequisicoesPorMinuto = value; }
    if (input.maxEquipamentosPorSubmissao !== undefined) { const value = validatePositiveInt(input.maxEquipamentosPorSubmissao, "Máximo de equipamentos por submissão", 0, 5000); data.maxEquipamentosPorSubmissao = value; changed.maxEquipamentosPorSubmissao = value; }
    if (input.maxPayloadBytes !== undefined) { const value = validatePositiveInt(input.maxPayloadBytes, "Payload máximo em bytes", 1024, 10_485_760); data.maxPayloadBytes = value; changed.maxPayloadBytes = value; }
    if (input.permiteLoteSemEquipamentos !== undefined) { data.permiteLoteSemEquipamentos = input.permiteLoteSemEquipamentos; changed.permiteLoteSemEquipamentos = input.permiteLoteSemEquipamentos; }
    if (!Object.keys(changed).length) throw errors.badRequest("VALIDATION_ERROR", "Informe ao menos um campo para atualização.");
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.parceiro.findUnique({ where: { id }, select: { id: true } });
      if (!current) throw errors.notFound("PARTNER_NOT_FOUND", "Parceiro não encontrado.");
      const updated = await tx.parceiro.update({ where: { id }, data, select: SAFE_PARTNER_SELECT });
      await tx.eventoAuditoria.create({ data: {
        atorUsuarioId: actor.usuarioId, atorNomeSnapshot: (await tx.usuario.findUnique({ where: { id: actor.usuarioId }, select: { nome: true } }))?.nome ?? null, atorTipo: "USUARIO", acao: "ATUALIZACAO_PARCEIRO", entidade: "Parceiro", entidadeId: id,
        resultado: "SUCESSO", requestId: actor.requestId, detalhes: changed as Prisma.InputJsonObject,
      } });
      return updated;
    });
  }

  async changeActive(id: string, active: boolean, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.parceiro.findUnique({ where: { id }, select: { id: true, ativo: true } });
      if (!current) throw errors.notFound("PARTNER_NOT_FOUND", "Parceiro não encontrado.");
      if (current.ativo === active) throw errors.conflict(active ? "PARTNER_ALREADY_ACTIVE" : "PARTNER_ALREADY_INACTIVE", active ? "Parceiro já está ativo." : "Parceiro já está desativado.");
      const updated = await tx.parceiro.update({ where: { id }, data: { ativo: active }, select: SAFE_PARTNER_SELECT });
      await tx.eventoAuditoria.create({ data: {
        atorUsuarioId: actor.usuarioId, atorNomeSnapshot: (await tx.usuario.findUnique({ where: { id: actor.usuarioId }, select: { nome: true } }))?.nome ?? null, atorTipo: "USUARIO", acao: active ? "ATIVACAO_PARCEIRO" : "DESATIVACAO_PARCEIRO", entidade: "Parceiro", entidadeId: id,
        resultado: "SUCESSO", requestId: actor.requestId,
      } });
      return updated;
    });
  }

  async listOrganizations(partnerId: string) {
    await this.ensurePartner(partnerId);
    return this.prisma.parceiroOrganizacao.findMany({ where: { parceiroId: partnerId }, include: {
      organizacao: { select: { id: true, razaoSocial: true, cnpj: true, ativo: true } },
    }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
  }

  async associateOrganization(partnerId: string, organizationId: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const partner = await tx.parceiro.findUnique({ where: { id: partnerId }, select: { id: true } });
      if (!partner) throw errors.notFound("PARTNER_NOT_FOUND", "Parceiro não encontrado.");
      const organization = await tx.organizacao.findUnique({ where: { id: organizationId }, select: { id: true, ativo: true } });
      if (!organization) throw errors.notFound("ORGANIZATION_NOT_FOUND", "Organização não encontrada.");
      if (!organization.ativo) throw errors.conflict("ORGANIZATION_INACTIVE", "Não é possível vincular uma organização desativada.");
      const existing = await tx.parceiroOrganizacao.findUnique({ where: { parceiroId_organizacaoId: { parceiroId: partnerId, organizacaoId: organizationId } } });
      if (existing?.ativo) throw errors.conflict("ASSOCIATION_ALREADY_ACTIVE", "O parceiro já está associado a esta organização.");
      const publicId = `gci_${randomBytes(24).toString("base64url")}`;
      const association = existing
        ? await tx.parceiroOrganizacao.update({ where: { id: existing.id }, data: { ativo: true, revogadoEm: null, identificadorPublico: publicId }, include: { organizacao: { select: { id: true, razaoSocial: true, cnpj: true, ativo: true } } } })
        : await tx.parceiroOrganizacao.create({ data: { parceiroId: partnerId, organizacaoId: organizationId, identificadorPublico: publicId }, include: { organizacao: { select: { id: true, razaoSocial: true, cnpj: true, ativo: true } } } });
      await tx.eventoAuditoria.create({ data: {
        atorUsuarioId: actor.usuarioId, atorNomeSnapshot: (await tx.usuario.findUnique({ where: { id: actor.usuarioId }, select: { nome: true } }))?.nome ?? null, atorTipo: "USUARIO", acao: "ASSOCIACAO_ORGANIZACAO_PARCEIRO", entidade: "ParceiroOrganizacao", entidadeId: association.id,
        resultado: "SUCESSO", requestId: actor.requestId, parceiroId: partnerId, organizacaoId: organizationId,
        detalhes: { organizacaoId: organizationId, identificadorPublico: association.identificadorPublico },
      } });
      return association;
    });
  }

  async revokeOrganization(partnerId: string, associationId: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.parceiroOrganizacao.findFirst({ where: { id: associationId, parceiroId: partnerId } });
      if (!current) throw errors.notFound("PARTNER_ORGANIZATION_NOT_FOUND", "Associação não encontrada.");
      if (!current.ativo) throw errors.conflict("ASSOCIATION_ALREADY_REVOKED", "Associação já está revogada.");
      const updated = await tx.parceiroOrganizacao.update({ where: { id: associationId }, data: { ativo: false, revogadoEm: new Date() }, include: { organizacao: { select: { id: true, razaoSocial: true, cnpj: true, ativo: true } } } });
      await tx.eventoAuditoria.create({ data: {
        atorUsuarioId: actor.usuarioId, atorNomeSnapshot: (await tx.usuario.findUnique({ where: { id: actor.usuarioId }, select: { nome: true } }))?.nome ?? null, atorTipo: "USUARIO", acao: "REVOGACAO_ORGANIZACAO_PARCEIRO", entidade: "ParceiroOrganizacao", entidadeId: associationId,
        resultado: "SUCESSO", requestId: actor.requestId, parceiroId: partnerId, organizacaoId: current.organizacaoId,
      } });
      return updated;
    });
  }

  async listKeys(partnerId: string) {
    await this.ensurePartner(partnerId);
    return this.prisma.apiKey.findMany({ where: { parceiroId: partnerId }, select: SAFE_KEY_SELECT, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
  }

  async createKey(partnerId: string, input: {
    nome: string; escopos: unknown; expiraEm?: string;
    limiteRequisicoesPorMinuto?: number; maxEquipamentosPorSubmissao?: number; maxPayloadBytes?: number;
  }, actor: Actor) {
    const nome = input.nome.trim();
    if (!nome || nome.length > 120) throw errors.badRequest("VALIDATION_ERROR", "Nome da API Key é obrigatório e deve ter até 120 caracteres.");
    let escopos: string[];
    try { escopos = normalizeScopes(input.escopos ?? []); }
    catch (error) { throw errors.badRequest("INVALID_SCOPES", error instanceof Error ? error.message : "Escopos inválidos."); }
    const expiraEm = input.expiraEm ? new Date(input.expiraEm) : null;
    if (expiraEm && (!Number.isFinite(expiraEm.getTime()) || expiraEm <= new Date())) throw errors.badRequest("INVALID_EXPIRATION", "A validade da chave deve ser uma data futura válida.");

    return this.prisma.$transaction(async (tx) => {
      const partner = await tx.parceiro.findUnique({ where: { id: partnerId }, select: {
        id: true, limiteRequisicoesPorMinuto: true, maxEquipamentosPorSubmissao: true, maxPayloadBytes: true,
      } });
      if (!partner) throw errors.notFound("PARTNER_NOT_FOUND", "Parceiro não encontrado.");
      const limits = {
        limiteRequisicoesPorMinuto: validateOptionalKeyLimit(input.limiteRequisicoesPorMinuto, "Limite por minuto", partner.limiteRequisicoesPorMinuto, 1, 10000),
        maxEquipamentosPorSubmissao: validateOptionalKeyLimit(input.maxEquipamentosPorSubmissao, "Máximo de equipamentos", partner.maxEquipamentosPorSubmissao, 0, 5000),
        maxPayloadBytes: validateOptionalKeyLimit(input.maxPayloadBytes, "Payload máximo", partner.maxPayloadBytes, 1024, 10_485_760),
      };
      const generated = generateApiKey();
      const created = await tx.apiKey.create({ data: {
        parceiroId: partnerId, nome, prefixo: generated.prefixo, segredoHash: generated.segredoHash,
        escopos, expiraEm, ...limits,
      }, select: SAFE_KEY_SELECT });
      await tx.eventoAuditoria.create({ data: {
        atorUsuarioId: actor.usuarioId, atorNomeSnapshot: (await tx.usuario.findUnique({ where: { id: actor.usuarioId }, select: { nome: true } }))?.nome ?? null, atorTipo: "USUARIO", acao: "CRIACAO_API_KEY", entidade: "ApiKey", entidadeId: created.id,
        resultado: "SUCESSO", requestId: actor.requestId, parceiroId: partnerId,
        detalhes: { nome, prefixo: generated.prefixo, escopos, expiraEm: expiraEm?.toISOString() ?? null, ...limits },
      } });
      return { apiKey: created, segredo: generated.valorCompleto };
    });
  }

  async getKey(partnerId: string, keyId: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id: keyId, parceiroId: partnerId }, select: SAFE_KEY_SELECT });
    if (!key) throw errors.notFound("API_KEY_NOT_FOUND", "API Key não encontrada.");
    return key;
  }

  async updateKey(partnerId: string, keyId: string, input: {
    nome?: string; escopos?: unknown; expiraEm?: string | null;
    limiteRequisicoesPorMinuto?: number | null; maxEquipamentosPorSubmissao?: number | null; maxPayloadBytes?: number | null;
  }, actor: Actor) {
    const data: Prisma.ApiKeyUpdateInput = {};
    const changed: Record<string, string | number | null | string[]> = {};
    if (input.nome !== undefined) {
      const value = input.nome.trim();
      if (!value || value.length > 120) throw errors.badRequest("VALIDATION_ERROR", "Nome da API Key é obrigatório e deve ter até 120 caracteres.");
      data.nome = value; changed.nome = value;
    }
    if (input.escopos !== undefined) {
      try { const value = normalizeScopes(input.escopos); data.escopos = value; changed.escopos = value; }
      catch (error) { throw errors.badRequest("INVALID_SCOPES", error instanceof Error ? error.message : "Escopos inválidos."); }
    }
    if (input.expiraEm !== undefined) {
      const expiry = input.expiraEm === null ? null : new Date(input.expiraEm);
      if (expiry && (!Number.isFinite(expiry.getTime()) || expiry <= new Date())) throw errors.badRequest("INVALID_EXPIRATION", "A validade da chave deve ser uma data futura válida ou nula.");
      data.expiraEm = expiry; changed.expiraEm = expiry?.toISOString() ?? null;
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.apiKey.findFirst({ where: { id: keyId, parceiroId: partnerId }, select: { id: true, revogadaEm: true } });
      if (!current) throw errors.notFound("API_KEY_NOT_FOUND", "API Key não encontrada.");
      if (current.revogadaEm) throw errors.conflict("API_KEY_REVOKED", "Não é possível alterar uma API Key revogada.");
      const partner = await tx.parceiro.findUnique({ where: { id: partnerId }, select: {
        id: true, limiteRequisicoesPorMinuto: true, maxEquipamentosPorSubmissao: true, maxPayloadBytes: true,
      } });
      if (!partner) throw errors.notFound("PARTNER_NOT_FOUND", "Parceiro não encontrado.");
      const limits = {
        limiteRequisicoesPorMinuto: input.limiteRequisicoesPorMinuto === undefined ? undefined : validateOptionalKeyLimit(input.limiteRequisicoesPorMinuto, "Limite por minuto", partner.limiteRequisicoesPorMinuto, 1, 10000),
        maxEquipamentosPorSubmissao: input.maxEquipamentosPorSubmissao === undefined ? undefined : validateOptionalKeyLimit(input.maxEquipamentosPorSubmissao, "Máximo de equipamentos", partner.maxEquipamentosPorSubmissao, 0, 5000),
        maxPayloadBytes: input.maxPayloadBytes === undefined ? undefined : validateOptionalKeyLimit(input.maxPayloadBytes, "Payload máximo", partner.maxPayloadBytes, 1024, 10_485_760),
      };
      for (const [key, value] of Object.entries(limits)) if (value !== undefined) changed[key] = value;
      Object.assign(data, limits);
      if (!Object.keys(changed).length) throw errors.badRequest("VALIDATION_ERROR", "Informe ao menos um campo para atualização.");
      const updated = await tx.apiKey.update({ where: { id: keyId }, data, select: SAFE_KEY_SELECT });
      await tx.eventoAuditoria.create({ data: {
        atorUsuarioId: actor.usuarioId, atorNomeSnapshot: (await tx.usuario.findUnique({ where: { id: actor.usuarioId }, select: { nome: true } }))?.nome ?? null, atorTipo: "USUARIO", acao: "ATUALIZACAO_API_KEY", entidade: "ApiKey", entidadeId: keyId,
        resultado: "SUCESSO", requestId: actor.requestId, parceiroId: partnerId,
        detalhes: changed as Prisma.InputJsonObject,
      } });
      return updated;
    });
  }

  async revokeKey(partnerId: string, keyId: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.apiKey.findFirst({ where: { id: keyId, parceiroId: partnerId }, select: { id: true, revogadaEm: true } });
      if (!current) throw errors.notFound("API_KEY_NOT_FOUND", "API Key não encontrada.");
      if (current.revogadaEm) throw errors.conflict("API_KEY_ALREADY_REVOKED", "API Key já está revogada.");
      const updated = await tx.apiKey.update({ where: { id: keyId }, data: { revogadaEm: new Date() }, select: SAFE_KEY_SELECT });
      await tx.eventoAuditoria.create({ data: {
        atorUsuarioId: actor.usuarioId, atorNomeSnapshot: (await tx.usuario.findUnique({ where: { id: actor.usuarioId }, select: { nome: true } }))?.nome ?? null, atorTipo: "USUARIO", acao: "REVOGACAO_API_KEY", entidade: "ApiKey", entidadeId: keyId,
        resultado: "SUCESSO", requestId: actor.requestId, parceiroId: partnerId, detalhes: { prefixo: updated.prefixo },
      } });
      return updated;
    });
  }

  private async ensurePartner(id: string) {
    const partner = await this.prisma.parceiro.findUnique({ where: { id }, select: { id: true } });
    if (!partner) throw errors.notFound("PARTNER_NOT_FOUND", "Parceiro não encontrado.");
    return partner;
  }
}
