import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PREFIX_PATTERN = /^gc_live_[a-f0-9]{16}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface GeneratedApiKey {
  prefixo: string;
  segredo: string;
  valorCompleto: string;
  segredoHash: string;
}

export function hashApiSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function generateApiKey(): GeneratedApiKey {
  const prefixo = `gc_live_${randomBytes(8).toString("hex")}`;
  const segredo = randomBytes(32).toString("base64url");
  return { prefixo, segredo, valorCompleto: `${prefixo}.${segredo}`, segredoHash: hashApiSecret(segredo) };
}

export function parseApiKey(value: unknown): { prefixo: string; segredo: string } | null {
  if (typeof value !== "string" || value.length > 120) return null;
  const separator = value.indexOf(".");
  if (separator <= 0 || separator !== value.lastIndexOf(".")) return null;
  const prefixo = value.slice(0, separator);
  const segredo = value.slice(separator + 1);
  if (!PREFIX_PATTERN.test(prefixo) || !SECRET_PATTERN.test(segredo)) return null;
  return { prefixo, segredo };
}

export function verifyApiSecret(secret: string, expectedHash: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const actual = Buffer.from(hashApiSecret(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
