import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { ApiPublicaService } from "./api-publica.service.js";
import { ApiPublicaController } from "./api-publica.controller.js";
import { createApiKeyAuthenticator } from "./integration-auth.js";
import { registerApiPublicaRoutes } from "./routes.js";
export function registerApiPublicaModule(app: FastifyInstance, prisma: PrismaClient) {
  const service = new ApiPublicaService(prisma);
  const controller = new ApiPublicaController(service);
  const authenticate = createApiKeyAuthenticator(prisma);
  registerApiPublicaRoutes(app, controller, authenticate as (request: FastifyRequest, reply: FastifyReply) => Promise<void>);
}
