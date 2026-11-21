import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ParceirosController } from "./parceiros.controller.js";
import { INTEGRATION_SCOPES } from "../integracoes/scopes.js";

const err = { $ref: "Erro#" } as const;
const uuid = { type: "string", format: "uuid" } as const;
const escopos = { type: "array", uniqueItems: true, items: { type: "string", enum: [...INTEGRATION_SCOPES] } } as const;
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

const partnerExample = {
  id: "1d2c3b4a-5566-4788-8999-aabbccddeeff", nome: "Parceiro ERP Exemplo", descricao: "Integração do sistema de recebimento.",
  ativo: true, escopos: ["lotes:write", "rastreabilidade:read"], limiteRequisicoesPorMinuto: 120,
  maxEquipamentosPorSubmissao: 100, maxPayloadBytes: 1048576, permiteLoteSemEquipamentos: true,
  createdAt: "2026-11-20T12:00:00.000Z", updatedAt: "2026-11-20T12:00:00.000Z",
};
const associationExample = {
  id: "8e9c33f3-6f0b-4fc4-9ab4-6ac4d1a0c123", parceiroId: partnerExample.id,
  organizacaoId: "b2a4ce10-70d8-4f17-8c93-bf16f229f6e1", identificadorPublico: "gci_0123456789abcdef0123456789abcdef",
  ativo: true, revogadoEm: null, createdAt: "2026-11-20T12:00:00.000Z", updatedAt: "2026-11-20T12:00:00.000Z",
  organizacao: { id: "b2a4ce10-70d8-4f17-8c93-bf16f229f6e1", razaoSocial: "Organização Exemplo Ltda.", cnpj: "00000000000191", ativo: true },
};
const keyExample = {
  id: "9c3e8a7b-9d5c-4a47-ae1d-0fd7d8de1234", parceiroId: partnerExample.id, nome: "Chave integração", prefixo: "gc_live_ab12cd34ef56a789",
  escopos: ["lotes:write", "rastreabilidade:read"], limiteRequisicoesPorMinuto: 60,
  maxEquipamentosPorSubmissao: 50, maxPayloadBytes: 524288, expiraEm: null, revogadaEm: null, ultimoUsoEm: null,
  createdAt: "2026-11-20T12:00:00.000Z", updatedAt: "2026-11-20T12:00:00.000Z",
};

export function registerParceirosRoutes(app: FastifyInstance, controller: ParceirosController) {
  const adminOnly = {
    preHandler: [app.authenticate, async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.user.papel !== "ADMINISTRADOR") return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Somente Administrador pode gerenciar parceiros e API Keys.", requestId: request.id } });
    }],
  };
  const paramsPartner = { type: "object", additionalProperties: false, required: ["parceiroId"], properties: { parceiroId: uuid } } as const;
  const paramsPartnerKey = { type: "object", additionalProperties: false, required: ["parceiroId", "apiKeyId"], properties: { parceiroId: uuid, apiKeyId: uuid } } as const;

  app.get("/api/v1/parceiros", { ...adminOnly, schema: {
    tags: ["Parceiros"], summary: "Lista parceiros com paginação e filtros", description: "Somente ADMINISTRADOR. q busca nome/descrição; ativo filtra estado. page começa em 1 e pageSize aceita até 100.", security: [{ bearerAuth: [] }],
    querystring: { type: "object", additionalProperties: false, properties: { page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 }, q: { type: "string", maxLength: 160 }, ativo: { type: "boolean" } } },
    response: { 200: { type: "object", required: ["data", "meta"], properties: { data: { type: "array", items: partner }, meta: { type: "object", required: ["page", "pageSize", "total", "totalPages"], properties: { page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } } } }, examples: [{ data: [partnerExample], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }] }, 401: err, 403: err },
  } }, async (request) => controller.list(request.query));

  app.post("/api/v1/parceiros", { ...adminOnly, schema: {
    tags: ["Parceiros"], summary: "Cadastra parceiro de integração", description: "Cria a política de escopos e limites do parceiro. Os limites individuais das API Keys não podem exceder os limites definidos aqui.", security: [{ bearerAuth: [] }],
    body: { type: "object", additionalProperties: false, required: ["nome"], properties: {
      nome: { type: "string", minLength: 1, maxLength: 160 }, descricao: { type: "string", maxLength: 1000 }, escopos,
      limiteRequisicoesPorMinuto: { type: "integer", minimum: 1, maximum: 10000 }, maxEquipamentosPorSubmissao: { type: "integer", minimum: 0, maximum: 5000 },
      maxPayloadBytes: { type: "integer", minimum: 1024, maximum: 10485760 }, permiteLoteSemEquipamentos: { type: "boolean" },
    }, examples: [{ nome: "Parceiro ERP Exemplo", descricao: "Integração do sistema de recebimento.", escopos: ["lotes:write", "rastreabilidade:read"], limiteRequisicoesPorMinuto: 120, maxEquipamentosPorSubmissao: 100, maxPayloadBytes: 1048576, permiteLoteSemEquipamentos: true }] }, response: { 201: { ...partner, examples: [partnerExample] }, 400: err, 401: err, 403: err },
  } }, async (request, reply) => { const created = await controller.create(request.body, request.user.sub, request.id); return reply.code(201).header("Location", `/api/v1/parceiros/${created.id}`).send(created); });

  app.get("/api/v1/parceiros/:parceiroId", { ...adminOnly, schema: { tags: ["Parceiros"], summary: "Consulta um parceiro", description: "Retorna somente metadados administrativos; não inclui API Keys nem segredos.", security: [{ bearerAuth: [] }], params: paramsPartner, response: { 200: { ...partner, examples: [partnerExample] }, 401: err, 403: err, 404: err } } }, async request => controller.get((request.params as { parceiroId: string }).parceiroId));

  app.patch("/api/v1/parceiros/:parceiroId", { ...adminOnly, schema: {
    tags: ["Parceiros"], summary: "Atualiza dados, escopos e limites do parceiro", description: "Atualização parcial. Envie somente os campos a alterar; é necessário ao menos um campo.", security: [{ bearerAuth: [] }], params: paramsPartner,
    body: { type: "object", additionalProperties: false, minProperties: 1, properties: {
      nome: { type: "string", minLength: 1, maxLength: 160 }, descricao: { type: ["string", "null"], maxLength: 1000 }, escopos,
      limiteRequisicoesPorMinuto: { type: "integer", minimum: 1, maximum: 10000 }, maxEquipamentosPorSubmissao: { type: "integer", minimum: 0, maximum: 5000 },
      maxPayloadBytes: { type: "integer", minimum: 1024, maximum: 10485760 }, permiteLoteSemEquipamentos: { type: "boolean" },
    }, examples: [{ limiteRequisicoesPorMinuto: 180, maxPayloadBytes: 2097152 }] }, response: { 200: { ...partner, examples: [partnerExample] }, 400: err, 401: err, 403: err, 404: err },
  } }, async request => controller.update((request.params as { parceiroId: string }).parceiroId, request.body, request.user.sub, request.id));

  for (const [action, active] of [["ativacao", true], ["desativacao", false]] as const) {
    app.post(`/api/v1/parceiros/:parceiroId/${action}`, { ...adminOnly, schema: { tags: ["Parceiros"], summary: active ? "Ativa parceiro" : "Desativa parceiro", description: active ? "Reativa parceiro para autenticações públicas, desde que chave e vínculo também estejam ativos." : "Bloqueia novas autenticações públicas sem apagar o histórico do parceiro.", security: [{ bearerAuth: [] }], params: paramsPartner, response: { 200: { ...partner, examples: [{ ...partnerExample, ativo: active }] }, 401: err, 403: err, 404: err, 409: err } } }, async request => controller.active((request.params as { parceiroId: string }).parceiroId, active, request.user.sub, request.id));
  }

  app.get("/api/v1/parceiros/:parceiroId/organizacoes", { ...adminOnly, schema: { tags: ["Parceiros"], summary: "Lista organizações vinculadas e seus identificadores públicos", description: "O identificador público é usado em X-Integration-ID; a listagem é administrativa e exige ADMINISTRADOR.", security: [{ bearerAuth: [] }], params: paramsPartner, response: { 200: { type: "array", items: association, examples: [[associationExample]] }, 401: err, 403: err, 404: err } } }, async request => controller.listOrganizations((request.params as { parceiroId: string }).parceiroId));

  app.post("/api/v1/parceiros/:parceiroId/organizacoes", { ...adminOnly, schema: {
    tags: ["Parceiros"], summary: "Autoriza uma organização para o parceiro", description: "Cria vínculo ativo e gera identificador público opaco para ser enviado nas chamadas da API externa.", security: [{ bearerAuth: [] }], params: paramsPartner,
    body: { type: "object", additionalProperties: false, required: ["organizacaoId"], properties: { organizacaoId: uuid }, examples: [{ organizacaoId: associationExample.organizacaoId }] },
    response: { 201: { ...association, examples: [associationExample] }, 400: err, 401: err, 403: err, 404: err, 409: err },
  } }, async (request, reply) => { const created = await controller.associateOrganization((request.params as { parceiroId: string }).parceiroId, (request.body as { organizacaoId: string }).organizacaoId, request.user.sub, request.id); return reply.code(201).send(created); });

  app.delete("/api/v1/parceiros/:parceiroId/organizacoes/:associacaoId", { ...adminOnly, schema: { tags: ["Parceiros"], summary: "Revoga vínculo do parceiro com uma organização sem apagar o histórico", description: "Revogação lógica; operações públicas deixam de reconhecer o identificador de integração.", security: [{ bearerAuth: [] }], params: { type: "object", additionalProperties: false, required: ["parceiroId", "associacaoId"], properties: { parceiroId: uuid, associacaoId: uuid } }, response: { 200: { ...association, examples: [{ ...associationExample, ativo: false, revogadoEm: "2026-11-21T12:00:00.000Z" }] }, 401: err, 403: err, 404: err, 409: err } } }, async request => { const p = request.params as { parceiroId: string; associacaoId: string }; return controller.revokeOrganization(p.parceiroId, p.associacaoId, request.user.sub, request.id); });

  app.get("/api/v1/parceiros/:parceiroId/chaves", { ...adminOnly, schema: { tags: ["API Keys"], summary: "Lista metadados das chaves sem revelar segredo ou hash", description: "O segredo integral não pode ser consultado; esta operação retorna prefixo, escopos, limites e estado.", security: [{ bearerAuth: [] }], params: paramsPartner, response: { 200: { type: "array", items: key, examples: [[keyExample]] }, 401: err, 403: err, 404: err } } }, async request => controller.listKeys((request.params as { parceiroId: string }).parceiroId));

  app.post("/api/v1/parceiros/:parceiroId/chaves", { ...adminOnly, schema: {
    tags: ["API Keys"], summary: "Cria API Key; o segredo completo é retornado somente nesta resposta", description: "O valor de segredo mostrado no exemplo é fictício. Guarde o segredo real no momento da criação; o GreenCode persiste apenas o hash e não permite recuperá-lo posteriormente.", security: [{ bearerAuth: [] }], params: paramsPartner,
    body: { type: "object", additionalProperties: false, required: ["nome", "escopos"], properties: {
      nome: { type: "string", minLength: 1, maxLength: 120 }, escopos,
      expiraEm: { type: "string", format: "date-time" }, limiteRequisicoesPorMinuto: { type: "integer", minimum: 1, maximum: 10000 },
      maxEquipamentosPorSubmissao: { type: "integer", minimum: 0, maximum: 5000 }, maxPayloadBytes: { type: "integer", minimum: 1024, maximum: 10485760 },
    }, examples: [{ nome: "Chave integração ERP", escopos: ["lotes:write", "rastreabilidade:read"], limiteRequisicoesPorMinuto: 60, maxEquipamentosPorSubmissao: 50, maxPayloadBytes: 524288 }] }, response: { 201: { type: "object", required: ["apiKey", "segredo"], properties: { apiKey: key, segredo: { type: "string" } }, examples: [{ apiKey: keyExample, segredo: "gc_live_EXEMPLO_NAO_UTILIZAR" }] }, 400: err, 401: err, 403: err, 404: err },
  } }, async (request, reply) => { const result = await controller.createKey((request.params as { parceiroId: string }).parceiroId, request.body, request.user.sub, request.id); return reply.code(201).send(result); });

  app.get("/api/v1/parceiros/:parceiroId/chaves/:apiKeyId", { ...adminOnly, schema: { tags: ["API Keys"], summary: "Consulta metadados de uma API Key", description: "Retorna somente metadados não secretos. O segredo não é recuperável após a criação.", security: [{ bearerAuth: [] }], params: paramsPartnerKey, response: { 200: { ...key, examples: [keyExample] }, 401: err, 403: err, 404: err } } }, async request => { const p = request.params as { parceiroId: string; apiKeyId: string }; return controller.getKey(p.parceiroId, p.apiKeyId); });

  app.patch("/api/v1/parceiros/:parceiroId/chaves/:apiKeyId", { ...adminOnly, schema: {
    tags: ["API Keys"], summary: "Atualiza escopos, validade, limites e metadados de uma API Key ativa", description: "Atualização parcial. Limites da chave devem permanecer iguais ou inferiores aos limites efetivos do parceiro.", security: [{ bearerAuth: [] }], params: paramsPartnerKey,
    body: { type: "object", additionalProperties: false, minProperties: 1, properties: {
      nome: { type: "string", minLength: 1, maxLength: 120 }, escopos,
      expiraEm: { type: ["string", "null"], format: "date-time" }, limiteRequisicoesPorMinuto: { type: ["integer", "null"], minimum: 1, maximum: 10000 },
      maxEquipamentosPorSubmissao: { type: ["integer", "null"], minimum: 0, maximum: 5000 }, maxPayloadBytes: { type: ["integer", "null"], minimum: 1024, maximum: 10485760 },
    }, examples: [{ escopos: ["lotes:write"], limiteRequisicoesPorMinuto: 30 }] }, response: { 200: { ...key, examples: [keyExample] }, 400: err, 401: err, 403: err, 404: err, 409: err },
  } }, async request => { const p = request.params as { parceiroId: string; apiKeyId: string }; return controller.updateKey(p.parceiroId, p.apiKeyId, request.body, request.user.sub, request.id); });

  app.post("/api/v1/parceiros/:parceiroId/chaves/:apiKeyId/revogacao", { ...adminOnly, schema: { tags: ["API Keys"], summary: "Revoga uma API Key específica", description: "Revogação imediata e auditada; as demais chaves do parceiro não são revogadas automaticamente.", security: [{ bearerAuth: [] }], params: paramsPartnerKey, response: { 200: { ...key, examples: [{ ...keyExample, revogadaEm: "2026-11-21T12:00:00.000Z" }] }, 401: err, 403: err, 404: err, 409: err } } }, async request => { const p = request.params as { parceiroId: string; apiKeyId: string }; return controller.revokeKey(p.parceiroId, p.apiKeyId, request.user.sub, request.id); });
}
