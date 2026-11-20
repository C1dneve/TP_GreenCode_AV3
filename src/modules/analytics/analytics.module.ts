import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { createApiKeyAuthenticator } from "../api-publica/integration-auth.js";
import { PrismaRateLimiter } from "../integracoes/rate-limiter.js";
import { AnalyticsController } from "./analytics.controller.js";
import { AnalyticsRepository } from "./analytics.repository.js";
import { registerAnalyticsRoutes } from "./routes.js";
export function registerAnalyticsModule(app: FastifyInstance, prisma: PrismaClient) { registerAnalyticsRoutes(app, new AnalyticsController(new AnalyticsRepository(prisma)), createApiKeyAuthenticator(prisma), new PrismaRateLimiter(prisma)); }
