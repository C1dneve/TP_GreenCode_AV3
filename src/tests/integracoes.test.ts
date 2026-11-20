import test from "node:test";
import assert from "node:assert/strict";
import { generateApiKey, hashApiSecret, parseApiKey, verifyApiSecret } from "../modules/integracoes/api-key-security.js";
import { effectiveScopes, hasScope, normalizeScopes } from "../modules/integracoes/scopes.js";
import { InMemoryRateLimiter } from "../modules/integracoes/rate-limiter.js";
import { semanticHash, stableJson } from "../modules/integracoes/normalization.js";
import { normalizeLoteCreateInput } from "../modules/lotes/lote-domain.js";
import { normalizeEquipmentCreateInput } from "../modules/equipamentos/equipamento-domain.js";
import { DomainError } from "../shared/domain-error.js";

test("API Key usa prefixo público e segredo criptograficamente aleatório", () => {
  const generated = generateApiKey();
  const parsed = parseApiKey(generated.valorCompleto);
  assert.ok(parsed);
  assert.match(parsed.prefixo, /^gc_live_[a-f0-9]{16}$/);
  assert.equal(parsed.prefixo, generated.prefixo);
  assert.equal(parsed.segredo, generated.segredo);
  assert.equal(verifyApiSecret(parsed.segredo, generated.segredoHash), true);
  assert.equal(verifyApiSecret(`${parsed.segredo}x`, generated.segredoHash), false);
  assert.equal(generated.segredoHash, hashApiSecret(parsed.segredo));
  assert.equal(generated.segredoHash.includes(parsed.segredo), false);
  assert.equal(parseApiKey("gc_live_invalid.secret"), null);
});

test("escopos efetivos são a interseção entre parceiro e API Key", () => {
  const partner = normalizeScopes(["lotes:write", "rastreabilidade:read"]);
  const key = normalizeScopes(["rastreabilidade:read"]);
  const effective = effectiveScopes(partner, key);
  assert.deepEqual(effective, ["rastreabilidade:read"]);
  assert.equal(hasScope(effective, "lotes:write"), false);
  assert.equal(hasScope(effective, "rastreabilidade:read"), true);
  assert.deepEqual(effectiveScopes(["lotes:write"], ["rastreabilidade:read"]), []);
  assert.throws(() => normalizeScopes(["analytics:read"]), (error: unknown) => error instanceof Error);
});

test("rate limiting aplica janela de 60 segundos e informa espera HTTP 429", () => {
  const limiter = new InMemoryRateLimiter();
  const start = 1_800_000_000_000;
  assert.equal(limiter.consume("partner:a", 2, start).allowed, true);
  assert.equal(limiter.consume("partner:a", 2, start + 1).remaining, 0);
  const blocked = limiter.consume("partner:a", 2, start + 2);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
  assert.equal(limiter.consume("partner:a", 2, start + 60_001).allowed, true);
});

test("hash semântico ignora ordem das propriedades, mas preserva a ordem das listas", () => {
  assert.equal(stableJson({ z: 1, a: { y: 2, x: 3 } }), stableJson({ a: { x: 3, y: 2 }, z: 1 }));
  assert.equal(semanticHash({ a: 1, b: 2 }), semanticHash({ b: 2, a: 1 }));
  assert.notEqual(semanticHash({ values: [1, 2] }), semanticHash({ values: [2, 1] }));
});

test("validação de lote e equipamento usa as mesmas funções de domínio dos módulos internos", () => {
  const now = new Date("2026-11-20T12:00:00.000Z");
  const lot = normalizeLoteCreateInput({ notaFiscal: " NF-01 ", transportadora: " Transportadora ", observacoes: " ", }, now);
  assert.equal(lot.notaFiscal, "NF-01");
  assert.equal(lot.transportadora, "Transportadora");
  assert.equal(lot.observacoes, "");
  assert.equal(lot.dataEntrada.toISOString(), now.toISOString());

  const equipment = normalizeEquipmentCreateInput({ tipo: "NOTEBOOK", marca: " Marca ", modelo: " Modelo ", anoFabricacao: 2024, estadoFisico: "BOM_ESTADO", pesoQuilogramas: "3.5" }, now);
  assert.equal(equipment.marca, "Marca");
  assert.equal(equipment.pesoQuilogramas, "3.500");
  assert.equal(equipment.valorAquisicao, "0.00");
  assert.throws(() => normalizeEquipmentCreateInput({ tipo: "INVALIDO", marca: "M", modelo: "M", anoFabricacao: 2024, estadoFisico: "BOM_ESTADO", pesoQuilogramas: "1" }, now), (error: unknown) => error instanceof DomainError && error.statusCode === 400);
});
