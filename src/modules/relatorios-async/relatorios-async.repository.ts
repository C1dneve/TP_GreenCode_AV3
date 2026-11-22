import type { PrismaClient } from "../../generated/prisma/client.ts";
export class RelatoriosAsyncRepository {
  constructor(private readonly prisma: PrismaClient) {}
  db() { return this.prisma as any; }
}
