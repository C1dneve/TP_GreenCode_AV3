import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ParceirosController } from "./parceiros.controller.js";

const err = { $ref: "Erro#" } as const;
const uuid = { type: "string", format: "uuid" } as const;
const escopos = { type: "array", uniqueItems: true, items: { type: "string", enum: ["lotes:write", "rastreabilidade:read"] } } as const;
const partner = {
  type: "object", additionalProperties: false,
  required: ["id", "nome", "ativo", "escopos", "limiteRequisicoesPorMinuto", "maxEquipamentosPorSubmissao", "maxPayloadBytes", "permiteLoteSemEquipamentos", "createdAt", "updatedAt"],
  properties: {
    id: uuid, nome: { type: "string" }, descricao: { type: ["string", "null"] }, ativo: { type: "boolean" }, escopos,
    limiteRequisicoesPorMinuto: { type: "integer" }, maxEquipamentosPorSubmissao: { type: "integer" }, maxPayloadBytes: { type: "integer" },
    permiteLoteSemEquipamentos: { type: "boolean" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
  },
} as const;
const association = {
  type: "object", additionalProperties: false,
  required: ["id", "parceiroId", "organizacaoId", "identificadorPublico", "ativo", "createdAt", "updatedAt", "organizacao"],
  properties: {
    id: uuid, parceiroId: uuid, organizacaoId: uuid, identificadorPublico: { type: "string" }, ativo: { type: "boolean" },
    revogadoEm: { type: ["string", "null"], format: "date-time" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
    organizacao: { type: "object", additionalProperties: false, required: ["id", "razaoSocial", "cnpj", "ativo"], properties: {
      id: uuid, razaoSocial: { type: "string" }, cnpj: { type: "string" }, ativo: { type: "boolean" },
    } },
  },
} as const;
const key = {
  type: "object", additionalProperties: false,
  required: ["id", "parceiroId", "nome", "prefixo", "escopos", "createdAt", "updatedAt"],
  properties: {
    id: uuid, parceiroId: uuid, nome: { type: "string" }, prefixo: { type: "string" }, escopos,
    limiteRequisicoesPorMinuto: { type: ["integer", "null"] }, maxEquipamentosPorSubmissao: { type: ["integer", "null"] }, maxPayloadBytes: { type: ["integer", "null"] },
    expiraEm: { type: ["string", "null"], format: "date-time" }, revogadaEm: { type: ["string", "null"], format: "date-time" }, ultimoUsoEm: { type: ["string", "null"], format: "date-time" },
    createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
  },
} as const;

export function registerParceirosRoutes(app: FastifyInstance, controller: ParceirosController) {
  const adminOnly = {
    preHandler: [app.authenticate, async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.user.papel !== "ADMINISTRADOR") return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Somente Administrador pode gerenciar parceiros e API Keys.", requestId: request.id } });
    }],
  };
  const paramsPartner = { type: "object", additionalProperties: false, required: ["parceiroId"], properties: { parceiroId: uuid } } as const;
  const paramsPartnerKey = { type: "object", additionalProperties: false, required: ["parceiroId", "apiKeyId"], properties: { parceiroId: uuid, apiKeyId: uuid } } as const;

  app.get("/api/v1/parceiros", { ...adminOnly, schema: {
    tags: ["Parceiros"], summary: "Lista parceiros com paginação e filtros", security: [{ bearerAuth: [] }],
    querystring: { type: "object", additionalProperties: false, properties: { page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 }, q: { type: "string", maxLength: 160 }, ativo: { type: "boolean" } } },
    response: { 200: { type: "object", required: ["data", "meta"], properties: { data: { type: "array", items: partner }, meta: { type: "object", required: ["page", "pageSize", "total", "totalPages"], properties: { page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } } } } }, 401: err, 403: err },
  } }, async (request) => controller.list(request.query));

  app.post("/api/v1/parceiros", { ...adminOnly, schema: {
    tags: ["Parceiros"], summary: "Cadastra parceiro de integração", security: [{ bearerAuth: [] }],
    body: { type: "object", additionalProperties: false, required: ["nome"], properties: {
      nome: { type: "string", minLength: 1, maxLength: 160 }, descricao: { type: "string", maxLength: 1000 }, escopos,
      limiteRequisicoesPorMinuto: { type: "integer", minimum: 1, maximum: 10000 }, maxEquipamentosPorSubmissao: { type: "integer", minimum: 0, maximum: 5000 },
      maxPayloadBytes: { type: "integer", minimum: 1024, maximum: 10485760 }, permiteLoteSemEquipamentos: { type: "boolean" },
    } }, response: { 201: partner, 400: err, 401: err, 403: err },
  } }, async (request, reply) => { const created = await controller.create(request.body, request.user.sub, request.id); return reply.code(201).header("Location", `/api/v1/parceiros/${created.id}`).send(created); });

  app.get("/api/v1/parceiros/:parceiroId", { ...adminOnly, schema: { tags: ["Parceiros"], summary: "Consulta um parceiro", security: [{ bearerAuth: [] }], params: paramsPartner, response: { 200: partner, 401: err, 403: err, 404: err } } }, async request => controller.get((request.params as { parceiroId: string }).parceiroId));

  app.patch("/api/v1/parceiros/:parceiroId", { ...adminOnly, schema: {
    tags: ["Parceiros"], summary: "Atualiza dados, escopos e limites do parceiro", security: [{ bearerAuth: [] }], params: paramsPartner,
    body: { type: "object", additionalProperties: false, minProperties: 1, properties: {
      nome: { type: "string", minLength: 1, maxLength: 160 }, descricao: { type: ["string", "null"], maxLength: 1000 }, escopos,
      limiteRequisicoesPorMinuto: { type: "integer", minimum: 1, maximum: 10000 }, maxEquipamentosPorSubmissao: { type: "integer", minimum: 0, maximum: 5000 },
      maxPayloadBytes: { type: "integer", minimum: 1024, maximum: 10485760 }, permiteLoteSemEquipamentos: { type: "boolean" },
    } }, response: { 200: partner, 400: err, 401: err, 403: err, 404: err },
  } }, async request => controller.update((request.params as { parceiroId: string }).parceiroId, request.body, request.user.sub, request.id));

  for (const [action, active] of [["ativacao", true], ["desativacao", false]] as const) {
    app.post(`/api/v1/parceiros/:parceiroId/${action}`, { ...adminOnly, schema: { tags: ["Parceiros"], summary: active ? "Ativa parceiro" : "Desativa parceiro", security: [{ bearerAuth: [] }], params: paramsPartner, response: { 200: partner, 401: err, 403: err, 404: err, 409: err } } }, async request => controller.active((request.params as { parceiroId: string }).parceiroId, active, request.user.sub, request.id));
  }

  app.get("/api/v1/parceiros/:parceiroId/organizacoes", { ...adminOnly, schema: { tags: ["Parceiros"], summary: "Lista organizações vinculadas e seus identificadores públicos", security: [{ bearerAuth: [] }], params: paramsPartner, response: { 200: { type: "array", items: association }, 401: err, 403: err, 404: err } } }, async request => controller.listOrganizations((request.params as { parceiroId: string }).parceiroId));

  app.post("/api/v1/parceiros/:parceiroId/organizacoes", { ...adminOnly, schema: {
    tags: ["Parceiros"], summary: "Autoriza uma organização para o parceiro", security: [{ bearerAuth: [] }], params: paramsPartner,
    body: { type: "object", additionalProperties: false, required: ["organizacaoId"], properties: { organizacaoId: uuid } },
    response: { 201: association, 400: err, 401: err, 403: err, 404: err, 409: err },
  } }, async (request, reply) => { const created = await controller.associateOrganization((request.params as { parceiroId: string }).parceiroId, (request.body as { organizacaoId: string }).organizacaoId, request.user.sub, request.id); return reply.code(201).send(created); });

  app.delete("/api/v1/parceiros/:parceiroId/organizacoes/:associacaoId", { ...adminOnly, schema: { tags: ["Parceiros"], summary: "Revoga vínculo do parceiro com uma organização sem apagar o histórico", security: [{ bearerAuth: [] }], params: { type: "object", additionalProperties: false, required: ["parceiroId", "associacaoId"], properties: { parceiroId: uuid, associacaoId: uuid } }, response: { 200: association, 401: err, 403: err, 404: err, 409: err } } }, async request => { const p = request.params as { parceiroId: string; associacaoId: string }; return controller.revokeOrganization(p.parceiroId, p.associacaoId, request.user.sub, request.id); });

  app.get("/api/v1/parceiros/:parceiroId/chaves", { ...adminOnly, schema: { tags: ["API Keys"], summary: "Lista metadados das chaves sem revelar segredo ou hash", security: [{ bearerAuth: [] }], params: paramsPartner, response: { 200: { type: "array", items: key }, 401: err, 403: err, 404: err } } }, async request => controller.listKeys((request.params as { parceiroId: string }).parceiroId));

  app.post("/api/v1/parceiros/:parceiroId/chaves", { ...adminOnly, schema: {
    tags: ["API Keys"], summary: "Cria API Key; o segredo completo é retornado somente nesta resposta", security: [{ bearerAuth: [] }], params: paramsPartner,
    body: { type: "object", additionalProperties: false, required: ["nome", "escopos"], properties: {
      nome: { type: "string", minLength: 1, maxLength: 120 }, escopos,
      expiraEm: { type: "string", format: "date-time" }, limiteRequisicoesPorMinuto: { type: "integer", minimum: 1, maximum: 10000 },
      maxEquipamentosPorSubmissao: { type: "integer", minimum: 0, maximum: 5000 }, maxPayloadBytes: { type: "integer", minimum: 1024, maximum: 10485760 },
    } }, response: { 201: { type: "object", required: ["apiKey", "segredo"], properties: { apiKey: key, segredo: { type: "string" } } }, 400: err, 401: err, 403: err, 404: err },
  } }, async (request, reply) => { const result = await controller.createKey((request.params as { parceiroId: string }).parceiroId, request.body, request.user.sub, request.id); return reply.code(201).send(result); });

  app.get("/api/v1/parceiros/:parceiroId/chaves/:apiKeyId", { ...adminOnly, schema: { tags: ["API Keys"], summary: "Consulta metadados de uma API Key", security: [{ bearerAuth: [] }], params: paramsPartnerKey, response: { 200: key, 401: err, 403: err, 404: err } } }, async request => { const p = request.params as { parceiroId: string; apiKeyId: string }; return controller.getKey(p.parceiroId, p.apiKeyId); });

  app.patch("/api/v1/parceiros/:parceiroId/chaves/:apiKeyId", { ...adminOnly, schema: {
    tags: ["API Keys"], summary: "Atualiza escopos, validade, limites e metadados de uma API Key ativa", security: [{ bearerAuth: [] }], params: paramsPartnerKey,
    body: { type: "object", additionalProperties: false, minProperties: 1, properties: {
      nome: { type: "string", minLength: 1, maxLength: 120 }, escopos,
      expiraEm: { type: ["string", "null"], format: "date-time" }, limiteRequisicoesPorMinuto: { type: ["integer", "null"], minimum: 1, maximum: 10000 },
      maxEquipamentosPorSubmissao: { type: ["integer", "null"], minimum: 0, maximum: 5000 }, maxPayloadBytes: { type: ["integer", "null"], minimum: 1024, maximum: 10485760 },
    } }, response: { 200: key, 400: err, 401: err, 403: err, 404: err, 409: err },
  } }, async request => { const p = request.params as { parceiroId: string; apiKeyId: string }; return controller.updateKey(p.parceiroId, p.apiKeyId, request.body, request.user.sub, request.id); });

  app.post("/api/v1/parceiros/:parceiroId/chaves/:apiKeyId/revogacao", { ...adminOnly, schema: { tags: ["API Keys"], summary: "Revoga uma API Key específica", security: [{ bearerAuth: [] }], params: paramsPartnerKey, response: { 200: key, 401: err, 403: err, 404: err, 409: err } } }, async request => { const p = request.params as { parceiroId: string; apiKeyId: string }; return controller.revokeKey(p.parceiroId, p.apiKeyId, request.user.sub, request.id); });
}
