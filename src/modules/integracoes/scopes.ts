export const INTEGRATION_SCOPES = ["lotes:write", "rastreabilidade:read", "analytics:read", "analytics:write", "reports:read", "reports:write"] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];

export function normalizeScopes(input: unknown): IntegrationScope[] {
  if (!Array.isArray(input) || input.some((value) => typeof value !== "string" || !INTEGRATION_SCOPES.includes(value as IntegrationScope))) {
    throw new Error("Escopos inválidos. Utilize somente lotes:write, rastreabilidade:read, analytics:read, analytics:write, reports:read e reports:write.");
  }
  return [...new Set(input as IntegrationScope[])].sort();
}

export function effectiveScopes(partnerScopes: readonly string[], keyScopes: readonly string[]): IntegrationScope[] {
  const keySet = new Set(keyScopes);
  return partnerScopes.filter((scope): scope is IntegrationScope => keySet.has(scope) && INTEGRATION_SCOPES.includes(scope as IntegrationScope)).sort();
}

export function hasScope(scopes: readonly string[], required: IntegrationScope): boolean {
  return scopes.includes(required);
}
