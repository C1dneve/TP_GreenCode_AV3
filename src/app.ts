import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import jwt from "@fastify/jwt";
import type { PrismaClient } from "./generated/prisma/client.js";
import { registerAuthModule } from "./modules/auth/auth.module.js";
import { registerUsuariosModule } from "./modules/usuarios/usuarios.module.js";
import { registerOrganizacoesModule } from "./modules/organizacoes/organizacoes.module.js";
import { registerContratosModule } from "./modules/contratos/contratos.module.js";
import { registerLotesModule } from "./modules/lotes/lotes.module.js";
import { registerEquipamentosModule } from "./modules/equipamentos/equipamentos.module.js";
import { registerMovimentacoesModule } from "./modules/movimentacoes/movimentacoes.module.js";
import { registerAuditoriaConsultaModule } from "./modules/auditoria/auditoria-consulta.module.js";
import { registerRelatoriosModule } from "./modules/relatorios/relatorios.module.js";
import { registerParametrosModule } from "./modules/parametros/parametros.module.js";
import { registerParceirosModule } from "./modules/parceiros/parceiros.module.js";
import { registerApiPublicaModule } from "./modules/api-publica/api-publica.module.js";
import { registerAnalyticsModule } from "./modules/analytics/analytics.module.js";
import { registerRelatoriosAsyncModule } from "./modules/relatorios-async/relatorios-async.module.js";
import { registerTriagemModule } from "./modules/triagem/triagem.module.js";
import { registerHistoricoEquipamentosModule } from "./modules/historico-equipamentos/historico.module.js";







import { DomainError } from "./shared/domain-error.js";

interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface BuildAppOptions { prisma?: PrismaClient; jwtSecret?: string }

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    bodyLimit: 10_485_760,
    logger: process.env.NODE_ENV !== "test" ? { redact: { paths: ["req.headers.authorization", "req.headers.cookie", "req.headers.x-api-key", "req.headers['x-api-key']", "req.body.senha", "req.body.senhaAtual", "req.body.novaSenha", "req.body.accessToken", "req.body.password", "req.body.token", "*.senhaHash", "*.segredoHash", "*.segredo", "*.JWT_SECRET", "*.DATABASE_URL"], censor: "[REDACTED]" } } : false,
    disableRequestLogging: process.env.NODE_ENV === "test",
    requestIdHeader: "x-request-id",
    genReqId: () => `req-${randomUUID()}`,
  });

  app.register(swagger, {
    openapi: {
      info: {
      title: "GreenCode API — AV3",
      description:
        "API REST do GreenCode. Rotas internas usam JWT/RBAC; a API pública versionada utiliza API Keys, escopos e associações explícitas parceiro-organização.\n\n[Ver documento OpenAPI JSON](/docs/json)",
      version: "0.2.0",
    },
      servers: [{ url: "http://localhost:3000" }],
      tags: [
        { name: "Saúde", description: "Disponibilidade e estado básico do serviço." },
        { name: "Autenticação", description: "Login administrativo, identidade atual, encerramento e alteração de senha. Acesso interno com JWT." },
        { name: "Usuários", description: "Administração de contas e papéis de acesso internos." },
        { name: "Organizações", description: "Cadastro, consulta e manutenção de organizações atendidas." },
        { name: "Contratos", description: "Gestão de contratos e seus ciclos de vigência." },
        { name: "Parâmetros", description: "Parâmetros operacionais administrados internamente." },
        { name: "Parceiros", description: "Cadastro e gestão administrativa de parceiros de integração e vínculos com organizações. Requer JWT e papel ADMINISTRADOR." },
        { name: "API Keys", description: "Criação, atualização, consulta e revogação de credenciais de integração. O segredo integral é mostrado somente na criação." },
        { name: "API Pública", description: "Operações versionadas destinadas a sistemas parceiros. Requer X-API-Key, escopos efetivos e, quando aplicável, X-Integration-ID." },
        { name: "Rastreabilidade", description: "Consulta pública de lotes por identificador GreenCode ou referência externalId do parceiro." },
        { name: "Análises", description: "Eficiência operacional, estimativa de recuperação/rentabilidade, vida útil remanescente e histórico analítico." },
        { name: "Relatórios Assíncronos", description: "Solicitação, histórico, status, reprocessamento e download de relatórios CSV/JSON." },
        { name: "Relatórios", description: "Relatórios operacionais existentes do monólito." },
        { name: "Auditoria", description: "Consulta da trilha de eventos e ações auditadas." },
        { name: "Lotes", description: "Cadastro e ciclo operacional de lotes, incluindo triagem." },
        { name: "Equipamentos", description: "Cadastro, estado, rastreamento e dados operacionais de equipamentos." },
        { name: "Movimentações", description: "Registro e consulta de movimentações de equipamentos." },
      ],
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" }, apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key", description: "Segredo de API Key exibido uma única vez na criação. O valor completo não pode ser recuperado." } }, schemas: { UsuarioPublico: { type: "object", additionalProperties: false, required: ["id", "usuario", "nome", "papel", "ativo"], properties: { id: { type: "string", format: "uuid" }, usuario: { type: "string" }, nome: { type: "string" }, papel: { type: "string", enum: ["ADMINISTRADOR", "OPERADOR_CADASTRO", "GESTOR_ALMOXARIFADO", "AUDITOR"] }, ativo: { type: "boolean" }, ultimoAcesso: { type: "string", format: "date-time", nullable: true }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, versao: { type: "integer" } } } } },
    },
  });

  // Schemas usados por $ref nas rotas precisam estar registrados no Fastify,
  // não apenas declarados em openapi.components.schemas.
  app.addSchema({
    $id: "Erro",
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          details: {},
          requestId: { type: "string" },
        },
      },
    },
  });

  app.addSchema({
    $id: "UsuarioPublico",
    type: "object",
    additionalProperties: false,
    required: ["id", "usuario", "nome", "papel", "ativo"],
    properties: {
      id: { type: "string", format: "uuid" },
      usuario: { type: "string" },
      nome: { type: "string" },
      papel: { type: "string", enum: ["ADMINISTRADOR", "OPERADOR_CADASTRO", "GESTOR_ALMOXARIFADO", "AUDITOR"] },
      ativo: { type: "boolean" },
      ultimoAcesso: { type: "string", format: "date-time", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      versao: { type: "integer" },
    },
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof DomainError) {
      const body: ApiErrorBody = { error: { code: error.code, message: error.message, requestId: request.id } };
      if (error.details !== undefined) body.error.details = error.details;
      if (error.statusCode >= 500) request.log.error({ requestId: request.id, errorName: error.name }, "Falha inesperada na requisição");
      return reply.code(error.statusCode).send(body);
    }
    const validationError = Boolean((error as FastifyError & { validation?: unknown }).validation);
    const prismaCode = (error as FastifyError & { code?: string }).code;
    const mappedPrismaError = {
      P2002: { statusCode: 409, code: "UNIQUE_CONSTRAINT_CONFLICT", message: "A operação conflita com um registro existente." },
      P2003: { statusCode: 409, code: "REFERENTIAL_INTEGRITY_CONFLICT", message: "A operação viola um vínculo entre registros." },
      P2004: { statusCode: 409, code: "DATABASE_CONSTRAINT_CONFLICT", message: "A operação viola uma regra de integridade." },
      P2025: { statusCode: 404, code: "RESOURCE_NOT_FOUND", message: "O registro solicitado não foi encontrado." },
      P2034: { statusCode: 409, code: "CONCURRENT_MODIFICATION", message: "A operação conflitou com uma alteração concorrente." },
    }[prismaCode ?? ""];
    const statusCode = validationError ? 400 : mappedPrismaError?.statusCode ?? (error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500);
    const body: ApiErrorBody = {
      error: {
        code: validationError ? "VALIDATION_ERROR" : mappedPrismaError?.code ?? (statusCode === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR"),
        message: validationError
          ? "A requisição contém campos inválidos."
          : mappedPrismaError?.message ?? (statusCode === 500 ? "Ocorreu um erro interno." : "A requisição não pôde ser processada."),
        requestId: request.id,
      },
    };
    if (validationError) {
      body.error.details = (error as FastifyError & { validation?: Array<{ instancePath?: string; message?: string }> }).validation?.map((issue) => ({
        field: issue.instancePath || "/",
        reason: issue.message || "invalid",
      }));
    }
    if (statusCode === 500) request.log.error({ requestId: request.id, errorName: error.name, errorCode: error.code }, "Falha inesperada na requisição");
    reply.code(statusCode).send(body);
  });

  app.setNotFoundHandler(async (request, reply) => {
    reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Recurso não encontrado.",
        requestId: request.id,
      },
    });
  });

  app.register(async (instance: FastifyInstance) => {
    instance.get("/health", {
      schema: {
        tags: ["Saúde"],
        summary: "Verifica se o servidor HTTP está respondendo.",
        response: {
          200: {
            type: "object",
            required: ["status", "service"],
            properties: {
              status: { type: "string", const: "ok" },
              service: { type: "string", const: "greencode-api" },
            },
          },
        },
      },
    }, async () => ({ status: "ok", service: "greencode-api" }));
  });

  if (options.prisma && options.jwtSecret) {
    app.register(jwt, { secret: options.jwtSecret, sign: { algorithm: "HS256", expiresIn: "30m" }, verify: { algorithms: ["HS256"] } });
    app.register(async (instance) => {
      registerAuthModule(instance, options.prisma as PrismaClient);
      registerUsuariosModule(instance, options.prisma as PrismaClient);
      registerOrganizacoesModule(instance, options.prisma as PrismaClient);
      registerContratosModule(instance, options.prisma as PrismaClient);
      registerLotesModule(instance, options.prisma as PrismaClient);
      registerEquipamentosModule(instance, options.prisma as PrismaClient);
      registerMovimentacoesModule(instance, options.prisma as PrismaClient);
      registerAuditoriaConsultaModule(instance, options.prisma as PrismaClient);
      registerRelatoriosModule(instance, options.prisma as PrismaClient);
      registerParametrosModule(instance, options.prisma as PrismaClient);
      registerParceirosModule(instance, options.prisma as PrismaClient);
      registerApiPublicaModule(instance, options.prisma as PrismaClient);
      registerAnalyticsModule(instance, options.prisma as PrismaClient);
      registerRelatoriosAsyncModule(instance, options.prisma as PrismaClient);
      registerTriagemModule(instance, options.prisma as PrismaClient);
      registerHistoricoEquipamentosModule(instance, options.prisma as PrismaClient);
    });
  }

  app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      urls: [
        {
          url: "/docs/json",
          name: "GreenCode API",
        },
      ],
      docExpansion: "none",
      deepLinking: true,
      filter: true,
      displayRequestDuration: true,
      tagsSorter: "alpha",
      showExtensions: true,
      showCommonExtensions: true,
    },
    theme: {
      title: "GreenCode API — Documentação interativa",
      css: [{ filename: "greencode-theme.css", content: readFileSync(new URL("./docs/greencode-swagger.css", import.meta.url), "utf8") }],
      js: [{ filename: "greencode-swagger-sidebar.js", content: readFileSync(new URL("./docs/greencode-swagger-sidebar.js", import.meta.url), "utf8") }],
    },
  });
  return app;
}
