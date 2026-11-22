import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { DomainError, errors } from "../../shared/domain-error.js";
import type { IntegrationIdentity } from "../api-publica/integration-auth.js";
import { AnalyticsRepository } from "../analytics/analytics.repository.js";
import { ProfitabilityService } from "../analytics/profitability.service.js";
import { UsefulLifeService } from "../analytics/useful-life.service.js";
import { OperationalEfficiencyService } from "../analytics/operational-efficiency.service.js";
import { RelatoriosAsyncRepository } from "./relatorios-async.repository.js";
import { sanitizePublicReportPayload, serializeReport } from "./report-format.js";

const ALLOWED_TYPES = new Set(["operacional", "equipamentos", "triagem", "rentabilidade", "vida-util"]);
const EXPIRATION_DAYS = Math.max(1, Math.min(30, Number(process.env.REPORT_EXPIRATION_DAYS ?? 7)) || 7);
const STORAGE_ROOT = resolve(process.env.REPORTS_DIR?.trim() || "./storage/reports");
const REPORT_ROW_LIMIT = 20_000;

/**
 * JSON não representa bigint. Valores de tamanho são convertidos somente quando
 * cabem com precisão inteira segura em Number; fora desse intervalo a resposta
 * falha de forma explícita em vez de arredondar silenciosamente.
 */
function serializeReportByteSize(value: bigint | null): number | null {
  if (value === null) return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || BigInt(numeric) !== value) {
    throw new RangeError("O tamanho persistido do relatório excede o intervalo inteiro seguro para JSON.");
  }
  return numeric;
}

function serializeReportStatus<T extends {
  status: string;
  expiraEm: Date;
  arquivoPath: string | null;
  tamanhoBytes: bigint | null;
}>(report: T) {
  const { arquivoPath, tamanhoBytes, ...publicFields } = report;
  return {
    ...publicFields,
    tamanhoBytes: serializeReportByteSize(tamanhoBytes),
    downloadDisponivel: report.status === "COMPLETED" && report.expiraEm > new Date() && Boolean(arquivoPath),
  };
}

function validateRequest(input: any, organizationIdOverride?: string) {
  if (!input || !ALLOWED_TYPES.has(input.tipo)) throw errors.badRequest("INVALID_REPORT_TYPE", "Tipo de relatório inválido.");
  if (!(["CSV", "JSON"].includes(input.formato))) throw errors.badRequest("INVALID_REPORT_FORMAT", "Formato deve ser CSV ou JSON.");
  const organizacaoId = organizationIdOverride ?? input.organizacaoId;
  if (typeof organizacaoId !== "string" || !/^[0-9a-f-]{36}$/i.test(organizacaoId)) throw errors.badRequest("VALIDATION_ERROR", "Organização inválida.");
  const filters: any = {};
  if (input.de !== undefined) { const date = new Date(input.de); if (!Number.isFinite(date.getTime())) throw errors.badRequest("VALIDATION_ERROR", "Data inicial inválida."); filters.de = date.toISOString(); }
  if (input.ate !== undefined) { const date = new Date(input.ate); if (!Number.isFinite(date.getTime())) throw errors.badRequest("VALIDATION_ERROR", "Data final inválida."); filters.ate = date.toISOString(); }
  if (filters.de && filters.ate && filters.de > filters.ate) throw errors.badRequest("VALIDATION_ERROR", "de não pode ser posterior a ate.");
  filters.organizacaoId = organizacaoId;
  return { tipo: input.tipo as string, formato: input.formato as string, organizacaoId: organizacaoId as string, filtros: filters };
}


export class RelatoriosAsyncService {
  constructor(private readonly repository: RelatoriosAsyncRepository) {}
  private get db() { return this.repository.db(); }

  async requestInternal(input: any, actorId: string, requestId: string) {
    const data = validateRequest(input);
    return this.createRequest(data, { solicitanteUsuarioId: actorId, requestId });
  }

  async requestPublic(input: any, identity: IntegrationIdentity, requestId: string, identificadorPublico: string) {
    if (!identity.escoposEfetivos.includes("reports:write")) throw errors.forbidden("A API Key não possui o escopo reports:write.");
    if (!identificadorPublico?.trim()) throw errors.badRequest("MISSING_INTEGRATION_HEADER", "Informe X-Integration-ID.");
    const association = await this.db.parceiroOrganizacao.findFirst({
      where: {
        parceiroId: identity.parceiroId, identificadorPublico: identificadorPublico.trim(), ativo: true,
        parceiro: { ativo: true }, organizacao: { ativo: true },
      },
      select: { organizacaoId: true },
    });
    if (!association) throw errors.notFound("INTEGRATION_NOT_FOUND", "Integração não encontrada.");
    const data = validateRequest(input, association.organizacaoId);
    return this.createRequest(data, { parceiroId: identity.parceiroId, apiKeyId: identity.apiKeyId, requestId });
  }

  private async createRequest(data: ReturnType<typeof validateRequest>, actor: { solicitanteUsuarioId?: string; parceiroId?: string; apiKeyId?: string; requestId: string }) {
    const id = randomUUID(); const jobId = `greencode-report-${id}`; const now = new Date(); const expiraEm = new Date(now.getTime() + EXPIRATION_DAYS * 86400000);
    const result = await this.db.$transaction(async (tx: any) => {
      const organization = await tx.organizacao.findFirst({ where: { id: data.organizacaoId, ativo: true }, select: { id: true } });
      if (!organization) throw errors.notFound("ORGANIZATION_NOT_FOUND", "Organização não encontrada ou inativa.");
      if (actor.parceiroId) {
        const association = await tx.parceiroOrganizacao.findFirst({ where: { parceiroId: actor.parceiroId, organizacaoId: data.organizacaoId, ativo: true, parceiro: { ativo: true }, organizacao: { ativo: true } }, select: { id: true } });
        if (!association) throw errors.forbidden("O parceiro não possui vínculo ativo com a organização solicitada.");
      }
      // Serializável: duas solicitações concorrentes não ultrapassam o teto por organização.
      const pending = await tx.relatorioAssincrono.count({ where: { organizacaoId: data.organizacaoId, status: { in: ["PENDING", "PROCESSING"] } } });
      if (pending >= 20) throw errors.conflict("REPORT_QUEUE_LIMIT", "A organização atingiu o limite de 20 relatórios pendentes.");
      const report = await tx.relatorioAssincrono.create({ data: { id, tipo: data.tipo, formato: data.formato, status: "PENDING", solicitanteUsuarioId: actor.solicitanteUsuarioId, parceiroId: actor.parceiroId, apiKeyId: actor.apiKeyId, organizacaoId: data.organizacaoId, filtros: data.filtros, jobId, requestId: actor.requestId, expiraEm } });
      await tx.outboxEvento.create({ data: { agregado: "RELATORIO", agregadoId: id, evento: "GERAR_RELATORIO", payload: { reportId: id, jobId } } });
      await tx.eventoAuditoria.create({ data: { atorUsuarioId: actor.solicitanteUsuarioId, atorTipo: actor.parceiroId ? "PARCEIRO" : "USUARIO", parceiroId: actor.parceiroId, apiKeyId: actor.apiKeyId, organizacaoId: data.organizacaoId, acao: "SOLICITACAO_RELATORIO", entidade: "RelatorioAssincrono", entidadeId: id, resultado: "SUCESSO", requestId: actor.requestId, detalhes: { tipo: data.tipo, formato: data.formato } } });
      return report;
    }, { isolationLevel: "Serializable" });
    return { id: result.id, tipo: result.tipo, formato: result.formato, status: result.status, criadoEm: result.criadoEm, expiraEm: result.expiraEm, mensagem: "Relatório recebido para processamento assíncrono." };
  }

  async listInternal(query: any) {
    const page = Math.max(1, Math.min(10000, Number(query.page) || 1)); const pageSize = Math.max(1, Math.min(100, Number(query.pageSize) || 20));
    const where: any = { ...(query.organizacaoId ? { organizacaoId: query.organizacaoId } : {}), ...(query.status ? { status: query.status } : {}) };
    const [data, total] = await Promise.all([this.db.relatorioAssincrono.findMany({ where, orderBy: { criadoEm: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, tipo: true, formato: true, status: true, progresso: true, organizacaoId: true, criadoEm: true, iniciadoEm: true, concluidoEm: true, expiraEm: true, mensagemErro: true } }), this.db.relatorioAssincrono.count({ where })]);
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async listPublic(identity: IntegrationIdentity, query: any) {
    if (!identity.escoposEfetivos.includes("reports:read")) throw errors.forbidden("A API Key não possui o escopo reports:read.");
    const page = Math.max(1, Math.min(10000, Number(query.page) || 1)); const pageSize = Math.max(1, Math.min(100, Number(query.pageSize) || 20));
    const where = { parceiroId: identity.parceiroId, organizacao: { ativo: true, parceiros: { some: { parceiroId: identity.parceiroId, ativo: true } } }, ...(query.status ? { status: query.status } : {}) };
    const [data, total] = await Promise.all([this.db.relatorioAssincrono.findMany({ where, orderBy: { criadoEm: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, tipo: true, formato: true, status: true, progresso: true, criadoEm: true, iniciadoEm: true, concluidoEm: true, expiraEm: true, mensagemErro: true } }), this.db.relatorioAssincrono.count({ where })]);
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async getInternal(id: string) {
    const report = await this.db.relatorioAssincrono.findUnique({ where: { id }, select: { id: true, tipo: true, formato: true, status: true, solicitanteUsuarioId: true, parceiroId: true, organizacaoId: true, criadoEm: true, iniciadoEm: true, concluidoEm: true, progresso: true, mensagemErro: true, arquivoPath: true, expiraEm: true, tamanhoBytes: true } });
    if (!report) throw errors.notFound("REPORT_NOT_FOUND", "Relatório não encontrado.");
    return serializeReportStatus(report);
  }

  async getPublic(id: string, identity: IntegrationIdentity) {
    if (!identity.escoposEfetivos.includes("reports:read")) throw errors.forbidden("A API Key não possui o escopo reports:read.");
    const report = await this.db.relatorioAssincrono.findFirst({ where: { id, parceiroId: identity.parceiroId, organizacao: { ativo: true, parceiros: { some: { parceiroId: identity.parceiroId, ativo: true } } } }, select: { id: true, tipo: true, formato: true, status: true, criadoEm: true, iniciadoEm: true, concluidoEm: true, progresso: true, mensagemErro: true, arquivoPath: true, expiraEm: true, tamanhoBytes: true } });
    if (!report) throw errors.notFound("REPORT_NOT_FOUND", "Relatório não encontrado.");
    return serializeReportStatus(report);
  }

  async download(id: string, actor: { usuarioId?: string; parceiroId?: string; apiKeyId?: string; escoposEfetivos?: string[] }, requestId: string) {
    if (actor.parceiroId && !actor.escoposEfetivos?.includes("reports:read")) throw errors.forbidden("A API Key não possui o escopo reports:read.");
    const report = await this.db.relatorioAssincrono.findUnique({ where: { id } });
    if (!report || (actor.parceiroId ? report.parceiroId !== actor.parceiroId : !actor.usuarioId)) throw errors.notFound("REPORT_NOT_FOUND", "Relatório não encontrado.");
    if (actor.parceiroId) { const association = await this.db.parceiroOrganizacao.findFirst({ where: { parceiroId: actor.parceiroId, organizacaoId: report.organizacaoId, ativo: true, organizacao: { ativo: true } }, select: { id: true } }); if (!association) throw errors.notFound("REPORT_NOT_FOUND", "Relatório não encontrado."); }
    if (report.expiraEm <= new Date()) { await this.db.relatorioAssincrono.update({ where: { id }, data: { status: "EXPIRED" } }); throw new DomainError(410, "REPORT_EXPIRED", "O arquivo do relatório expirou."); }
    if (report.status !== "COMPLETED" || !report.arquivoPath || !report.arquivoSha256) throw errors.conflict("REPORT_NOT_READY", "O relatório ainda não está disponível para download.");
    const path = this.resolveStoredPath(report.arquivoPath);
    let bytes: Buffer;
    try { bytes = await readFile(path); }
    catch { throw new DomainError(410, "REPORT_FILE_MISSING", "O arquivo não está mais disponível no armazenamento."); }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== report.arquivoSha256) throw errors.conflict("REPORT_INTEGRITY_ERROR", "A integridade do arquivo do relatório não pôde ser confirmada.");
    await this.db.eventoAuditoria.create({ data: { atorTipo: actor.parceiroId ? "PARCEIRO" : "USUARIO", parceiroId: actor.parceiroId, apiKeyId: actor.apiKeyId, organizacaoId: report.organizacaoId, acao: "DOWNLOAD_RELATORIO", entidade: "RelatorioAssincrono", entidadeId: id, resultado: "SUCESSO", requestId, detalhes: { formato: report.formato, tamanhoBytes: bytes.length } } });
    return { stream: createReadStream(path), filename: `greencode-relatorio-${id}.${String(report.formato).toLowerCase()}`, contentType: report.formato === "CSV" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8", size: bytes.length };
  }

  private resolveStoredPath(file: string) {
    const candidate = resolve(STORAGE_ROOT, file);
    const rel = relative(STORAGE_ROOT, candidate);
    if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw errors.conflict("REPORT_PATH_INVALID", "Referência interna de arquivo inválida.");
    return candidate;
  }

  async process(reportId: string) {
    const report = await this.db.relatorioAssincrono.findUnique({ where: { id: reportId } });
    if (!report || report.status === "COMPLETED" || report.status === "EXPIRED") return;
    if (report.expiraEm <= new Date()) {
      await this.db.relatorioAssincrono.updateMany({ where: { id: reportId, status: { not: "COMPLETED" } }, data: { status: "EXPIRED", heartbeatEm: null, leaseToken: null, mensagemErro: "Prazo de validade expirado antes do processamento." } });
      return;
    }
    // Token de lease impede um worker antigo de sobrescrever o resultado de um worker que retomou a tarefa.
    const leaseToken = randomUUID();
    const now = new Date();
    const staleBefore = new Date(now.getTime() - 90_000);
    const claimed = await this.db.relatorioAssincrono.updateMany({
      where: { id: reportId, OR: [
        { status: { in: ["PENDING", "FAILED"] } },
        { status: "PROCESSING", OR: [{ heartbeatEm: null }, { heartbeatEm: { lt: staleBefore } }] },
      ] },
      data: { status: "PROCESSING", iniciadoEm: report.iniciadoEm ?? now, heartbeatEm: now, leaseToken, progresso: 10, mensagemErro: null },
    });
    if (!claimed.count) return;
    const heartbeat = setInterval(() => {
      void this.db.relatorioAssincrono.updateMany({ where: { id: reportId, status: "PROCESSING", leaseToken }, data: { heartbeatEm: new Date() } }).catch(() => undefined);
    }, 20_000);
    let tempPath: string | null = null;
    let targetPath: string | null = null;
    try {
      let payload: unknown;
      const filters = report.filtros as any;
      const analyticsRepository = new AnalyticsRepository(this.db);
      const analyticsFilters = { organizacaoId: report.organizacaoId, de: filters.de ? new Date(filters.de) : undefined, ate: filters.ate ? new Date(filters.ate) : undefined, incluirDemonstracao: false };
      if (report.tipo === "operacional") payload = await new OperationalEfficiencyService(analyticsRepository).execute(analyticsFilters);
      else if (report.tipo === "rentabilidade") payload = await new ProfitabilityService(analyticsRepository).execute(analyticsFilters);
      else if (report.tipo === "vida-util") payload = await new UsefulLifeService(analyticsRepository).execute(analyticsFilters);
      else if (report.tipo === "triagem") payload = await this.db.historicoTriagem.findMany({ where: { demonstracao: false, lote: { organizacaoId: report.organizacaoId }, ...(filters.de || filters.ate ? { ocorridoEm: { ...(filters.de ? { gte: new Date(filters.de) } : {}), ...(filters.ate ? { lte: new Date(filters.ate) } : {}) } } : {}) }, include: { responsavel: { select: { nome: true } }, lote: { select: { id: true } } }, orderBy: { ocorridoEm: "asc" }, take: REPORT_ROW_LIMIT + 1 });
      else if (report.tipo === "equipamentos") payload = await this.db.equipamento.findMany({ where: { lote: { organizacaoId: report.organizacaoId }, ativo: true, demonstracao: false, ...(filters.de || filters.ate ? { createdAt: { ...(filters.de ? { gte: new Date(filters.de) } : {}), ...(filters.ate ? { lte: new Date(filters.ate) } : {}) } } : {}) }, select: { id: true, codigoBarrasInterno: true, tipo: true, marca: true, modelo: true, anoFabricacao: true, estadoFisico: true, pesoQuilogramas: true, statusRastreamento: true, valorAquisicao: true, createdAt: true }, take: REPORT_ROW_LIMIT + 1 });
      else payload = await this.db.lote.findMany({ where: { organizacaoId: report.organizacaoId, demonstracao: false, ...(filters.de || filters.ate ? { dataEntrada: { ...(filters.de ? { gte: new Date(filters.de) } : {}), ...(filters.ate ? { lte: new Date(filters.ate) } : {}) } } : {}) }, include: { _count: { select: { equipamentos: true } } }, orderBy: { dataEntrada: "desc" }, take: REPORT_ROW_LIMIT + 1 });
      if (Array.isArray(payload) && payload.length > REPORT_ROW_LIMIT) {
        throw errors.badRequest("REPORT_DATASET_TOO_LARGE", `O relatório excedeu ${REPORT_ROW_LIMIT} registros. Refine o período ou os filtros; nenhum arquivo parcial foi gerado.`);
      }
      const stillOwner = await this.db.relatorioAssincrono.count({ where: { id: reportId, status: "PROCESSING", leaseToken } });
      if (!stillOwner) return;
      await this.db.relatorioAssincrono.updateMany({ where: { id: reportId, status: "PROCESSING", leaseToken }, data: { progresso: 70 } });
      await mkdir(STORAGE_ROOT, { recursive: true });
      const extension = String(report.formato).toLowerCase(); const name = `${reportId}-${leaseToken}.${extension}`;
      targetPath = join(STORAGE_ROOT, name); tempPath = join(STORAGE_ROOT, `.${reportId}-${leaseToken}.tmp`);
      if (report.parceiroId) payload = sanitizePublicReportPayload(report.tipo, payload);
      const content = serializeReport(payload, report.formato as "CSV" | "JSON");
      await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
      await rename(tempPath, targetPath); tempPath = null;
      const info = await stat(targetPath); const digest = createHash("sha256").update(await readFile(targetPath)).digest("hex");
      const completed = await this.db.relatorioAssincrono.updateMany({ where: { id: reportId, status: "PROCESSING", leaseToken }, data: { status: "COMPLETED", progresso: 100, concluidoEm: new Date(), heartbeatEm: null, leaseToken: null, arquivoPath: name, arquivoSha256: digest, tamanhoBytes: BigInt(info.size) } });
      if (completed.count !== 1) { await rm(targetPath, { force: true }); targetPath = null; }
    } catch (error) {
      await this.db.relatorioAssincrono.updateMany({ where: { id: reportId, status: "PROCESSING", leaseToken }, data: { status: "FAILED", concluidoEm: new Date(), heartbeatEm: null, leaseToken: null, progresso: 0, mensagemErro: "Falha ao gerar o arquivo. A tarefa poderá ser reprocessada." } });
      if (tempPath) await rm(tempPath, { force: true }).catch(() => undefined);
      if (targetPath) await rm(targetPath, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  async reprocess(id: string, actorId: string, requestId: string) {
    const result = await this.db.$transaction(async (tx: any) => {
      const report = await tx.relatorioAssincrono.findUnique({ where: { id } });
      if (!report) throw errors.notFound("REPORT_NOT_FOUND", "Relatório não encontrado.");
      if (report.status !== "FAILED" || report.expiraEm <= new Date()) throw errors.conflict("REPORT_NOT_REPROCESSABLE", "Somente relatórios com falha e dentro do prazo podem ser reprocessados.");
      const changed = await tx.relatorioAssincrono.updateMany({ where: { id, status: "FAILED" }, data: { status: "PENDING", progresso: 0, iniciadoEm: null, heartbeatEm: null, leaseToken: null, concluidoEm: null, mensagemErro: null, arquivoPath: null, arquivoSha256: null, tamanhoBytes: null, requestId } });
      if (changed.count !== 1) throw errors.conflict("REPORT_STATE_CHANGED", "O relatório foi alterado por outra operação.");
      await tx.outboxEvento.create({ data: { agregado: "RELATORIO", agregadoId: id, evento: "REPROCESSAR_RELATORIO", payload: { reportId: id, jobId: `${report.jobId}-retry-${randomUUID()}` } } });
      await tx.eventoAuditoria.create({ data: { atorUsuarioId: actorId, atorTipo: "USUARIO", organizacaoId: report.organizacaoId, acao: "REPROCESSAMENTO_RELATORIO", entidade: "RelatorioAssincrono", entidadeId: id, resultado: "SUCESSO", requestId } });
      return tx.relatorioAssincrono.findUnique({ where: { id }, select: { id: true, tipo: true, formato: true, status: true, criadoEm: true, expiraEm: true } });
    });
    return { ...result, mensagem: "Relatório reenfileirado para processamento." };
  }

  async cleanupExpired() {
    const expired = await this.db.relatorioAssincrono.findMany({ where: { expiraEm: { lte: new Date() }, arquivoPath: { not: null } }, select: { id: true, arquivoPath: true }, take: 500 });
    for (const item of expired) {
      try {
        await rm(this.resolveStoredPath(item.arquivoPath), { force: true });
        await this.db.relatorioAssincrono.update({ where: { id: item.id }, data: { status: "EXPIRED", arquivoPath: null } });
      } catch {
        // Mantém a referência no banco para que a próxima execução tente remover o arquivo novamente.
      }
    }
    await this.db.relatorioAssincrono.updateMany({ where: { expiraEm: { lte: new Date() }, status: { not: "EXPIRED" }, arquivoPath: null }, data: { status: "EXPIRED" } });
    return expired.length;
  }
}
