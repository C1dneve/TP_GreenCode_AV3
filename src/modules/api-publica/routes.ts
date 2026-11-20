import type { FastifyInstance, FastifyReply, FastifyRequest, preParsingHookHandler } from "fastify";
import { Transform } from "node:stream";
import { DomainError, errors } from "../../shared/domain-error.js";
import { InMemoryRateLimiter } from "../integracoes/rate-limiter.js";
import type { IntegrationScope } from "../integracoes/scopes.js";
import type { ApiPublicaController } from "./api-publica.controller.js";
import type { IntegrationIdentity } from "./integration-auth.js";

const err = { $ref: "Erro#" } as const;
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

function publicPreHandler(scope: IntegrationScope, limiter: InMemoryRateLimiter) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = request.integrationIdentity as IntegrationIdentity | undefined;
    if (!identity) throw errors.unauthorized("INVALID_API_KEY", "API Key não autenticada.");
    const partnerResult = limiter.consume(`partner:${identity.parceiroId}`, identity.limiteParceiroPorMinuto);
    const keyResult = limiter.consume(`key:${identity.apiKeyId}`, identity.limiteChavePorMinuto);
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
  limiter = new InMemoryRateLimiter(),
) {
  const submitPre = publicPreHandler("lotes:write", limiter);
  const readPre = publicPreHandler("rastreabilidade:read", limiter);

  app.post("/api/v1/public/lotes", { onRequest: authenticate, preParsing: enforceRawPayloadLimit, preHandler: submitPre, schema: {
    tags: ["API Pública"], summary: "Submete lote e, opcionalmente, equipamentos em uma única transação",
    description: "Requer API Key com escopo lotes:write, X-Integration-ID ativo e Idempotency-Key. A organização é resolvida pelo identificador de integração; IDs internos e CNPJ não são aceitos.",
    security: [{ apiKeyAuth: [] }], headers: {
      type: "object", additionalProperties: true,
      required: ["x-integration-id", "idempotency-key"],
      properties: {
        "x-integration-id": { type: "string", description: "Identificador público parceiro-organização." },
        "idempotency-key": { type: "string", minLength: 1, maxLength: 200 },
      },
    },
    body: { ...lotBody, examples: [{ externalId: "erp-lote-2026-0001", notaFiscal: "NF-0001", transportadora: "Transportadora Exemplo", observacoes: "Lote de equipamentos usados", equipamentos: [{ tipo: "NOTEBOOK", marca: "Exemplo", modelo: "NB-14", anoFabricacao: 2024, estadoFisico: "BOM_ESTADO", pesoQuilogramas: "2.500" }] }] },
    response: {
      201: { ...publicSubmissionResponse, examples: [{ identificadorPublico: "gcl_0123456789abcdef0123456789abcdef", externalId: "erp-lote-2026-0001", status: "RECEBIDO", dataEntrada: "2026-11-20T12:00:00.000Z", criadoEm: "2026-11-20T12:00:00.000Z", quantidadeEquipamentos: 1, equipamentos: [{ tipo: "NOTEBOOK", marca: "Exemplo", modelo: "NB-14", estadoFisico: "BOM_ESTADO", statusRastreamento: "AGUARDANDO_TRIAGEM" }] }] },
      400: err, 401: err, 403: err, 409: err, 413: err, 429: err,
    },
  } }, async (request, reply) => {
    const integrationId = request.headers["x-integration-id"];
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof integrationId !== "string" || typeof idempotencyKey !== "string") throw errors.badRequest("MISSING_INTEGRATION_HEADERS", "Informe X-Integration-ID e Idempotency-Key.");
    const result = await controller.submit(request.body as never, request.integrationIdentity as IntegrationIdentity, integrationId, idempotencyKey, request.id);
    return reply.code(201).send(result);
  });

  app.get("/api/v1/public/rastreabilidade/lotes/:identificadorPublico", { preHandler: [authenticate, readPre], schema: {
    tags: ["API Pública"], summary: "Consulta rastreabilidade pelo identificador público GreenCode",
    description: "Requer API Key com escopo rastreabilidade:read e associação ativa do parceiro à organização do lote.", security: [{ apiKeyAuth: [] }],
    headers: { type: "object", required: ["x-api-key"], properties: { "x-api-key": { type: "string" } } },
    params: { type: "object", required: ["identificadorPublico"], properties: { identificadorPublico: { type: "string", minLength: 1, maxLength: 40 } } },
    response: { 200: publicTrackingResponse, 401: err, 403: err, 404: err, 429: err },
  } }, async request => controller.getByPublicId((request.params as { identificadorPublico: string }).identificadorPublico, request.integrationIdentity as IntegrationIdentity, request.id));

  app.get("/api/v1/public/rastreabilidade/external/:externalId", { preHandler: [authenticate, readPre], schema: {
    tags: ["API Pública"], summary: "Consulta rastreabilidade por externalId no contexto do parceiro autenticado",
    description: "A referência externa é isolada pelo parceiro da API Key; o escopo rastreabilidade:read e o vínculo ativo com a organização são verificados.", security: [{ apiKeyAuth: [] }],
    headers: { type: "object", required: ["x-api-key"], properties: { "x-api-key": { type: "string" } } },
    params: { type: "object", required: ["externalId"], properties: { externalId: { type: "string", minLength: 1, maxLength: 200 } } },
    response: { 200: publicTrackingResponse, 401: err, 403: err, 404: err, 429: err },
  } }, async request => controller.getByExternalId((request.params as { externalId: string }).externalId, request.integrationIdentity as IntegrationIdentity, request.id));
}
