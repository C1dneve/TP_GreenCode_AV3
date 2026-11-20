import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AnalyticsController } from "./analytics.controller.js";
import type { AnalyticsFilters } from "./analytics.repository.js";
import { DomainError, errors } from "../../shared/domain-error.js";
const err = { $ref: "Erro#" } as const;
const uuid = { type: "string", format: "uuid" } as const;
const filters = { type: "object", additionalProperties: false, properties: { organizacaoId: uuid, de: { type: "string", format: "date-time" }, ate: { type: "string", format: "date-time" }, incluirDemonstracao: { type: "boolean", default: false } } } as const;
interface AnalyticsFilterBody {
  organizacaoId?: string;
  de?: string;
  ate?: string;
  incluirDemonstracao?: boolean;
}

interface PublicAnalyticsBody {
  organizacaoId: string;
  de?: string;
  ate?: string;
}

type PublicHook = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
type RateLimiter = { consume(key: string, limit: number): Promise<{ allowed: boolean; remaining: number; resetAt: number; retryAfterSeconds: number }> };
export function registerAnalyticsRoutes(app: FastifyInstance, controller: AnalyticsController, publicAuth: PublicHook, limiter: RateLimiter) {
  const auth = { preHandler: [app.authenticate, async (request: FastifyRequest, reply: FastifyReply) => { if (!(["ADMINISTRADOR", "AUDITOR"].includes(request.user.papel))) return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Permissão insuficiente.", requestId: request.id } }); }] };
  app.post<{ Params: { tipo: string }; Body: AnalyticsFilterBody }>("/api/v1/analytics/:tipo", { ...auth, schema: { tags: ["Analytics"], summary: "Executa e persiste uma análise GreenCode", security: [{ bearerAuth: [] }], params: { type: "object", required: ["tipo"], properties: { tipo: { type: "string", enum: ["eficiencia-operacional", "rentabilidade", "vida-util"] } } }, body: filters, response: { 200: { type: "object", additionalProperties: true }, 400: err, 403: err } } }, async request => controller.execute(request.params.tipo, normalizeFilters(request.body)));
  app.get<{ Params: { tipo: string }; Querystring: { organizacaoId?: string; limit?: number } }>("/api/v1/analytics/:tipo/historico", { ...auth, schema: { tags: ["Analytics"], summary: "Consulta execuções analíticas persistidas", security: [{ bearerAuth: [] }], params: { type: "object", required: ["tipo"], properties: { tipo: { type: "string", enum: ["eficiencia-operacional", "rentabilidade", "vida-util"] } } }, querystring: { type: "object", additionalProperties: false, properties: { organizacaoId: uuid, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } } }, response: { 200: { type: "array", items: { type: "object" } }, 403: err } } }, async request => {
    const rows = await controller.history(request.params.tipo, request.query.organizacaoId);
    return rows.slice(0, request.query.limit ?? 20);
  });

  const publicPre = (scope: "analytics:read" | "analytics:write") => async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = request.integrationIdentity!; const [partner, key] = await Promise.all([limiter.consume(`partner:${identity.parceiroId}`, identity.limiteParceiroPorMinuto), limiter.consume(`key:${identity.apiKeyId}`, identity.limiteChavePorMinuto)]);
    reply.header("X-RateLimit-Limit", String(identity.limiteRequisicoesPorMinuto)).header("X-RateLimit-Remaining", String(Math.min(partner.remaining, key.remaining)));
    if (!partner.allowed || !key.allowed) throw new DomainError(429, "RATE_LIMIT_EXCEEDED", "Limite de requisições por minuto excedido.");
    if (!identity.escoposEfetivos.includes(scope)) throw errors.forbidden(`Escopo necessário: ${scope}.`);
    if (Buffer.byteLength(JSON.stringify(request.body ?? {}), "utf8") > identity.maxPayloadBytes) throw new DomainError(413, "PAYLOAD_TOO_LARGE", "Payload excede o limite efetivo da API Key.");
  };
  const typeParams = { type: "object", required: ["tipo"], properties: { tipo: { type: "string", enum: ["eficiencia-operacional", "rentabilidade", "vida-util"] } } } as const;
  const publicBody = { type: "object", additionalProperties: false, required: ["organizacaoId"], properties: { organizacaoId: uuid, de: { type: "string", format: "date-time" }, ate: { type: "string", format: "date-time" } } } as const;
  app.post<{ Params: { tipo: string }; Body: PublicAnalyticsBody }>("/api/v1/public/analytics/:tipo", { onRequest: publicAuth, preHandler: [publicPre("analytics:write")], schema: { tags: ["API Pública", "Analytics"], summary: "Executa análise no escopo de organização autorizada", security: [{ apiKeyAuth: [] }], params: typeParams, body: publicBody, response: { 200: { type: "object", additionalProperties: true }, 401: err, 403: err, 404: err, 429: err } } }, async request => {
    const identity = request.integrationIdentity!;
    const normalizedFilters = normalizeFilters({
      organizacaoId: request.body.organizacaoId,
      de: request.body.de,
      ate: request.body.ate,
      incluirDemonstracao: false,
    });
    return controller.executePublic(request.params.tipo, { ...normalizedFilters, organizacaoId: request.body.organizacaoId }, identity, request.id);
  });
  app.get<{ Params: { tipo: string }; Querystring: { organizacaoId: string; limit?: number } }>("/api/v1/public/analytics/:tipo/historico", { onRequest: publicAuth, preHandler: [publicPre("analytics:read")], schema: { tags: ["API Pública", "Analytics"], summary: "Consulta análises persistidas de organização autorizada", security: [{ apiKeyAuth: [] }], params: typeParams, querystring: { type: "object", required: ["organizacaoId"], additionalProperties: false, properties: { organizacaoId: uuid, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } } }, response: { 200: { type: "array", items: { type: "object" } }, 401: err, 403: err, 404: err } } }, async request => {
    return controller.historyPublic(request.params.tipo, request.query.organizacaoId, request.integrationIdentity!, request.query.limit ?? 20);
  });
}
function normalizeFilters(input: AnalyticsFilterBody): AnalyticsFilters {
  const result: AnalyticsFilters = { incluirDemonstracao: input.incluirDemonstracao === true };
  if (input.organizacaoId) result.organizacaoId = input.organizacaoId;
  if (input.de) {
    const date = new Date(input.de);
    if (!Number.isFinite(date.getTime())) throw errors.badRequest("VALIDATION_ERROR", "Filtro de inválido.");
    result.de = date;
  }
  if (input.ate) {
    const date = new Date(input.ate);
    if (!Number.isFinite(date.getTime())) throw errors.badRequest("VALIDATION_ERROR", "Filtro ate inválido.");
    result.ate = date;
  }
  if (result.de && result.ate && result.de > result.ate) throw errors.badRequest("VALIDATION_ERROR", "de não pode ser posterior a ate.");
  return result;
}
