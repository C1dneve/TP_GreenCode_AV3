import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { TriagemRepository } from "./triagem.repository.js";
import { TriagemService } from "./triagem.service.js";
import { registerTriagemRoutes } from "./routes.js";
export function registerTriagemModule(app: FastifyInstance, prisma: PrismaClient) { registerTriagemRoutes(app, new TriagemService(new TriagemRepository(prisma))); }
