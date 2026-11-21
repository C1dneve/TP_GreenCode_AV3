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
  de?: string;
  ate?: string;
}

type PublicHook = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
type RateLimiter = { consume(key: string, limit: number): Promise<{ allowed: boolean; remaining: number; resetAt: number; retryAfterSeconds: number }> };
export function registerAnalyticsRoutes(app: FastifyInstance, controller: AnalyticsController, publicAuth: PublicHook, limiter: RateLimiter) {
  const auth = { preHandler: [app.authenticate, async (request: FastifyRequest, reply: FastifyReply) => { if (!(["ADMINISTRADOR", "AUDITOR"].includes(request.user.papel))) return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Permissão insuficiente.", requestId: request.id } }); }] };
  app.post<{ Body: AnalyticsFilterBody }>("/api/v1/analytics/vida-util/backtesting", { ...auth, schema: {
    tags: ["Analytics"], summary: "Executa backtesting das previsões históricas de vida útil",
    description: "Compara previsões amadurecidas com a primeira transição auditada posterior para INSERVIVEL. Previsões sem evento observado são reportadas separadamente.",
    security: [{ bearerAuth: [] }], body: filters,
    response: { 200: { type: "object", additionalProperties: true }, 400: err, 403: err },
  } }, async request => controller.backtestLife(normalizeFilters({ ...request.body, incluirDemonstracao: false })));
  app.post<{ Params: { tipo: string }; Body: AnalyticsFilterBody }>("/api/v1/analytics/:tipo", { ...auth, schema: { tags: ["Analytics"], summary: "Executa e persiste uma análise GreenCode", security: [{ bearerAuth: [] }], params: { type: "object", required: ["tipo"], properties: { tipo: { type: "string", enum: ["eficiencia-operacional", "rentabilidade", "vida-util"] } } }, body: filters, response: { 200: { type: "object", additionalProperties: true }, 400: err, 403: err } } }, async request => controller.execute(request.params.tipo, normalizeFilters(request.body)));
  app.get<{ Params: { tipo: string }; Querystring: { organizacaoId?: string; limit?: number } }>("/api/v1/analytics/:tipo/historico", { ...auth, schema: { tags: ["Analytics"], summary: "Consulta execuções analíticas persistidas", security: [{ bearerAuth: [] }], params: { type: "object", required: ["tipo"], properties: { tipo: { type: "string", enum: ["eficiencia-operacional", "rentabilidade", "vida-util"] } } }, querystring: { type: "object", additionalProperties: false, properties: { organizacaoId: uuid, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } } }, response: { 200: { type: "array", items: { type: "object" } }, 403: err } } }, async request => {
    const rows = await controller.history(request.params.tipo, request.query.organizacaoId);
    return rows.slice(0, request.query.limit ?? 20);
  });

  const publicPre = (scope: "analytics:read" | "analytics:write") => async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = request.integrationIdentity!; const [partner, key] = await Promise.all([limiter.consume(`partner:${identity.parceiroId}`, identity.limiteParceiroPorMinuto), limiter.consume(`key:${identity.apiKeyId}`, identity.limiteChavePorMinuto)]);
    reply.header("X-RateLimit-Limit", String(identity.limiteRequisicoesPorMinuto))
      .header("X-RateLimit-Remaining", String(Math.min(partner.remaining, key.remaining)))
      .header("X-RateLimit-Reset", String(Math.ceil(Math.max(partner.resetAt, key.resetAt) / 1000)));
    if (!partner.allowed || !key.allowed) {
      const retry = Math.max(partner.allowed ? 0 : partner.retryAfterSeconds, key.allowed ? 0 : key.retryAfterSeconds);
      reply.header("Retry-After", String(retry));
      throw new DomainError(429, "RATE_LIMIT_EXCEEDED", "Limite de requisições por minuto excedido.", { retryAfterSeconds: retry });
    }
    if (!identity.escoposEfetivos.includes(scope)) throw errors.forbidden(`Escopo necessário: ${scope}.`);
    if (Buffer.byteLength(JSON.stringify(request.body ?? {}), "utf8") > identity.maxPayloadBytes) throw new DomainError(413, "PAYLOAD_TOO_LARGE", "Payload excede o limite efetivo da API Key.");
  };
  const typeParams = { type: "object", required: ["tipo"], properties: { tipo: { type: "string", enum: ["eficiencia-operacional", "rentabilidade", "vida-util"] } } } as const;
  const publicBody = { type: "object", additionalProperties: false, properties: { de: { type: "string", format: "date-time" }, ate: { type: "string", format: "date-time" } } } as const;
  const publicIntegrationHeader = { type: "object", additionalProperties: true, required: ["x-integration-id"], properties: { "x-integration-id": { type: "string", minLength: 1, maxLength: 64, description: "Identificador público parceiro-organização." } } } as const;
  app.post<{ Params: { tipo: string }; Body: PublicAnalyticsBody }>("/api/v1/public/analytics/:tipo", { onRequest: publicAuth, preHandler: [publicPre("analytics:write")], schema: { tags: ["API Pública", "Analytics"], summary: "Executa análise no escopo da integração autorizada", security: [{ apiKeyAuth: [] }], params: typeParams, headers: publicIntegrationHeader, body: publicBody, response: { 200: { type: "object", additionalProperties: true }, 401: err, 403: err, 404: err, 429: err } } }, async request => {
    const identity = request.integrationIdentity!;
    const integrationId = request.headers["x-integration-id"];
    if (typeof integrationId !== "string" || !integrationId.trim()) throw errors.badRequest("MISSING_INTEGRATION_HEADER", "Informe X-Integration-ID.");
    const body = request.body ?? {};
    const normalizedFilters = normalizeFilters({ de: body.de, ate: body.ate, incluirDemonstracao: false });
    return controller.executePublicByIntegration(request.params.tipo, normalizedFilters, identity, request.id, integrationId);
  });
  app.get<{ Params: { tipo: string }; Querystring: { limit?: number } }>("/api/v1/public/analytics/:tipo/historico", { onRequest: publicAuth, preHandler: [publicPre("analytics:read")], schema: { tags: ["API Pública", "Analytics"], summary: "Consulta análises persistidas da integração autorizada", security: [{ apiKeyAuth: [] }], params: typeParams, headers: publicIntegrationHeader, querystring: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } } }, response: { 200: { type: "array", items: { type: "object" } }, 401: err, 403: err, 404: err } } }, async request => {
    const integrationId = request.headers["x-integration-id"];
    if (typeof integrationId !== "string" || !integrationId.trim()) throw errors.badRequest("MISSING_INTEGRATION_HEADER", "Informe X-Integration-ID.");
    return controller.historyPublicByIntegration(request.params.tipo, request.integrationIdentity!, integrationId, request.query.limit ?? 20);
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
