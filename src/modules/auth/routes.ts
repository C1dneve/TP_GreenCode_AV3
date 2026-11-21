import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PapelUsuario } from "../../generated/prisma/client.js";
import { DomainError } from "../../shared/domain-error.js";
import type { AuthController } from "./auth.controller.js";
import type { AuthService, JwtIdentity } from "./auth.service.js";

declare module "@fastify/jwt" { interface FastifyJWT { payload: JwtIdentity; user: JwtIdentity } }
declare module "fastify" { interface FastifyInstance { authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void> } }
const userPublic = { type: "object", additionalProperties: false, required: ["id", "usuario", "nome", "papel", "ativo"], properties: { id: { type: "string", format: "uuid" }, usuario: { type: "string" }, nome: { type: "string" }, papel: { type: "string", enum: ["ADMINISTRADOR", "OPERADOR_CADASTRO", "GESTOR_ALMOXARIFADO", "AUDITOR"] }, ativo: { type: "boolean" }, ultimoAcesso: { type: "string", format: "date-time", nullable: true }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, versao: { type: "integer" } } } as const;
const errorRef = { $ref: "Erro#" } as const;

export function registerAuthRoutes(app: FastifyInstance, controller: AuthController, service: AuthService): void {
  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try { await request.jwtVerify<JwtIdentity>(); }
    catch { return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Autenticação inválida.", requestId: request.id } }); }
    try {
      const current = await service.validateIdentity(request.user);
      request.user.papel = current.papel as PapelUsuario;
    } catch (error) {
      if (error instanceof DomainError && error.statusCode === 401) return reply.code(401).send({ error: { code: error.code, message: error.message, requestId: request.id } });
      throw error;
    }
  });

  app.post("/api/v1/auth/login", { schema: { tags: ["Autenticação"], summary: "Autentica usuário e emite JWT válido por 30 minutos", description: "Endpoint de entrada sem autenticação prévia. Em caso de sucesso, use o accessToken no botão Authorize com o esquema Bearer. O segredo digitado não é retornado nem registrado em exemplos.", security: [], body: { type: "object", additionalProperties: false, required: ["usuario", "senha"], properties: { usuario: { type: "string", minLength: 1, maxLength: 80, examples: ["admin"] }, senha: { type: "string", minLength: 1, maxLength: 200, format: "password" } }, examples: [{ usuario: "admin", senha: "SENHA_LOCAL_CONFIGURADA" }] }, response: { 200: { type: "object", required: ["accessToken", "tokenType", "expiresIn", "usuario"], properties: { accessToken: { type: "string" }, tokenType: { type: "string", const: "Bearer" }, expiresIn: { type: "integer", const: 1800 }, usuario: userPublic }, examples: [{ accessToken: "JWT_EXEMPLO_NAO_UTILIZAR", tokenType: "Bearer", expiresIn: 1800, usuario: { id: "1d2c3b4a-5566-4788-8999-aabbccddeeff", usuario: "admin", nome: "Administrador", papel: "ADMINISTRADOR", ativo: true, ultimoAcesso: "2026-11-21T12:00:00.000Z", createdAt: "2026-11-20T12:00:00.000Z", updatedAt: "2026-11-21T12:00:00.000Z", versao: 1 } }] }, 400: errorRef, 401: errorRef } } }, async (request) => controller.login(request.body as { usuario: string; senha: string }, request.id));
  app.get("/api/v1/auth/me", { preHandler: app.authenticate, schema: { tags: ["Autenticação"], summary: "Retorna o usuário autenticado", description: "Valida o JWT e devolve apenas a identidade pública e o papel atual do usuário.", security: [{ bearerAuth: [] }], response: { 200: { ...userPublic, examples: [{ id: "1d2c3b4a-5566-4788-8999-aabbccddeeff", usuario: "admin", nome: "Administrador", papel: "ADMINISTRADOR", ativo: true, ultimoAcesso: "2026-11-21T12:00:00.000Z", createdAt: "2026-11-20T12:00:00.000Z", updatedAt: "2026-11-21T12:00:00.000Z", versao: 1 }] }, 401: errorRef } } }, async (request) => controller.me(request.user));
  app.post("/api/v1/auth/logout", { preHandler: app.authenticate, schema: { tags: ["Autenticação"], summary: "Revoga o token atual", description: "Encerra a sessão representada pelo JWT atual. O endpoint responde sem corpo.", security: [{ bearerAuth: [] }], response: { 204: { type: "null" }, 401: errorRef } } }, async (request, reply) => { await controller.logout(request.user, request.id); return reply.code(204).send(); });
  app.post("/api/v1/auth/change-password", { preHandler: app.authenticate, schema: { tags: ["Autenticação"], summary: "Altera a senha e invalida todas as sessões", description: "Exige a senha atual, uma nova senha com pelo menos 12 caracteres e a versão atual do usuário para controle otimista. Após a alteração, tokens anteriores ficam inválidos.", security: [{ bearerAuth: [] }], body: { type: "object", additionalProperties: false, required: ["senhaAtual", "novaSenha", "versaoEsperada"], properties: { senhaAtual: { type: "string", minLength: 1, maxLength: 200 }, novaSenha: { type: "string", minLength: 12, maxLength: 200 }, versaoEsperada: { type: "integer", minimum: 1, examples: [1] } }, examples: [{ senhaAtual: "SENHA_ATUAL_LOCAL", novaSenha: "NOVA_SENHA_FORTE_LOCAL", versaoEsperada: 1 }] }, response: { 204: { type: "null", description: "Senha alterada; sem corpo de resposta." }, 400: errorRef, 401: errorRef, 409: errorRef } } }, async (request, reply) => { await controller.changePassword(request.user, request.body as { senhaAtual: string; novaSenha: string; versaoEsperada: number }, request.id); return reply.code(204).send(); });
}
