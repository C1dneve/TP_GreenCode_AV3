import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { createApiKeyAuthenticator } from "../api-publica/integration-auth.js";
import { PrismaRateLimiter } from "../integracoes/rate-limiter.js";
import { RelatoriosAsyncController } from "./relatorios-async.controller.js";
import { RelatoriosAsyncRepository } from "./relatorios-async.repository.js";
import { RelatoriosAsyncService } from "./relatorios-async.service.js";
import { registerRelatoriosAsyncRoutes } from "./routes.js";
export function registerRelatoriosAsyncModule(app: FastifyInstance, prisma: PrismaClient) { registerRelatoriosAsyncRoutes(app, new RelatoriosAsyncController(new RelatoriosAsyncService(new RelatoriosAsyncRepository(prisma))), createApiKeyAuthenticator(prisma), new PrismaRateLimiter(prisma)); }
