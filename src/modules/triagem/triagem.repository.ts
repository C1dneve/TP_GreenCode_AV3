import type { PrismaClient } from "../../generated/prisma/client.ts";
export class TriagemRepository {
  constructor(private readonly prisma: PrismaClient) {}
  db() { return this.prisma as any; }
}
