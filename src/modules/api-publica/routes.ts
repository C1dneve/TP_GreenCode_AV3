import type { FastifyInstance, FastifyReply, FastifyRequest, preParsingHookHandler } from "fastify";
import { Transform } from "node:stream";
import { DomainError, errors } from "../../shared/domain-error.js";
import type { IntegrationScope } from "../integracoes/scopes.js";
import type { ApiPublicaController } from "./api-publica.controller.js";
import type { IntegrationIdentity } from "./integration-auth.js";

const publicEquipment = {
  type: "object", additionalProperties: false,
  required: ["tipo", "marca", "modelo", "estadoFisico", "statusRastreamento"],
  properties: {
    tipo: { type: "string" }, marca: { type: "string" }, modelo: { type: "string" },
    estadoFisico: { type: "string" }, statusRastreamento: { type: "string" },
    movimentacoes: { type: "array", items: { type: "object", additionalProperties: false, required: ["dataHora", "origem", "destino"], properties: {
      dataHora: { type: "string", format: "date-time" }, origem: { type: "string" }, destino: { type: "string" },
    } } },
  },
} as const;
const publicSubmissionResponse = {
  type: "object", additionalProperties: false,
  required: ["identificadorPublico", "status", "dataEntrada", "criadoEm", "quantidadeEquipamentos", "equipamentos"],
  properties: {
    identificadorPublico: { type: "string" }, externalId: { type: "string" }, status: { type: "string" },
    dataEntrada: { type: "string", format: "date-time" }, criadoEm: { type: "string", format: "date-time" },
    quantidadeEquipamentos: { type: "integer", minimum: 0 },
    equipamentos: { type: "array", items: { type: "object", additionalProperties: false, required: ["tipo", "marca", "modelo", "estadoFisico", "statusRastreamento"], properties: {
      tipo: { type: "string" }, marca: { type: "string" }, modelo: { type: "string" }, estadoFisico: { type: "string" }, statusRastreamento: { type: "string" },
    } } },
  },
} as const;
const publicLotResponse = {
  type: "object", additionalProperties: false,
  required: ["identificadorPublico", "status", "ativo", "versao", "dataEntrada", "notaFiscal", "transportadora", "observacoes", "criadoEm", "atualizadoEm", "quantidadeEquipamentos"],
  properties: {
    identificadorPublico: { type: "string" }, externalId: { type: "string" },
    status: { type: "string", enum: ["RECEBIDO", "EM_TRIAGEM", "TRIAGEM_CONCLUIDA", "ENCAMINHADO", "FINALIZADO", "CANCELADO"] },
    ativo: { type: "boolean" }, versao: { type: "integer" },
    dataEntrada: { type: "string", format: "date-time" }, notaFiscal: { type: "string" },
    transportadora: { type: "string" }, observacoes: { type: "string" },
    criadoEm: { type: "string", format: "date-time" }, atualizadoEm: { type: "string", format: "date-time" },
    quantidadeEquipamentos: { type: "integer", minimum: 0 },
  },
} as const;
const publicLotPageResponse = {
  type: "object", additionalProperties: false, required: ["data", "meta"],
  properties: {
    data: { type: "array", items: publicLotResponse },
    meta: { type: "object", additionalProperties: false, required: ["page", "pageSize", "total", "totalPages"], properties: {
      page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" },
    } },
  },
} as const;
const versionBody = {
  type: "object", additionalProperties: false, required: ["versaoEsperada"],
  properties: { versaoEsperada: { type: "integer", minimum: 1 } },
} as const;

const publicTrackingResponse = {
  type: "object", additionalProperties: false,
  required: ["identificadorPublico", "status", "dataEntrada", "criadoEm", "atualizadoEm", "quantidadeEquipamentos", "historicoOperacional", "equipamentos"],
  properties: {
    identificadorPublico: { type: "string" }, externalId: { type: "string" }, status: { type: "string" },
    dataEntrada: { type: "string", format: "date-time" }, criadoEm: { type: "string", format: "date-time" }, atualizadoEm: { type: "string", format: "date-time" },
    quantidadeEquipamentos: { type: "integer", minimum: 0 },
    historicoOperacional: { type: "array", items: { type: "object", additionalProperties: false, required: ["instante", "acao", "resultado"], properties: {
      instante: { type: "string", format: "date-time" }, acao: { type: "string" }, resultado: { type: "string" },
    } } },
    equipamentos: { type: "array", items: publicEquipment },
  },
} as const;
const lotBody = {
  type: "object", additionalProperties: false,
  required: ["notaFiscal", "transportadora"],
  properties: {
    externalId: { type: "string", minLength: 1, maxLength: 200 },
    dataEntrada: { type: "string", format: "date-time" },
    notaFiscal: { type: "string", minLength: 1, maxLength: 100 },
    transportadora: { type: "string", minLength: 1, maxLength: 120 },
    observacoes: { type: "string", maxLength: 2000 },
    equipamentos: {
      type: "array", maxItems: 5000,
      items: { type: "object", additionalProperties: false, required: ["tipo", "marca", "modelo", "anoFabricacao", "estadoFisico", "pesoQuilogramas"], properties: {
        tipo: { type: "string", enum: ["COMPUTADOR_MESA", "NOTEBOOK", "MONITOR", "IMPRESSORA", "SERVIDOR", "ROTEADOR", "CABO_ESTRUTURADO", "FONTE_ALIMENTACAO"] },
        marca: { type: "string", minLength: 1, maxLength: 100 }, modelo: { type: "string", minLength: 1, maxLength: 120 },
        anoFabricacao: { type: "integer", minimum: 1900, maximum: 2100 },
        estadoFisico: { type: "string", enum: ["NOVO", "BOM_ESTADO", "USADO_LEVE", "USADO_MODERADO", "DANIFICADO_LEVE", "DANIFICADO_GRAVE", "INSERVIVEL"] },
        pesoQuilogramas: { type: "string", pattern: "^\\d+(\\.\\d{1,3})?$" }, valorAquisicao: { type: "string", pattern: "^\\d+(\\.\\d{1,2})?$" },
      } },
    },
  },
} as const;


function errorResponse(description: string, code: string, message: string) {
  return {
    description, type: "object", required: ["error"],
    properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: {}, requestId: { type: "string" } } } },
    examples: [{ error: { code, message, requestId: "req-exemplo" } }],
  };
}

const enforceRawPayloadLimit: preParsingHookHandler = (request, _reply, payload, done) => {
  const identity = request.integrationIdentity as IntegrationIdentity | undefined;
  if (!identity) {
    done(null, payload);
    return;
  }

  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const stream = this as Transform & { receivedEncodedLength?: number };
      const bytes = (stream.receivedEncodedLength ?? 0) + chunk.length;
      stream.receivedEncodedLength = bytes;
      if (bytes > identity.maxPayloadBytes) {
        callback(new DomainError(413, "PAYLOAD_TOO_LARGE", `Payload excede o limite efetivo de ${identity.maxPayloadBytes} bytes.`, { limiteBytes: identity.maxPayloadBytes, recebidoBytes: bytes }));
        return;
      }
      callback(null, chunk);
    },
  }) as Transform & { receivedEncodedLength?: number };
  limiter.receivedEncodedLength = 0;
  done(null, payload.pipe(limiter));
};

function publicPreHandler(scope: IntegrationScope, limiter: { consume: (key: string, limit: number) => Promise<import("../integracoes/rate-limiter.js").RateLimitResult> | import("../integracoes/rate-limiter.js").RateLimitResult }) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = request.integrationIdentity as IntegrationIdentity | undefined;
    if (!identity) throw errors.unauthorized("INVALID_API_KEY", "API Key não autenticada.");
    const [partnerResult, keyResult] = await Promise.all([limiter.consume(`partner:${identity.parceiroId}`, identity.limiteParceiroPorMinuto), limiter.consume(`key:${identity.apiKeyId}`, identity.limiteChavePorMinuto)]);
    const result = {
      allowed: partnerResult.allowed && keyResult.allowed,
      limit: identity.limiteRequisicoesPorMinuto,
      remaining: Math.min(partnerResult.remaining, keyResult.remaining),
      resetAt: Math.max(partnerResult.resetAt, keyResult.resetAt),
      retryAfterSeconds: Math.max(partnerResult.allowed ? 0 : partnerResult.retryAfterSeconds, keyResult.allowed ? 0 : keyResult.retryAfterSeconds),
    };
    reply.header("X-RateLimit-Limit", String(result.limit));
    reply.header("X-RateLimit-Remaining", String(result.remaining));
    reply.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
    if (!result.allowed) {
      reply.header("Retry-After", String(result.retryAfterSeconds));
      throw new DomainError(429, "RATE_LIMIT_EXCEEDED", "Limite de requisições por minuto excedido.", { retryAfterSeconds: result.retryAfterSeconds });
    }
    if (!identity.escoposEfetivos.includes(scope)) throw errors.forbidden(`Escopo necessário: ${scope}.`);
    const payloadBytes = Buffer.byteLength(JSON.stringify(request.body ?? {}), "utf8");
    if (payloadBytes > identity.maxPayloadBytes) throw new DomainError(413, "PAYLOAD_TOO_LARGE", `Payload excede o limite efetivo de ${identity.maxPayloadBytes} bytes.`);
  };
}

export function registerApiPublicaRoutes(
  app: FastifyInstance,
  controller: ApiPublicaController,
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
  limiter: { consume: (key: string, limit: number) => Promise<import("../integracoes/rate-limiter.js").RateLimitResult> },
) {
  const submitPre = publicPreHandler("lotes:write", limiter);
  const readPre = publicPreHandler("rastreabilidade:read", limiter);
  const lotReadPre = publicPreHandler("lotes:read", limiter);

  app.post("/api/v1/public/lotes", { onRequest: authenticate, preParsing: enforceRawPayloadLimit, preHandler: submitPre, schema: {
    tags: ["API Pública"], summary: "Submete lote e, opcionalmente, equipamentos em uma única transação",
    description: "Requer API Key com escopo lotes:write, X-Integration-ID ativo e Idempotency-Key. A organização é resolvida pelo identificador de integração; IDs internos e CNPJ não são aceitos.",
    security: [{ apiKeyAuth: [] }], headers: {
      type: "object", additionalProperties: true,
      required: ["x-api-key", "x-integration-id", "idempotency-key"],
      properties: {
        "x-api-key": { type: "string", description: "API Key emitida pelo administrador e cadastrada no botão Authorize." },
        "x-integration-id": { type: "string", description: "Identificador público parceiro-organização ativo. Exemplo: gci_0123456789abcdef0123456789abcdef", examples: ["gci_0123456789abcdef0123456789abcdef"] },
        "idempotency-key": { type: "string", minLength: 1, maxLength: 200, description: "Chave fornecida pelo cliente para evitar duplicidade em reenvios.", examples: ["erp-lote-2026-0001"] },
      },
      examples: [{ "x-api-key": "gc_live_COLOQUE_SUA_CHAVE", "x-integration-id": "gci_0123456789abcdef0123456789abcdef", "idempotency-key": "erp-lote-2026-0001" }],
    },
    body: { ...lotBody, examples: [{ externalId: "erp-lote-2026-0001", notaFiscal: "NF-0001", transportadora: "Transportadora Exemplo", observacoes: "Lote de equipamentos usados", equipamentos: [{ tipo: "NOTEBOOK", marca: "Exemplo", modelo: "NB-14", anoFabricacao: 2024, estadoFisico: "BOM_ESTADO", pesoQuilogramas: "2.500", valorAquisicao: "3500.00" }] }] },
    response: {
      201: { ...publicSubmissionResponse, examples: [{ identificadorPublico: "gcl_0123456789abcdef0123456789abcdef", externalId: "erp-lote-2026-0001", status: "RECEBIDO", dataEntrada: "2026-11-20T12:00:00.000Z", criadoEm: "2026-11-20T12:00:00.000Z", quantidadeEquipamentos: 1, equipamentos: [{ tipo: "NOTEBOOK", marca: "Exemplo", modelo: "NB-14", estadoFisico: "BOM_ESTADO", statusRastreamento: "AGUARDANDO_TRIAGEM" }] }] },
      400: errorResponse("Corpo inválido ou headers obrigatórios ausentes.", "VALIDATION_ERROR", "A requisição contém campos inválidos."),
      401: errorResponse("API Key ausente, inválida, expirada ou revogada.", "INVALID_API_KEY", "API Key não autenticada."),
      403: errorResponse("A chave não possui lotes:write ou o vínculo não está ativo.", "FORBIDDEN", "Escopo ou associação insuficiente."),
      409: errorResponse("A Idempotency-Key foi reutilizada com conteúdo diferente.", "IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi utilizada com outra requisição."),
      413: errorResponse("Payload acima do limite configurado para a API Key.", "PAYLOAD_TOO_LARGE", "Payload excede o limite efetivo da API Key."),
      429: errorResponse("Limite por parceiro ou API Key excedido; consulte Retry-After.", "RATE_LIMIT_EXCEEDED", "Limite de requisições por minuto excedido."),
    },
  } }, async (request, reply) => {
    const integrationId = request.headers["x-integration-id"];
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof integrationId !== "string" || typeof idempotencyKey !== "string") throw errors.badRequest("MISSING_INTEGRATION_HEADERS", "Informe X-Integration-ID e Idempotency-Key.");
    const result = await controller.submit(request.body as never, request.integrationIdentity as IntegrationIdentity, integrationId, idempotencyKey, request.id);
    return reply.code(201).send(result);
  });

  app.get("/api/v1/public/lotes", { onRequest: authenticate, preHandler: lotReadPre, schema: {
    tags: ["API Pública"], summary: "Lista os lotes vinculados ao parceiro autenticado",
    description: "Requer lotes:read. A listagem considera somente organizações com vínculo ativo do parceiro autenticado. Aceita paginação, status, externalId e período de entrada; não inclui histórico de rastreabilidade.",
    security: [{ apiKeyAuth: [] }],
    querystring: { type: "object", additionalProperties: false, properties: {
      page: { type: "integer", minimum: 1, default: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      status: { type: "string", enum: ["RECEBIDO", "EM_TRIAGEM", "TRIAGEM_CONCLUIDA", "ENCAMINHADO", "FINALIZADO", "CANCELADO"] },
      externalId: { type: "string", minLength: 1, maxLength: 200 },
      dataEntradaDe: { type: "string", format: "date-time" }, dataEntradaAte: { type: "string", format: "date-time" },
      ativo: { type: "boolean" },
    } },
    response: {
      200: { ...publicLotPageResponse, examples: [{ data: [{ identificadorPublico: "gcl_0123456789abcdef0123456789abcdef", externalId: "erp-lote-2026-0001", status: "RECEBIDO", ativo: true, versao: 1, dataEntrada: "2026-11-20T12:00:00.000Z", notaFiscal: "NF-0001", transportadora: "Transportadora Exemplo", observacoes: "Lote de equipamentos usados", criadoEm: "2026-11-20T12:00:00.000Z", atualizadoEm: "2026-11-20T12:00:00.000Z", quantidadeEquipamentos: 1 }], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }] },
      400: errorResponse("Filtros de consulta inválidos.", "VALIDATION_ERROR", "Os filtros informados são inválidos."),
      401: errorResponse("API Key ausente, inválida, expirada ou revogada.", "INVALID_API_KEY", "API Key não autenticada."),
      403: errorResponse("A API Key não possui lotes:read.", "FORBIDDEN", "Escopo insuficiente."),
      429: errorResponse("Limite por parceiro ou chave excedido.", "RATE_LIMIT_EXCEEDED", "Limite de requisições por minuto excedido."),
    },
  } }, async request => controller.listLots(request.query as never, request.integrationIdentity as IntegrationIdentity));

  app.get("/api/v1/public/lotes/:identificadorPublico", { onRequest: authenticate, preHandler: lotReadPre, schema: {
    tags: ["API Pública"], summary: "Consulta os dados básicos de um lote do parceiro",
    description: "Requer lotes:read. Retorna os dados de gestão do recurso, sem movimentações e histórico de rastreabilidade. Recursos fora dos vínculos ativos do parceiro respondem 404.",
    security: [{ apiKeyAuth: [] }],
    params: { type: "object", additionalProperties: false, required: ["identificadorPublico"], properties: { identificadorPublico: { type: "string", minLength: 1, maxLength: 40, examples: ["gcl_0123456789abcdef0123456789abcdef"] } } },
    response: {
      200: { ...publicLotResponse, examples: [{ identificadorPublico: "gcl_0123456789abcdef0123456789abcdef", externalId: "erp-lote-2026-0001", status: "RECEBIDO", ativo: true, versao: 1, dataEntrada: "2026-11-20T12:00:00.000Z", notaFiscal: "NF-0001", transportadora: "Transportadora Exemplo", observacoes: "Lote de equipamentos usados", criadoEm: "2026-11-20T12:00:00.000Z", atualizadoEm: "2026-11-20T12:00:00.000Z", quantidadeEquipamentos: 1 }] },
      401: errorResponse("API Key ausente, inválida, expirada ou revogada.", "INVALID_API_KEY", "API Key não autenticada."),
      403: errorResponse("A API Key não possui lotes:read.", "FORBIDDEN", "Escopo insuficiente."),
      404: errorResponse("Lote não encontrado para o parceiro autenticado.", "LOT_NOT_FOUND", "Lote não encontrado."),
      429: errorResponse("Limite por parceiro ou chave excedido.", "RATE_LIMIT_EXCEEDED", "Limite de requisições por minuto excedido."),
    },
  } }, async request => controller.getLot((request.params as { identificadorPublico: string }).identificadorPublico, request.integrationIdentity as IntegrationIdentity));

  app.patch("/api/v1/public/lotes/:identificadorPublico", { onRequest: authenticate, preHandler: submitPre, schema: {
    tags: ["API Pública"], summary: "Atualiza campos permitidos de um lote",
    description: "Requer lotes:write. Envie versaoEsperada para controle otimista de concorrência. Somente notaFiscal, transportadora e observacoes podem ser alterados e apenas enquanto o lote estiver RECEBIDO, ativo e sem triagem ou movimentação iniciada.",
    security: [{ apiKeyAuth: [] }],
    params: { type: "object", additionalProperties: false, required: ["identificadorPublico"], properties: { identificadorPublico: { type: "string", minLength: 1, maxLength: 40 } } },
    body: { type: "object", additionalProperties: false, minProperties: 2, required: ["versaoEsperada"], properties: {
      versaoEsperada: { type: "integer", minimum: 1 }, notaFiscal: { type: "string", minLength: 1, maxLength: 100 },
      transportadora: { type: "string", minLength: 1, maxLength: 120 }, observacoes: { type: "string", maxLength: 2000 },
    }, examples: [{ versaoEsperada: 1, notaFiscal: "NF-0001-A", observacoes: "Dados conferidos pelo ERP." }] },
    response: {
      200: publicLotResponse,
      400: errorResponse("Versão ou campos de atualização inválidos.", "VALIDATION_ERROR", "A requisição contém campos inválidos."),
      401: errorResponse("API Key ausente, inválida, expirada ou revogada.", "INVALID_API_KEY", "API Key não autenticada."),
      403: errorResponse("A API Key não possui lotes:write.", "FORBIDDEN", "Escopo insuficiente."),
      404: errorResponse("Lote não encontrado para o parceiro autenticado.", "LOT_NOT_FOUND", "Lote não encontrado."),
      409: errorResponse("Versão divergente ou lote fora do estado editável.", "VERSION_CONFLICT", "O lote não pode ser atualizado neste estado ou versão."),
      429: errorResponse("Limite por parceiro ou chave excedido.", "RATE_LIMIT_EXCEEDED", "Limite de requisições por minuto excedido."),
    },
  } }, async request => controller.updateLot((request.params as { identificadorPublico: string }).identificadorPublico, request.body as never, request.integrationIdentity as IntegrationIdentity, request.id));

  app.delete("/api/v1/public/lotes/:identificadorPublico", { onRequest: authenticate, preHandler: submitPre, schema: {
    tags: ["API Pública"], summary: "Cancela logicamente um lote",
    description: "Requer lotes:write. A operação exige versaoEsperada e só é permitida para lotes ativos em RECEBIDO, sem triagem ou movimentações. O registro e o histórico são preservados; repetir o cancelamento já concluído não altera novamente o recurso.",
    security: [{ apiKeyAuth: [] }],
    params: { type: "object", additionalProperties: false, required: ["identificadorPublico"], properties: { identificadorPublico: { type: "string", minLength: 1, maxLength: 40 } } },
    body: versionBody,
    response: {
      200: { ...publicLotResponse, examples: [{ identificadorPublico: "gcl_0123456789abcdef0123456789abcdef", externalId: "erp-lote-2026-0002", status: "CANCELADO", ativo: false, versao: 2, dataEntrada: "2026-11-20T12:00:00.000Z", notaFiscal: "NF-0002", transportadora: "Transportadora Exemplo", observacoes: "Cancelado pelo parceiro antes da triagem", criadoEm: "2026-11-20T12:00:00.000Z", atualizadoEm: "2026-11-20T12:10:00.000Z", quantidadeEquipamentos: 0 }] },
      400: errorResponse("versaoEsperada inválida.", "VALIDATION_ERROR", "Informe a versão atual do lote."),
      401: errorResponse("API Key ausente, inválida, expirada ou revogada.", "INVALID_API_KEY", "API Key não autenticada."),
      403: errorResponse("A API Key não possui lotes:write.", "FORBIDDEN", "Escopo insuficiente."),
      404: errorResponse("Lote não encontrado para o parceiro autenticado.", "LOT_NOT_FOUND", "Lote não encontrado."),
      409: errorResponse("Versão divergente ou lote não cancelável.", "LOT_NOT_CANCELLABLE", "O lote não pode ser cancelado neste estado."),
      429: errorResponse("Limite por parceiro ou chave excedido.", "RATE_LIMIT_EXCEEDED", "Limite de requisições por minuto excedido."),
    },
  } }, async request => controller.cancelLot((request.params as { identificadorPublico: string }).identificadorPublico, (request.body as { versaoEsperada: number }).versaoEsperada, request.integrationIdentity as IntegrationIdentity, request.id));

  app.get("/api/v1/public/rastreabilidade/lotes/:identificadorPublico", { preHandler: [authenticate, readPre], schema: {
    tags: ["Rastreabilidade"], summary: "Consulta rastreabilidade pelo identificador público GreenCode",
    description: "Consulta dados operacionais e movimentações públicas do lote. Requer API Key com escopo rastreabilidade:read e associação ativa do parceiro à organização do lote. Responde 401 para chave inválida, 403 para escopo insuficiente, 404 quando o lote não existe no escopo do parceiro e 429 quando o limite por minuto é atingido.", security: [{ apiKeyAuth: [] }],
    headers: { type: "object", required: ["x-api-key"], properties: { "x-api-key": { type: "string", description: "Também pode ser preenchido pelo Authorize global." } } },
    params: { type: "object", required: ["identificadorPublico"], properties: { identificadorPublico: { type: "string", minLength: 1, maxLength: 40, examples: ["gcl_0123456789abcdef0123456789abcdef"] } } },
    response: {
      200: { ...publicTrackingResponse, examples: [{ identificadorPublico: "gcl_0123456789abcdef0123456789abcdef", externalId: "erp-lote-2026-0001", status: "RECEBIDO", dataEntrada: "2026-11-20T12:00:00.000Z", criadoEm: "2026-11-20T12:00:00.000Z", atualizadoEm: "2026-11-20T12:10:00.000Z", quantidadeEquipamentos: 1, historicoOperacional: [{ instante: "2026-11-20T12:00:00.000Z", acao: "SUBMISSAO_PUBLICA_LOTE", resultado: "SUCESSO" }], equipamentos: [{ tipo: "NOTEBOOK", marca: "Exemplo", modelo: "NB-14", estadoFisico: "BOM_ESTADO", statusRastreamento: "AGUARDANDO_TRIAGEM", movimentacoes: [] }] }] },
      401: errorResponse("API Key ausente, inválida, expirada ou revogada.", "INVALID_API_KEY", "API Key não autenticada."),
      403: errorResponse("A chave não possui rastreabilidade:read ou o vínculo não está ativo.", "FORBIDDEN", "Escopo ou associação insuficiente."),
      404: errorResponse("Identificador não encontrado para o parceiro autenticado.", "LOT_NOT_FOUND", "Lote não encontrado."),
      429: errorResponse("Limite por parceiro ou chave excedido.", "RATE_LIMIT_EXCEEDED", "Limite de requisições por minuto excedido."),
    },
  } }, async request => controller.getByPublicId((request.params as { identificadorPublico: string }).identificadorPublico, request.integrationIdentity as IntegrationIdentity, request.id));

  app.get("/api/v1/public/rastreabilidade/external/:externalId", { preHandler: [authenticate, readPre], schema: {
    tags: ["Rastreabilidade"], summary: "Consulta rastreabilidade por externalId no contexto do parceiro autenticado",
    description: "A referência externalId é isolada pelo parceiro da API Key; o escopo rastreabilidade:read e o vínculo ativo com a organização são verificados. Responde 404 quando a referência não existe no contexto daquele parceiro.", security: [{ apiKeyAuth: [] }],
    headers: { type: "object", required: ["x-api-key"], properties: { "x-api-key": { type: "string" } } },
    params: { type: "object", required: ["externalId"], properties: { externalId: { type: "string", minLength: 1, maxLength: 200, examples: ["erp-lote-2026-0001"] } } },
    response: {
      200: { ...publicTrackingResponse, examples: [{ identificadorPublico: "gcl_0123456789abcdef0123456789abcdef", externalId: "erp-lote-2026-0001", status: "RECEBIDO", dataEntrada: "2026-11-20T12:00:00.000Z", criadoEm: "2026-11-20T12:00:00.000Z", atualizadoEm: "2026-11-20T12:10:00.000Z", quantidadeEquipamentos: 1, historicoOperacional: [{ instante: "2026-11-20T12:00:00.000Z", acao: "SUBMISSAO_PUBLICA_LOTE", resultado: "SUCESSO" }], equipamentos: [{ tipo: "NOTEBOOK", marca: "Exemplo", modelo: "NB-14", estadoFisico: "BOM_ESTADO", statusRastreamento: "AGUARDANDO_TRIAGEM", movimentacoes: [] }] }] },
      401: errorResponse("API Key ausente, inválida, expirada ou revogada.", "INVALID_API_KEY", "API Key não autenticada."),
      403: errorResponse("A chave não possui rastreabilidade:read ou o vínculo não está ativo.", "FORBIDDEN", "Escopo ou associação insuficiente."),
      404: errorResponse("externalId não encontrado no parceiro autenticado.", "LOT_NOT_FOUND", "Lote não encontrado."),
      429: errorResponse("Limite por parceiro ou chave excedido.", "RATE_LIMIT_EXCEEDED", "Limite de requisições por minuto excedido."),
    },
  } }, async request => controller.getByExternalId((request.params as { externalId: string }).externalId, request.integrationIdentity as IntegrationIdentity, request.id));
}
