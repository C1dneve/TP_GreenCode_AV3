import "dotenv/config";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { buildApp } from "../../app.js";
import { createPrismaClient } from "../../infrastructure/database/prisma.js";
import { hashApiSecret } from "../../modules/integracoes/api-key-security.js";
import { INTEGRATION_SCOPES } from "../../modules/integracoes/scopes.js";

const databaseUrl = process.env.DATABASE_URL;
const previousNodeEnv = process.env.NODE_ENV;
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const actorId = randomUUID();
const adminUsername = `public-api-e2e-${suffix}`;
const adminPassword = `Public-E2E-${randomUUID()}-Ok`;
const jwtSecret = "public-api-integration-only-jwt-secret-with-more-than-32-bytes";
const organizationIds: string[] = [];
const partnerIds: string[] = [];
const associationIds: string[] = [];
const keyIds: string[] = [];
const lotIds: string[] = [];
let prisma: PrismaClient | undefined;
let app: FastifyInstance | undefined;
let fixtureCreated = false;

function validCnpj(): string {
  const base = String(randomInt(0, 1_000_000_000_000)).padStart(12, "0");
  const digit = (value: string, weights: number[]) => {
    const sum = [...value].reduce((total, char, index) => total + Number(char) * weights[index]!, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const first = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = digit(`${base}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${first}${second}`;
}

function adminHeaders(token: string) { return { authorization: `Bearer ${token}` }; }

async function createOrganization(token: string, label: string): Promise<{ id: string; cnpj: string }> {
  assert.ok(app);
  const cnpj = validCnpj();
  const email = `organizacao-${organizationIds.length + 1}-${suffix}@example.test`;
  const response = await app.inject({
    method: "POST", url: "/api/v1/organizacoes", headers: adminHeaders(token),
    payload: { razaoSocial: `${label} ${suffix}`, cnpj, email },
  });
  assert.equal(response.statusCode, 201, response.body);
  const id = response.json().id as string;
  organizationIds.push(id);
  return { id, cnpj };
}

async function createPartner(token: string, name: string, limits: Record<string, number> = {}, scopes: readonly string[] = ["lotes:write", "rastreabilidade:read"]) {
  assert.ok(app);
  const response = await app.inject({
    method: "POST", url: "/api/v1/parceiros", headers: adminHeaders(token),
    payload: { nome: `${name} ${suffix}`, escopos: [...scopes], ...limits },
  });
  assert.equal(response.statusCode, 201, response.body);
  const partner = response.json();
  partnerIds.push(partner.id as string);
  return partner as { id: string; escopos: string[] };
}

async function associate(token: string, partnerId: string, organizationId: string) {
  assert.ok(app);
  const response = await app.inject({
    method: "POST", url: `/api/v1/parceiros/${partnerId}/organizacoes`, headers: adminHeaders(token),
    payload: { organizacaoId: organizationId },
  });
  assert.equal(response.statusCode, 201, response.body);
  const association = response.json();
  associationIds.push(association.id as string);
  return association as { id: string; identificadorPublico: string };
}

async function createKey(token: string, partnerId: string, name: string, scopes: string[], limits: Record<string, number> = {}) {
  assert.ok(app);
  const response = await app.inject({
    method: "POST", url: `/api/v1/parceiros/${partnerId}/chaves`, headers: adminHeaders(token),
    payload: { nome: name, escopos: scopes, ...limits },
  });
  assert.equal(response.statusCode, 201, response.body);
  const result = response.json();
  keyIds.push(result.apiKey.id as string);
  return { id: result.apiKey.id as string, secret: result.segredo as string };
}

function publicHeaders(key: string, integrationId?: string, idempotencyKey?: string) {
  return {
    "x-api-key": key,
    ...(integrationId ? { "x-integration-id": integrationId } : {}),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
  };
}

before(async () => {
  if (!databaseUrl) throw new Error("Integração API pública bloqueada: DATABASE_URL deve apontar para uma base dedicada com 'test' no nome.");
  const parsed = new URL(databaseUrl);
  const configuredName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/(^|[_-])test($|[_-])/i.test(configuredName)) throw new Error("Segurança: integração API pública recusada porque o nome da base não contém 'test'.");

  prisma = createPrismaClient(databaseUrl);
  await prisma.$connect();
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  if (!rows[0]?.name || !/(^|[_-])test($|[_-])/i.test(rows[0].name)) {
    await prisma.$disconnect();
    prisma = undefined;
    throw new Error("Segurança: a conexão real não corresponde a uma base de teste.");
  }

  const senhaHash = await bcrypt.hash(adminPassword, 4);
  await prisma.usuario.create({
    data: { id: actorId, usuario: adminUsername, nome: "Administrador API pública E2E", senhaHash, papel: "ADMINISTRADOR", ativo: true },
  });
  fixtureCreated = true;
  process.env.NODE_ENV = "test";
  app = buildApp({ prisma, jwtSecret });
  await app.ready();
});

after(async () => {
  if (app) await app.close();
  if (!prisma) return;
  try {
    if (fixtureCreated) {
      // Inclui lotes criados antes de uma asserção falhar, mesmo que ainda não tenham
      // sido registrados em lotIds. Isso evita deixar resíduos que bloqueiem a exclusão da organização.
      const persistedLots = organizationIds.length
        ? await prisma.lote.findMany({ where: { organizacaoId: { in: organizationIds } }, select: { id: true } })
        : [];
      const cleanupLotIds = [...new Set([...lotIds, ...persistedLots.map((lot) => lot.id)])];

      await prisma.eventoAuditoria.deleteMany({ where: {
        OR: [
          { atorUsuarioId: actorId },
          { parceiroId: { in: partnerIds } },
          { apiKeyId: { in: keyIds } },
          { organizacaoId: { in: organizationIds } },
          { entidadeId: { in: [...organizationIds, ...partnerIds, ...associationIds, ...cleanupLotIds, ...keyIds] } },
        ],
      } });
      if (partnerIds.length) {
        await prisma.requisicaoIdempotencia.deleteMany({ where: { parceiroId: { in: partnerIds } } });
        await prisma.referenciaExternaParceiro.deleteMany({ where: { parceiroId: { in: partnerIds } } });
        await prisma.apiKey.deleteMany({ where: { parceiroId: { in: partnerIds } } });
        await prisma.parceiroOrganizacao.deleteMany({ where: { parceiroId: { in: partnerIds } } });
      }
      if (cleanupLotIds.length) {
        // Também remove dependências por lote, inclusive em caso de falha parcial do teste.
        await prisma.requisicaoIdempotencia.deleteMany({ where: { loteId: { in: cleanupLotIds } } });
        await prisma.referenciaExternaParceiro.deleteMany({ where: { loteId: { in: cleanupLotIds } } });
        await prisma.equipamento.deleteMany({ where: { loteId: { in: cleanupLotIds } } });
        await prisma.lote.deleteMany({ where: { id: { in: cleanupLotIds } } });
      }
      if (partnerIds.length) await prisma.parceiro.deleteMany({ where: { id: { in: partnerIds } } });
      if (organizationIds.length) await prisma.organizacao.deleteMany({ where: { id: { in: organizationIds } } });
      await prisma.tokenRevogado.deleteMany({ where: { usuarioId: actorId } });
      await prisma.usuario.deleteMany({ where: { id: actorId } });
    }
  } finally {
    await prisma.$disconnect();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("API pública: parceiros, chaves, escopos, limites, idempotência, rastreabilidade e isolamento", async () => {
  assert.ok(app);
  assert.ok(prisma);
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { usuario: adminUsername, senha: adminPassword } });
  assert.equal(login.statusCode, 200, login.body);
  const token = login.json().accessToken as string;

  const organizationA = await createOrganization(token, "Organização Parceiro A");
  const organizationB = await createOrganization(token, "Organização Parceiro B");
  const partnerA = await createPartner(token, "Parceiro A", { limiteRequisicoesPorMinuto: 20, maxEquipamentosPorSubmissao: 3 });
  const partnerB = await createPartner(token, "Parceiro B");

  // Exercita os seis escopos ponta a ponta em cadastro e atualização.
  const allScopesPartner = await createPartner(token, "Parceiro seis escopos", {}, INTEGRATION_SCOPES);
  assert.deepEqual([...allScopesPartner.escopos].sort(), [...INTEGRATION_SCOPES].sort());
  const allScopesPartnerUpdate = await app.inject({
    method: "PATCH", url: `/api/v1/parceiros/${allScopesPartner.id}`, headers: adminHeaders(token),
    payload: { escopos: [...INTEGRATION_SCOPES] },
  });
  assert.equal(allScopesPartnerUpdate.statusCode, 200, allScopesPartnerUpdate.body);
  assert.deepEqual([...allScopesPartnerUpdate.json().escopos].sort(), [...INTEGRATION_SCOPES].sort());
  const allScopesKey = await createKey(token, allScopesPartner.id, "API Key seis escopos", [...INTEGRATION_SCOPES]);
  const allScopesKeyUpdate = await app.inject({
    method: "PATCH", url: `/api/v1/parceiros/${allScopesPartner.id}/chaves/${allScopesKey.id}`, headers: adminHeaders(token),
    payload: { escopos: [...INTEGRATION_SCOPES] },
  });
  assert.equal(allScopesKeyUpdate.statusCode, 200, allScopesKeyUpdate.body);
  assert.deepEqual([...allScopesKeyUpdate.json().escopos].sort(), [...INTEGRATION_SCOPES].sort());
  const partnerDetails = await app.inject({ method: "GET", url: `/api/v1/parceiros/${partnerA.id}`, headers: adminHeaders(token) });
  assert.equal(partnerDetails.statusCode, 200, partnerDetails.body);
  const defaultPartnerDetails = await app.inject({ method: "GET", url: `/api/v1/parceiros/${partnerB.id}`, headers: adminHeaders(token) });
  assert.equal(defaultPartnerDetails.statusCode, 200, defaultPartnerDetails.body);
  assert.equal(defaultPartnerDetails.json().limiteRequisicoesPorMinuto, 60);
  assert.equal(defaultPartnerDetails.json().maxEquipamentosPorSubmissao, 100);
  assert.equal(defaultPartnerDetails.json().maxPayloadBytes, 1_048_576);
  const partnerList = await app.inject({ method: "GET", url: "/api/v1/parceiros?page=1&pageSize=100", headers: adminHeaders(token) });
  assert.equal(partnerList.statusCode, 200, partnerList.body);
  assert.ok(partnerList.json().data.some((item: { id: string }) => item.id === partnerA.id));
  const partnerUpdate = await app.inject({ method: "PATCH", url: `/api/v1/parceiros/${partnerA.id}`, headers: adminHeaders(token), payload: { descricao: "Parceiro de testes" } });
  assert.equal(partnerUpdate.statusCode, 200, partnerUpdate.body);
  assert.equal(partnerUpdate.json().descricao, "Parceiro de testes");
  const associationA = await associate(token, partnerA.id, organizationA.id);
  const associationList = await app.inject({ method: "GET", url: `/api/v1/parceiros/${partnerA.id}/organizacoes`, headers: adminHeaders(token) });
  assert.equal(associationList.statusCode, 200, associationList.body);
  assert.equal(associationList.json()[0].identificadorPublico, associationA.identificadorPublico);
  const associationB = await associate(token, partnerB.id, organizationB.id);

  const writeKey = await createKey(token, partnerA.id, "somente escrita", ["lotes:write"]);
  const readKey = await createKey(token, partnerA.id, "somente leitura", ["rastreabilidade:read"]);
  const anotherReadKey = await createKey(token, partnerA.id, "segunda chave de leitura", ["rastreabilidade:read"]);
  const overScopedKey = await createKey(token, partnerA.id, "escopo maior que parceiro", ["lotes:write", "rastreabilidade:read"]);
  const expiringKey = await createKey(token, partnerA.id, "chave expirada", ["rastreabilidade:read"]);
  await prisma.apiKey.update({ where: { id: expiringKey.id }, data: { expiraEm: new Date(Date.now() - 1_000) } });
  const expiredAuth = await app.inject({ method: "GET", url: "/api/v1/public/rastreabilidade/lotes/nao-existe", headers: publicHeaders(expiringKey.secret) });
  assert.equal(expiredAuth.statusCode, 401, expiredAuth.body);
  const invalidAuth = await app.inject({ method: "GET", url: "/api/v1/public/rastreabilidade/lotes/nao-existe", headers: publicHeaders(`${writeKey.secret}x`) });
  assert.equal(invalidAuth.statusCode, 401, invalidAuth.body);
  const partnerBKey = await createKey(token, partnerB.id, "leitura parceiro B", ["rastreabilidade:read"]);
  const partnerBWriteKey = await createKey(token, partnerB.id, "escrita parceiro B", ["lotes:write"]);

  const stored = await prisma.apiKey.findUnique({ where: { id: writeKey.id } });
  assert.ok(stored);
  assert.equal(stored.segredoHash, hashApiSecret(writeKey.secret.split(".")[1]!));
  assert.notEqual(stored.segredoHash, writeKey.secret);
  const metadata = await app.inject({ method: "GET", url: `/api/v1/parceiros/${partnerA.id}/chaves/${writeKey.id}`, headers: adminHeaders(token) });
  assert.equal(metadata.statusCode, 200, metadata.body);
  assert.equal("segredo" in metadata.json(), false);
  assert.equal("segredoHash" in metadata.json(), false);
  assert.equal(metadata.body.includes(writeKey.secret), false);

  const editableKey = await createKey(token, partnerA.id, "chave editável", ["lotes:write"]);
  const keyUpdate = await app.inject({
    method: "PATCH", url: `/api/v1/parceiros/${partnerA.id}/chaves/${editableKey.id}`, headers: adminHeaders(token),
    payload: { nome: "chave somente leitura", escopos: ["rastreabilidade:read"], limiteRequisicoesPorMinuto: 10 },
  });
  assert.equal(keyUpdate.statusCode, 200, keyUpdate.body);
  assert.deepEqual(keyUpdate.json().escopos, ["rastreabilidade:read"]);
  assert.equal(keyUpdate.json().nome, "chave somente leitura");
  assert.equal(keyUpdate.json().limiteRequisicoesPorMinuto, 10);
  const updatedKeyMetadata = await app.inject({ method: "GET", url: `/api/v1/parceiros/${partnerA.id}/chaves/${editableKey.id}`, headers: adminHeaders(token) });
  assert.equal(updatedKeyMetadata.statusCode, 200, updatedKeyMetadata.body);
  assert.equal("segredoHash" in updatedKeyMetadata.json(), false);

  const internalLot = await app.inject({
    method: "POST", url: "/api/v1/lotes", headers: adminHeaders(token),
    payload: { organizacaoId: organizationA.id, dataEntrada: new Date().toISOString(), notaFiscal: `INTERNAL-${suffix}`, transportadora: "Transportadora teste" },
  });
  assert.equal(internalLot.statusCode, 201, internalLot.body);
  lotIds.push(internalLot.json().id as string);
  const internalPublicId = internalLot.json().publicId as string;
  assert.match(internalPublicId, /^gcl_/);

  const noWriteScope = await app.inject({
    method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(readKey.secret, associationA.identificadorPublico, `scope-${suffix}`),
    payload: { notaFiscal: "NF-SCOPE", transportadora: "Transportadora" },
  });
  assert.equal(noWriteScope.statusCode, 403, noWriteScope.body);

  const body = {
    externalId: `external-${suffix}`,
    notaFiscal: `NF-${suffix}`,
    transportadora: "Transportadora externa",
    observacoes: "Submissão de teste sem PII",
  };
  const first = await app.inject({
    method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(writeKey.secret, associationA.identificadorPublico, `idem-${suffix}`), payload: body,
  });
  assert.equal(first.statusCode, 201, first.body);
  const publicId = first.json().identificadorPublico as string;
  assert.match(publicId, /^gcl_/);
  assert.equal(first.json().quantidadeEquipamentos, 0);
  assert.equal(first.json().status, "RECEBIDO");
  lotIds.push((await prisma.lote.findUnique({ where: { publicId }, select: { id: true } }))!.id);

  const replay = await app.inject({
    method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(writeKey.secret, associationA.identificadorPublico, `idem-${suffix}`), payload: { transportadora: body.transportadora, notaFiscal: body.notaFiscal, externalId: body.externalId, observacoes: body.observacoes },
  });
  assert.equal(replay.statusCode, 201, replay.body);
  assert.equal(replay.json().identificadorPublico, publicId);

  const keyConflict = await app.inject({
    method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(writeKey.secret, associationA.identificadorPublico, `idem-${suffix}`), payload: { ...body, notaFiscal: "NF-DIVERGENTE" },
  });
  assert.equal(keyConflict.statusCode, 409, keyConflict.body);

  const externalReplay = await app.inject({
    method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(writeKey.secret, associationA.identificadorPublico, `idem-second-${suffix}`), payload: body,
  });
  assert.equal(externalReplay.statusCode, 201, externalReplay.body);
  assert.equal(externalReplay.json().identificadorPublico, publicId);

  const concurrentKey = `idem-concurrent-${suffix}`;
  const concurrentBody = { notaFiscal: `NF-CONCURRENT-${suffix}`, transportadora: "Transportadora concorrente" };
  const concurrentResults = await Promise.all([1, 2].map(() => app!.inject({ method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(writeKey.secret, associationA.identificadorPublico, concurrentKey), payload: concurrentBody })));
  assert.equal(concurrentResults[0]!.statusCode, 201, concurrentResults[0]!.body);
  assert.equal(concurrentResults[1]!.statusCode, 201, concurrentResults[1]!.body);
  assert.equal(concurrentResults[0]!.json().identificadorPublico, concurrentResults[1]!.json().identificadorPublico);
  lotIds.push((await prisma.lote.findUnique({ where: { publicId: concurrentResults[0]!.json().identificadorPublico }, select: { id: true } }))!.id);

  const externalConflict = await app.inject({
    method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(writeKey.secret, associationA.identificadorPublico, `idem-third-${suffix}`), payload: { ...body, transportadora: "Outra transportadora" },
  });
  assert.equal(externalConflict.statusCode, 409, externalConflict.body);

  const withEquipment = await app.inject({
    method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(writeKey.secret, associationA.identificadorPublico, `equipment-${suffix}`),
    payload: {
      notaFiscal: `NF-EQ-${suffix}`, transportadora: "Transportadora equipamento", equipamentos: [
        { tipo: "NOTEBOOK", marca: "GreenCode", modelo: "Notebook E2E", anoFabricacao: 2024, estadoFisico: "BOM_ESTADO", pesoQuilogramas: "2.500", valorAquisicao: "800.00" },
      ],
    },
  });
  assert.equal(withEquipment.statusCode, 201, withEquipment.body);
  assert.equal(withEquipment.json().quantidadeEquipamentos, 1);
  assert.equal(withEquipment.json().equipamentos[0].statusRastreamento, "AGUARDANDO_TRIAGEM");
  const equipmentPublicId = withEquipment.json().identificadorPublico as string;
  lotIds.push((await prisma.lote.findUnique({ where: { publicId: equipmentPublicId }, select: { id: true } }))!.id);

  const strictKey = await createKey(token, partnerA.id, "limites por chave", ["lotes:write"], { maxEquipamentosPorSubmissao: 0, maxPayloadBytes: 1024, limiteRequisicoesPorMinuto: 10 });
  const invalidEquipment = await app.inject({
    method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(writeKey.secret, associationA.identificadorPublico, `invalid-equipment-${suffix}`),
    payload: { notaFiscal: "NF-INVALID", transportadora: "Transportadora", equipamentos: [{ tipo: "TIPO_INVALIDO", marca: "M", modelo: "M", anoFabricacao: 2024, estadoFisico: "BOM_ESTADO", pesoQuilogramas: "1" }] },
  });
  assert.equal(invalidEquipment.statusCode, 400, invalidEquipment.body);
  const equipmentLimit = await app.inject({
    method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(strictKey.secret, associationA.identificadorPublico, `equipment-limit-${suffix}`),
    payload: { notaFiscal: "NF-LIMIT", transportadora: "Transportadora", equipamentos: [{ tipo: "NOTEBOOK", marca: "M", modelo: "M", anoFabricacao: 2024, estadoFisico: "BOM_ESTADO", pesoQuilogramas: "1" }] },
  });
  assert.equal(equipmentLimit.statusCode, 429, equipmentLimit.body);
  const payloadLimit = await app.inject({
    method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(strictKey.secret, associationA.identificadorPublico, `payload-limit-${suffix}`),
    payload: { notaFiscal: "NF-PAYLOAD", transportadora: "Transportadora", observacoes: "x".repeat(1500) },
  });
  assert.equal(payloadLimit.statusCode, 413, payloadLimit.body);
  const payloadLimitWhitespace = await app.inject({
    method: "POST", url: "/api/v1/public/lotes", headers: { ...publicHeaders(strictKey.secret, associationA.identificadorPublico, `payload-whitespace-${suffix}`), "content-type": "application/json" },
    payload: `${" ".repeat(1200)}${JSON.stringify({ notaFiscal: "NF-WHITESPACE", transportadora: "T" })}`,
  });
  assert.equal(payloadLimitWhitespace.statusCode, 413, payloadLimitWhitespace.body);

  const readByExternal = await app.inject({ method: "GET", url: `/api/v1/public/rastreabilidade/external/${body.externalId}`, headers: publicHeaders(readKey.secret) });
  assert.equal(readByExternal.statusCode, 200, readByExternal.body);
  assert.equal(readByExternal.json().identificadorPublico, publicId);
  assert.equal(readByExternal.json().externalId, body.externalId);
  assert.doesNotMatch(readByExternal.body, new RegExp(organizationA.cnpj));
  assert.doesNotMatch(readByExternal.body, /codigoBarrasInterno|segredoHash|parceiroId|organizacaoId|atorNomeSnapshot/);

  const readByPublicId = await app.inject({ method: "GET", url: `/api/v1/public/rastreabilidade/lotes/${internalPublicId}`, headers: publicHeaders(readKey.secret) });
  assert.equal(readByPublicId.statusCode, 200, readByPublicId.body);
  assert.equal(readByPublicId.json().identificadorPublico, internalPublicId);

  const revokedKey = await app.inject({ method: "POST", url: `/api/v1/parceiros/${partnerA.id}/chaves/${readKey.id}/revogacao`, headers: adminHeaders(token) });
  assert.equal(revokedKey.statusCode, 200, revokedKey.body);
  const revokedKeyRead = await app.inject({ method: "GET", url: `/api/v1/public/rastreabilidade/lotes/${publicId}`, headers: publicHeaders(readKey.secret) });
  assert.equal(revokedKeyRead.statusCode, 401, revokedKeyRead.body);
  const secondKeyStillValid = await app.inject({ method: "GET", url: `/api/v1/public/rastreabilidade/lotes/${publicId}`, headers: publicHeaders(anotherReadKey.secret) });
  assert.equal(secondKeyStillValid.statusCode, 200, secondKeyStillValid.body);

  const lowerPartnerScopes = await app.inject({
    method: "PATCH", url: `/api/v1/parceiros/${partnerA.id}`, headers: adminHeaders(token), payload: { escopos: ["lotes:write"] },
  });
  assert.equal(lowerPartnerScopes.statusCode, 200, lowerPartnerScopes.body);
  const overScopeAttempt = await app.inject({ method: "GET", url: `/api/v1/public/rastreabilidade/lotes/${publicId}`, headers: publicHeaders(overScopedKey.secret) });
  assert.equal(overScopeAttempt.statusCode, 403, overScopeAttempt.body);
  const writeScopeStillWorks = await app.inject({
    method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(writeKey.secret, associationA.identificadorPublico, `write-after-scope-${suffix}`),
    payload: { notaFiscal: `NF-SCOPE-OK-${suffix}`, transportadora: "Transportadora" },
  });
  assert.equal(writeScopeStillWorks.statusCode, 201, writeScopeStillWorks.body);
  lotIds.push((await prisma.lote.findUnique({ where: { publicId: writeScopeStillWorks.json().identificadorPublico }, select: { id: true } }))!.id);
  const restorePartnerScopes = await app.inject({ method: "PATCH", url: `/api/v1/parceiros/${partnerA.id}`, headers: adminHeaders(token), payload: { escopos: ["lotes:write", "rastreabilidade:read"] } });
  assert.equal(restorePartnerScopes.statusCode, 200, restorePartnerScopes.body);

  const keyRateLimit = await createKey(token, partnerA.id, "limite de requisições por chave", ["lotes:write"], { limiteRequisicoesPorMinuto: 1 });
  const keyRateFirst = await app.inject({ method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(keyRateLimit.secret, associationA.identificadorPublico, `key-rate-1-${suffix}`), payload: { notaFiscal: `NF-KEY-RATE-1-${suffix}`, transportadora: "Transportadora" } });
  assert.equal(keyRateFirst.statusCode, 201, keyRateFirst.body);
  lotIds.push((await prisma.lote.findUnique({ where: { publicId: keyRateFirst.json().identificadorPublico }, select: { id: true } }))!.id);
  const keyRateSecond = await app.inject({ method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(keyRateLimit.secret, associationA.identificadorPublico, `key-rate-2-${suffix}`), payload: { notaFiscal: `NF-KEY-RATE-2-${suffix}`, transportadora: "Transportadora" } });
  assert.equal(keyRateSecond.statusCode, 429, keyRateSecond.body);

  const crossPartnerPublicId = await app.inject({ method: "GET", url: `/api/v1/public/rastreabilidade/lotes/${publicId}`, headers: publicHeaders(partnerBKey.secret) });
  assert.equal(crossPartnerPublicId.statusCode, 404, crossPartnerPublicId.body);
  const crossPartnerAssociation = await app.inject({
    method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(partnerBWriteKey.secret, associationA.identificadorPublico, `cross-${suffix}`),
    payload: { notaFiscal: "NF-CROSS", transportadora: "Transportadora" },
  });
  assert.equal(crossPartnerAssociation.statusCode, 403, crossPartnerAssociation.body);

  const revokedAssociation = await app.inject({ method: "DELETE", url: `/api/v1/parceiros/${partnerA.id}/organizacoes/${associationA.id}`, headers: adminHeaders(token) });
  assert.equal(revokedAssociation.statusCode, 200, revokedAssociation.body);
  const noAssociationTracking = await app.inject({ method: "GET", url: `/api/v1/public/rastreabilidade/lotes/${publicId}`, headers: publicHeaders(anotherReadKey.secret) });
  assert.equal(noAssociationTracking.statusCode, 404, noAssociationTracking.body);

  const lowPartner = await createPartner(token, "Parceiro rate limit", { limiteRequisicoesPorMinuto: 1 });
  const lowAssociation = await associate(token, lowPartner.id, organizationB.id);
  const lowKey1 = await createKey(token, lowPartner.id, "primeira chave", ["lotes:write"]);
  const lowKey2 = await createKey(token, lowPartner.id, "segunda chave", ["lotes:write"]);
  const firstLimited = await app.inject({
    method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(lowKey1.secret, lowAssociation.identificadorPublico, `rate-1-${suffix}`),
    payload: { notaFiscal: `NF-RATE-1-${suffix}`, transportadora: "Transportadora" },
  });
  assert.equal(firstLimited.statusCode, 201, firstLimited.body);
  lotIds.push((await prisma.lote.findUnique({ where: { publicId: firstLimited.json().identificadorPublico }, select: { id: true } }))!.id);
  const secondLimited = await app.inject({
    method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(lowKey2.secret, lowAssociation.identificadorPublico, `rate-2-${suffix}`),
    payload: { notaFiscal: `NF-RATE-2-${suffix}`, transportadora: "Transportadora" },
  });
  assert.equal(secondLimited.statusCode, 429, secondLimited.body);
  assert.ok(Number(secondLimited.headers["retry-after"]) >= 1);

  const inactivePartner = await app.inject({ method: "POST", url: `/api/v1/parceiros/${lowPartner.id}/desativacao`, headers: adminHeaders(token) });
  assert.equal(inactivePartner.statusCode, 200, inactivePartner.body);
  const inactiveKey = await app.inject({ method: "POST", url: "/api/v1/public/lotes", headers: publicHeaders(lowKey2.secret, lowAssociation.identificadorPublico, `inactive-${suffix}`), payload: { notaFiscal: "NF-INACTIVE", transportadora: "Transportadora" } });
  assert.equal(inactiveKey.statusCode, 401, inactiveKey.body);
  const activatePartner = await app.inject({ method: "POST", url: `/api/v1/parceiros/${lowPartner.id}/ativacao`, headers: adminHeaders(token) });
  assert.equal(activatePartner.statusCode, 200, activatePartner.body);
  assert.equal(activatePartner.json().ativo, true);

  const audits = await prisma.eventoAuditoria.count({ where: { parceiroId: { in: partnerIds } } });
  assert.ok(audits >= 8, `Esperava auditoria administrativa e externa, obtidos: ${audits}`);
  const externalAudit = await prisma.eventoAuditoria.findFirst({ where: { parceiroId: partnerA.id, apiKeyId: writeKey.id, organizacaoId: organizationA.id, atorTipo: "PARCEIRO" } });
  assert.ok(externalAudit, "A auditoria externa deve identificar parceiro, API Key e organização.");
  assert.equal(JSON.stringify(externalAudit?.detalhes ?? {}).includes(writeKey.secret), false);
});
