import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RelatoriosAsyncController } from "./relatorios-async.controller.js";
import { DomainError, errors } from "../../shared/domain-error.js";

const uuid = { type: "string", format: "uuid", examples: ["b2a4ce10-70d8-4f17-8c93-bf16f229f6e1"] } as const;
const reportTypes = ["operacional", "equipamentos", "triagem", "rentabilidade", "vida-util"] as const;
const reportStatuses = ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "EXPIRED"] as const;
const reportBody = {
  type: "object", additionalProperties: false, required: ["tipo", "formato", "organizacaoId"],
  properties: {
    tipo: { type: "string", enum: [...reportTypes], description: "Conjunto de dados exportado.", examples: ["operacional"] },
    formato: { type: "string", enum: ["CSV", "JSON"], description: "Formato do arquivo gerado.", examples: ["CSV"] },
    organizacaoId: uuid,
    de: { type: "string", format: "date-time", description: "Início inclusivo do filtro temporal.", examples: ["2026-11-01T00:00:00.000Z"] },
    ate: { type: "string", format: "date-time", description: "Fim inclusivo do filtro temporal; não pode preceder de.", examples: ["2026-11-21T23:59:59.999Z"] },
  },
  examples: [{ tipo: "operacional", formato: "CSV", organizacaoId: "b2a4ce10-70d8-4f17-8c93-bf16f229f6e1", de: "2026-11-01T00:00:00.000Z", ate: "2026-11-21T23:59:59.999Z" }],
} as const;
const publicBody = {
  type: "object", additionalProperties: false, required: ["tipo", "formato"],
  properties: {
    tipo: { type: "string", enum: [...reportTypes], examples: ["operacional"] },
    formato: { type: "string", enum: ["CSV", "JSON"], examples: ["CSV"] },
    de: { type: "string", format: "date-time", examples: ["2026-11-01T00:00:00.000Z"] },
    ate: { type: "string", format: "date-time", examples: ["2026-11-21T23:59:59.999Z"] },
  },
  examples: [{ tipo: "operacional", formato: "CSV", de: "2026-11-01T00:00:00.000Z", ate: "2026-11-21T23:59:59.999Z" }],
} as const;
const query = {
  type: "object", additionalProperties: false,
  properties: {
    organizacaoId: { ...uuid, description: "Filtro interno de organização; não é aceito na API pública." },
    status: { type: "string", enum: [...reportStatuses], examples: ["COMPLETED"] },
    page: { type: "integer", minimum: 1, default: 1, examples: [1] },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20, examples: [20] },
  },
  examples: [{ status: "COMPLETED", page: 1, pageSize: 20 }],
} as const;
const publicQuery = {
  type: "object", additionalProperties: false,
  properties: {
    status: { type: "string", enum: [...reportStatuses], examples: ["COMPLETED"] },
    page: { type: "integer", minimum: 1, default: 1, examples: [1] },
    pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20, examples: [20] },
  },
  examples: [{ status: "COMPLETED", page: 1, pageSize: 20 }],
} as const;
const internalReportExample = {
  id: "a81c6f14-9d42-4b79-8f12-4db60d4a67aa", tipo: "operacional", formato: "CSV", status: "PENDING",
  solicitanteUsuarioId: "51e2b7a1-5e9c-4e68-b1d9-1ebf6a8e1a02", parceiroId: null,
  organizacaoId: "b2a4ce10-70d8-4f17-8c93-bf16f229f6e1", criadoEm: "2026-11-21T12:00:00.000Z",
  iniciadoEm: null, concluidoEm: null, progresso: 0, mensagemErro: null,
  downloadDisponivel: false, expiraEm: "2026-11-28T12:00:00.000Z", tamanhoBytes: null,
};
const publicReportExample = {
  id: "a81c6f14-9d42-4b79-8f12-4db60d4a67aa", tipo: "operacional", formato: "CSV", status: "PENDING",
  criadoEm: "2026-11-21T12:00:00.000Z", iniciadoEm: null, concluidoEm: null, progresso: 0,
  mensagemErro: null, downloadDisponivel: false, expiraEm: "2026-11-28T12:00:00.000Z", tamanhoBytes: null,
};
const reportStatusCommonProperties = {
  id: uuid,
  tipo: { type: "string", enum: [...reportTypes] },
  formato: { type: "string", enum: ["CSV", "JSON"] },
  status: { type: "string", enum: [...reportStatuses] },
  criadoEm: { type: "string", format: "date-time" },
  iniciadoEm: { type: ["string", "null"], format: "date-time" },
  concluidoEm: { type: ["string", "null"], format: "date-time" },
  progresso: { type: "integer", minimum: 0, maximum: 100 },
  mensagemErro: { type: ["string", "null"] },
  downloadDisponivel: { type: "boolean" },
  expiraEm: { type: "string", format: "date-time" },
  tamanhoBytes: {
    anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
    description: "Tamanho do arquivo em bytes; inteiro JSON não negativo ou null enquanto não houver arquivo.",
    examples: [1234, null],
  },
} as const;
const internalReportStatusResponse = {
  type: "object", additionalProperties: false,
  required: ["id", "tipo", "formato", "status", "solicitanteUsuarioId", "parceiroId", "organizacaoId", "criadoEm", "iniciadoEm", "concluidoEm", "progresso", "mensagemErro", "downloadDisponivel", "expiraEm", "tamanhoBytes"],
  properties: {
    ...reportStatusCommonProperties,
    solicitanteUsuarioId: { type: ["string", "null"], format: "uuid" },
    parceiroId: { type: ["string", "null"], format: "uuid" },
    organizacaoId: uuid,
  },
  examples: [{ ...internalReportExample, iniciadoEm: "2026-11-22T12:00:00.000Z", concluidoEm: "2026-11-22T12:00:12.000Z", tamanhoBytes: 1234, status: "COMPLETED", progresso: 100, downloadDisponivel: true }],
} as const;
const publicReportStatusResponse = {
  type: "object", additionalProperties: false,
  required: ["id", "tipo", "formato", "status", "criadoEm", "iniciadoEm", "concluidoEm", "progresso", "mensagemErro", "downloadDisponivel", "expiraEm", "tamanhoBytes"],
  properties: reportStatusCommonProperties,
  examples: [{ ...publicReportExample, iniciadoEm: "2026-11-22T12:00:00.000Z", concluidoEm: "2026-11-22T12:00:12.000Z", tamanhoBytes: 1234, status: "COMPLETED", progresso: 100, downloadDisponivel: true }],
} as const;
const acceptedExample = {
  id: "a81c6f14-9d42-4b79-8f12-4db60d4a67aa", tipo: "operacional", formato: "CSV", status: "PENDING",
  criadoEm: "2026-11-21T12:00:00.000Z", expiraEm: "2026-11-28T12:00:00.000Z",
  mensagem: "Relatório recebido para processamento assíncrono.",
};
const acceptedResponse = {
  type: "object", additionalProperties: false,
  required: ["id", "tipo", "formato", "status", "criadoEm", "expiraEm", "mensagem"],
  properties: {
    id: uuid,
    tipo: { type: "string", enum: [...reportTypes] },
    formato: { type: "string", enum: ["CSV", "JSON"] },
    status: { type: "string", enum: [...reportStatuses] },
    criadoEm: { type: "string", format: "date-time" },
    expiraEm: { type: "string", format: "date-time" },
    mensagem: { type: "string" },
  },
} as const;
const reportListItem = {
  type: "object", additionalProperties: false,
  required: ["id", "tipo", "formato", "status", "progresso", "criadoEm", "expiraEm"],
  properties: {
    id: uuid, tipo: { type: "string", enum: [...reportTypes] }, formato: { type: "string", enum: ["CSV", "JSON"] },
    status: { type: "string", enum: [...reportStatuses] }, progresso: { type: "integer" },
    organizacaoId: { type: "string", format: "uuid" },
    criadoEm: { type: "string", format: "date-time" }, iniciadoEm: { type: ["string", "null"], format: "date-time" },
    concluidoEm: { type: ["string", "null"], format: "date-time" }, expiraEm: { type: "string", format: "date-time" },
    mensagemErro: { type: ["string", "null"] },
  },
} as const;
const reportListResponse = {
  type: "object", additionalProperties: false, required: ["data", "meta"],
  properties: {
    data: { type: "array", items: reportListItem },
    meta: { type: "object", additionalProperties: false, required: ["page", "pageSize", "total", "totalPages"], properties: {
      page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" },
    } },
  },
} as const;
const errorSchema = {
  type: "object", required: ["error"], properties: {
    error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: {}, requestId: { type: "string" } } },
  },
} as const;
function errorResponse(description: string, code: string, message: string) {
  return { ...errorSchema, description, examples: [{ error: { code, message, requestId: "req-exemplo" } }] };
}
const commonErrors = {
  400: errorResponse("Corpo, filtros ou identificador inválido.", "VALIDATION_ERROR", "A requisição contém campos inválidos."),
  401: errorResponse("Token JWT ausente, inválido ou expirado.", "UNAUTHENTICATED", "Autenticação inválida."),
  403: errorResponse("Usuário autenticado sem o papel necessário.", "FORBIDDEN", "Permissão insuficiente."),
} as const;
const publicIntegrationHeader = {
  type: "object", additionalProperties: true, required: ["x-api-key", "x-integration-id"],
  properties: {
    "x-api-key": { type: "string", description: "Chave enviada no header ou informada em Authorize." },
    "x-integration-id": { type: "string", minLength: 1, maxLength: 64, description: "Identificador público ativo do vínculo parceiro-organização.", examples: ["gci_0123456789abcdef0123456789abcdef"] },
  },
  examples: [{ "x-api-key": "gc_live_COLOQUE_SUA_CHAVE", "x-integration-id": "gci_0123456789abcdef0123456789abcdef" }],
} as const;
function sendFile(reply: FastifyReply, file: { stream: NodeJS.ReadableStream; filename: string; contentType: string; size: number }) {
  return reply.header("Content-Type", file.contentType).header("Content-Disposition", `attachment; filename="${file.filename}"`).header("Content-Length", String(file.size)).send(file.stream);
}
type PublicHook = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
type RateLimiter = { consume(key: string, limit: number): Promise<{ allowed: boolean; remaining: number; resetAt: number; retryAfterSeconds: number }> };

export function registerRelatoriosAsyncRoutes(app: FastifyInstance, controller: RelatoriosAsyncController, publicAuth: PublicHook, limiter: RateLimiter) {
  const internal = { preHandler: [app.authenticate, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!["ADMINISTRADOR", "AUDITOR"].includes(request.user.papel)) return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Permissão insuficiente.", requestId: request.id } });
  }] };

  app.post("/api/v1/relatorios/async", { ...internal, schema: {
    tags: ["Relatórios Assíncronos"], summary: "Solicita relatório assíncrono (área interna)",
    description: "Cria o registro do relatório e um evento de Outbox na mesma transação. Retorna HTTP 202; o arquivo ainda não está pronto. Disponível para ADMINISTRADOR e AUDITOR.",
    security: [{ bearerAuth: [] }], body: reportBody,
    response: {
      202: { ...acceptedResponse, examples: [acceptedExample] },
      ...commonErrors,
      404: errorResponse("Organização inexistente ou inativa.", "ORGANIZATION_NOT_FOUND", "Organização não encontrada ou inativa."),
      409: errorResponse("Limite de 20 relatórios PENDING/PROCESSING por organização atingido.", "REPORT_QUEUE_LIMIT", "A organização atingiu o limite de 20 relatórios pendentes."),
    },
  } }, async (request, reply) => reply.code(202).send(await controller.requestInternal(request.body, request.user.sub, request.id)));

  app.get("/api/v1/relatorios/async", { ...internal, schema: {
    tags: ["Relatórios Assíncronos"], summary: "Lista o histórico de relatórios internos",
    description: "Lista relatórios com paginação, filtro opcional por organização e status. Ordenação mais recente primeiro. page padrão 1; pageSize padrão 20 e máximo 100.",
    security: [{ bearerAuth: [] }], querystring: query,
    response: { 200: { ...reportListResponse, examples: [{ data: [{ id: internalReportExample.id, tipo: internalReportExample.tipo, formato: internalReportExample.formato, status: internalReportExample.status, progresso: 0, organizacaoId: internalReportExample.organizacaoId, criadoEm: internalReportExample.criadoEm, iniciadoEm: null, concluidoEm: null, expiraEm: internalReportExample.expiraEm, mensagemErro: null }], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }] }, 401: commonErrors[401], 403: commonErrors[403] },
  } }, async request => controller.listInternal(request.query));

  app.get<{ Params: { id: string } }>("/api/v1/relatorios/async/:id", { ...internal, schema: {
    tags: ["Relatórios Assíncronos"], summary: "Consulta status e disponibilidade de um relatório",
    description: "O status pode ser PENDING, PROCESSING, COMPLETED, FAILED ou EXPIRED. A resposta não expõe o caminho físico do arquivo; downloadDisponivel indica se o endpoint de download pode ser usado.",
    security: [{ bearerAuth: [] }], params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } },
    response: { 200: internalReportStatusResponse, 401: commonErrors[401], 403: commonErrors[403], 404: errorResponse("Identificador não encontrado.", "REPORT_NOT_FOUND", "Relatório não encontrado.") },
  } }, async request => controller.getInternal(request.params.id));

  app.post<{ Params: { id: string } }>("/api/v1/relatorios/async/:id/reprocessar", { ...internal, schema: {
    tags: ["Relatórios Assíncronos"], summary: "Reprocessa um relatório com falha",
    description: "Somente relatórios FAILED e ainda dentro do prazo de validade podem ser reenfileirados. O serviço cria novo evento de Outbox e retorna HTTP 202.",
    security: [{ bearerAuth: [] }], params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } },
    response: { 202: { ...acceptedResponse, examples: [{ ...acceptedExample, mensagem: "Relatório reenfileirado para processamento." }] }, 401: commonErrors[401], 403: commonErrors[403], 404: errorResponse("Identificador não encontrado.", "REPORT_NOT_FOUND", "Relatório não encontrado."), 409: errorResponse("Relatório não está FAILED ou já expirou.", "REPORT_NOT_REPROCESSABLE", "Somente relatórios com falha e dentro do prazo podem ser reprocessados.") },
  } }, async (request, reply) => reply.code(202).send(await controller.reprocess(request.params.id, request.user.sub, request.id)));

  app.get<{ Params: { id: string } }>("/api/v1/relatorios/async/:id/download", { ...internal, schema: {
    tags: ["Relatórios Assíncronos"], summary: "Baixa o arquivo de um relatório interno",
    description: "Entrega CSV ou JSON somente quando COMPLETED e dentro da validade. Define Content-Type, Content-Disposition e Content-Length. Responde 409 se ainda não concluiu e 410 se expirou ou arquivo sumiu.",
    security: [{ bearerAuth: [] }], params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } },
    response: { 200: { description: "Arquivo CSV ou JSON para download.", type: "string", format: "binary", examples: ["tipo,quantidade\r\nNOTEBOOK,1\r\n"] }, 401: commonErrors[401], 403: commonErrors[403], 404: errorResponse("Relatório não encontrado.", "REPORT_NOT_FOUND", "Relatório não encontrado."), 409: errorResponse("Relatório ainda não está pronto ou integridade falhou.", "REPORT_NOT_READY", "O relatório ainda não está disponível para download."), 410: errorResponse("Arquivo expirado ou removido.", "REPORT_EXPIRED", "O arquivo do relatório expirou.") },
  } }, async (request, reply) => sendFile(reply, await controller.download(request.params.id, { usuarioId: request.user.sub }, request.id)));

  const publicLimit = async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = request.integrationIdentity!;
    const [partner, key] = await Promise.all([limiter.consume(`partner:${identity.parceiroId}`, identity.limiteParceiroPorMinuto), limiter.consume(`key:${identity.apiKeyId}`, identity.limiteChavePorMinuto)]);
    reply.header("X-RateLimit-Limit", String(identity.limiteRequisicoesPorMinuto)).header("X-RateLimit-Remaining", String(Math.min(partner.remaining, key.remaining))).header("X-RateLimit-Reset", String(Math.ceil(Math.max(partner.resetAt, key.resetAt) / 1000)));
    if (!partner.allowed || !key.allowed) { const retry = Math.max(partner.allowed ? 0 : partner.retryAfterSeconds, key.allowed ? 0 : key.retryAfterSeconds); reply.header("Retry-After", String(retry)); throw new DomainError(429, "RATE_LIMIT_EXCEEDED", "Limite de requisições por minuto excedido.", { retryAfterSeconds: retry }); }
    const size = Buffer.byteLength(JSON.stringify(request.body ?? {}), "utf8");
    if (size > identity.maxPayloadBytes) throw new DomainError(413, "PAYLOAD_TOO_LARGE", "Payload excede o limite efetivo da API Key.");
  };
  const publicErrors = {
    400: errorResponse("JSON ou filtros inválidos; também pode indicar X-Integration-ID ausente.", "VALIDATION_ERROR", "A requisição contém campos inválidos."),
    401: errorResponse("API Key ausente, inválida, expirada ou revogada.", "INVALID_API_KEY", "API Key não autenticada."),
    403: errorResponse("Falta reports:write/reports:read ou associação não autorizada.", "FORBIDDEN", "A API Key não possui o escopo solicitado."),
    404: errorResponse("Integração ou relatório não encontrado no escopo do parceiro.", "INTEGRATION_NOT_FOUND", "Integração não encontrada."),
    413: errorResponse("Payload acima do limite efetivo da API Key.", "PAYLOAD_TOO_LARGE", "Payload excede o limite efetivo da API Key."),
    429: errorResponse("Limite por parceiro ou chave excedido. Aguarde o número de segundos em Retry-After.", "RATE_LIMIT_EXCEEDED", "Limite de requisições por minuto excedido."),
  } as const;

  app.post("/api/v1/public/relatorios", { onRequest: publicAuth, preHandler: [publicLimit], schema: {
    tags: ["API Pública", "Relatórios Assíncronos"], summary: "Solicita relatório para uma integração autorizada",
    description: "Requer X-API-Key, X-Integration-ID ativo e escopo reports:write. A organização é resolvida pela associação do parceiro, não por UUID recebido no body. Retorna HTTP 202; a tarefa é publicada pela Outbox e processada pelo worker. Há limite de 20 solicitações pendentes/em processamento por organização.",
    security: [{ apiKeyAuth: [] }], headers: publicIntegrationHeader, body: publicBody,
    response: { 202: { ...acceptedResponse, examples: [acceptedExample] }, 400: publicErrors[400], 401: publicErrors[401], 403: publicErrors[403], 404: publicErrors[404], 409: errorResponse("Fila da organização atingiu o limite de pendências.", "REPORT_QUEUE_LIMIT", "A organização atingiu o limite de 20 relatórios pendentes."), 413: publicErrors[413], 429: publicErrors[429] },
  } }, async (request, reply) => {
    const integrationId = request.headers["x-integration-id"];
    if (typeof integrationId !== "string" || !integrationId.trim()) throw errors.badRequest("MISSING_INTEGRATION_HEADER", "Informe X-Integration-ID.");
    return reply.code(202).send(await controller.requestPublic(request.body, request.integrationIdentity!, request.id, integrationId));
  });

  app.get("/api/v1/public/relatorios", { onRequest: publicAuth, preHandler: [publicLimit], schema: {
    tags: ["API Pública", "Relatórios Assíncronos"], summary: "Lista relatórios disponíveis para o parceiro",
    description: "Requer X-API-Key e escopo reports:read. O resultado fica limitado aos relatórios do parceiro e à organização ainda vinculada. Não aceita organizationId interno. page padrão 1 e pageSize padrão 20, máximo 100.",
    security: [{ apiKeyAuth: [] }], headers: { type: "object", required: ["x-api-key"], properties: { "x-api-key": { type: "string" } } }, querystring: publicQuery,
    response: { 200: { ...reportListResponse, examples: [{ data: [{ id: "a81c6f14-9d42-4b79-8f12-4db60d4a67aa", tipo: "operacional", formato: "CSV", status: "PENDING", progresso: 0, criadoEm: "2026-11-21T12:00:00.000Z", iniciadoEm: null, concluidoEm: null, expiraEm: "2026-11-28T12:00:00.000Z", mensagemErro: null }], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }] }, 401: publicErrors[401], 403: publicErrors[403], 429: publicErrors[429] },
  } }, async request => controller.listPublic(request.integrationIdentity!, request.query));

  app.get<{ Params: { id: string } }>("/api/v1/public/relatorios/:id", { onRequest: publicAuth, preHandler: [publicLimit], schema: {
    tags: ["API Pública", "Relatórios Assíncronos"], summary: "Consulta o status de um relatório do parceiro",
    description: "Requer escopo reports:read. O parceiro só consulta relatórios pertencentes a ele e a uma organização com associação ativa. A resposta remove o caminho interno do arquivo.",
    security: [{ apiKeyAuth: [] }], headers: { type: "object", required: ["x-api-key"], properties: { "x-api-key": { type: "string" } } }, params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } },
    response: { 200: publicReportStatusResponse, 401: publicErrors[401], 403: publicErrors[403], 404: publicErrors[404], 429: publicErrors[429] },
  } }, async request => controller.getPublic(request.params.id, request.integrationIdentity!));

  app.get<{ Params: { id: string } }>("/api/v1/public/relatorios/:id/download", { onRequest: publicAuth, preHandler: [publicLimit], schema: {
    tags: ["API Pública", "Relatórios Assíncronos"], summary: "Baixa relatório concluído autorizado ao parceiro",
    description: "Requer reports:read, propriedade do relatório pelo parceiro e associação ativa. O arquivo só é enviado em COMPLETED e antes de expirar. Responde 409 quando não está pronto/integro e 410 após expiração ou ausência do arquivo.",
    security: [{ apiKeyAuth: [] }], headers: { type: "object", required: ["x-api-key"], properties: { "x-api-key": { type: "string" } } }, params: { type: "object", additionalProperties: false, required: ["id"], properties: { id: uuid } },
    response: { 200: { description: "Arquivo CSV ou JSON", type: "string", format: "binary" }, 401: publicErrors[401], 403: publicErrors[403], 404: publicErrors[404], 409: errorResponse("Relatório ainda não concluiu ou a integridade não pôde ser confirmada.", "REPORT_NOT_READY", "O relatório ainda não está disponível para download."), 410: errorResponse("Arquivo expirou ou não está mais no armazenamento.", "REPORT_EXPIRED", "O arquivo do relatório expirou."), 429: publicErrors[429] },
  } }, async (request, reply) => sendFile(reply, await controller.download(request.params.id, { parceiroId: request.integrationIdentity!.parceiroId, apiKeyId: request.integrationIdentity!.apiKeyId, escoposEfetivos: request.integrationIdentity!.escoposEfetivos }, request.id)));
}
