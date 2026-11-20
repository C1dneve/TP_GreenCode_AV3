import type { PrismaClient } from "../../generated/prisma/client.js";
export class HistoricoEquipamentosRepository {
  constructor(private readonly prisma: PrismaClient) {}
  db() { return this.prisma as any; }
}
