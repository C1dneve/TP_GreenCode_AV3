import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { ParceirosController } from "./parceiros.controller.js";
import { ParceirosService } from "./parceiros.service.js";
import { registerParceirosRoutes } from "./routes.js";
export function registerParceirosModule(app: FastifyInstance, prisma: PrismaClient) {
  registerParceirosRoutes(app, new ParceirosController(new ParceirosService(prisma)));
}
