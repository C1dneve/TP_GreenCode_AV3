import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { HistoricoEquipamentosRepository } from "./historico.repository.js";
import { HistoricoEquipamentosService } from "./historico.service.js";
import { registerHistoricoEquipamentosRoutes } from "./routes.js";
export function registerHistoricoEquipamentosModule(app: FastifyInstance, prisma: PrismaClient) { registerHistoricoEquipamentosRoutes(app, new HistoricoEquipamentosService(new HistoricoEquipamentosRepository(prisma))); }
