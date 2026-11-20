import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { errors } from "../../shared/domain-error.js";
import { parseApiKey, verifyApiSecret } from "../integracoes/api-key-security.js";
import { effectiveScopes } from "../integracoes/scopes.js";

export interface IntegrationIdentity {
  parceiroId: string;
  apiKeyId: string;
  escoposEfetivos: string[];
  limiteRequisicoesPorMinuto: number;
  limiteParceiroPorMinuto: number;
  limiteChavePorMinuto: number;
  maxEquipamentosPorSubmissao: number;
  maxPayloadBytes: number;
  permiteLoteSemEquipamentos: boolean;
}

declare module "fastify" {
  interface FastifyRequest { integrationIdentity?: IntegrationIdentity }
}

export function createApiKeyAuthenticator(prisma: PrismaClient) {
  return async function authenticateApiKey(request: FastifyRequest, _reply: FastifyReply) {
    const credential = parseApiKey(request.headers["x-api-key"]);
    if (!credential) throw errors.unauthorized("INVALID_API_KEY", "API Key ausente ou inválida.");
    const apiKey = await prisma.apiKey.findUnique({ where: { prefixo: credential.prefixo }, include: { parceiro: true } });
    const now = new Date();
    if (!apiKey || !verifyApiSecret(credential.segredo, apiKey.segredoHash) || apiKey.revogadaEm || (apiKey.expiraEm && apiKey.expiraEm <= now) || !apiKey.parceiro.ativo) {
      throw errors.unauthorized("INVALID_API_KEY", "API Key ausente, inválida, expirada, revogada ou inativa.");
    }
    request.integrationIdentity = {
      parceiroId: apiKey.parceiroId,
      apiKeyId: apiKey.id,
      escoposEfetivos: effectiveScopes(apiKey.parceiro.escopos, apiKey.escopos),
      limiteRequisicoesPorMinuto: Math.min(apiKey.parceiro.limiteRequisicoesPorMinuto, apiKey.limiteRequisicoesPorMinuto ?? apiKey.parceiro.limiteRequisicoesPorMinuto),
      limiteParceiroPorMinuto: apiKey.parceiro.limiteRequisicoesPorMinuto,
      limiteChavePorMinuto: apiKey.limiteRequisicoesPorMinuto ?? apiKey.parceiro.limiteRequisicoesPorMinuto,
      maxEquipamentosPorSubmissao: Math.min(apiKey.parceiro.maxEquipamentosPorSubmissao, apiKey.maxEquipamentosPorSubmissao ?? apiKey.parceiro.maxEquipamentosPorSubmissao),
      maxPayloadBytes: Math.min(apiKey.parceiro.maxPayloadBytes, apiKey.maxPayloadBytes ?? apiKey.parceiro.maxPayloadBytes),
      permiteLoteSemEquipamentos: apiKey.parceiro.permiteLoteSemEquipamentos,
    };
    await prisma.apiKey.update({ where: { id: apiKey.id }, data: { ultimoUsoEm: now } });
  };
}
