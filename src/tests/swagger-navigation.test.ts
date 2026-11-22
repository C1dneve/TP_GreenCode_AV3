import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const OFFICIAL_TAG_ORDER = [
  "Autenticação", "Saúde",
  "Usuários", "Organizações", "Contratos", "Parâmetros", "Auditoria",
  "Parceiros", "API Keys",
  "API Pública", "Rastreabilidade",
  "Análises", "Relatórios Assíncronos", "Relatórios",
  "Lotes", "Equipamentos", "Movimentações",
];

test("ordem dos grupos Swagger e sidebar segue a navegação oficial GreenCode", () => {
  const appSource = readFileSync("src/app.ts", "utf8");
  const sidebarSource = readFileSync("src/docs/greencode-swagger-sidebar.js", "utf8");

  const openApiTagsBlock = appSource.match(/tags:\s*\[([\s\S]*?)\],\s*components:/)?.[1];
  assert.ok(openApiTagsBlock, "array openapi.tags deve existir");
  const openApiTags = [...openApiTagsBlock.matchAll(/name:\s*"([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(openApiTags, OFFICIAL_TAG_ORDER);

  const sidebarTagsBlock = sidebarSource.match(/const NAV_GROUPS\s*=\s*\[([\s\S]*?)\n\s*\];/)?.[1];
  assert.ok(sidebarTagsBlock, "NAV_GROUPS deve existir na sidebar");
  const sidebarTags = [...sidebarTagsBlock.matchAll(/tags:\s*\[([^\]]*)\]/g)]
    .flatMap(group => [...group[1]!.matchAll(/"([^"]+)"/g)].map(match => match[1]));
  assert.deepEqual(sidebarTags, OFFICIAL_TAG_ORDER);
  assert.ok(!/tagsSorter:\s*["']alpha/.test(appSource), "Swagger UI não pode reordenar tags alfabeticamente");
  assert.match(sidebarSource, /id="gc-theme-toggle"/);
  assert.match(sidebarSource, /localStorage\.setItem\(THEME_STORAGE_KEY/);
  assert.match(sidebarSource, /localStorage\.getItem\(THEME_STORAGE_KEY/);
  assert.match(sidebarSource, /applyTheme\(storedTheme === "dark" \? "dark" : "light"\)/);
  assert.match(sidebarSource, /aria-pressed/);
});

test("schemas analíticos documentam diagnóstico operacional e resumo de vida útil", () => {
  const routes = readFileSync("src/modules/analytics/routes.ts", "utf8");
  assert.match(routes, /const operationalDiagnosticSchema\s*=/);
  assert.match(routes, /const usefulLifeTypeSummarySchema\s*=/);
  assert.match(routes, /falhasPorCategoria/);
  assert.match(routes, /ultimaFalhaEm/);
  assert.match(routes, /tempoEfetivoTriagemTotalMinutos/);
  assert.match(routes, /properties: analyticsResponseProperties/);
});

test("CSS do Swagger define paletas Light e Dark independentes", () => {
  const css = readFileSync("src/docs/greencode-swagger.css", "utf8");
  assert.match(css, /:root,\s*:root\[data-gc-theme="light"\]/);
  assert.match(css, /:root\[data-gc-theme="dark"\]/);
  for (const variable of ["--gc-bg", "--gc-surface", "--gc-surface-raised", "--gc-text", "--gc-muted", "--gc-border", "--gc-accent", "--gc-link", "--gc-code-bg", "--gc-code-text"]) {
    assert.ok(css.includes(variable), `variável semântica ${variable} deve estar definida`);
  }
  assert.match(css, /--gc-code-text:\s*#[0-9a-f]{6}/i);
  assert.match(css, /\.swagger-ui \.highlight-code \.microlight/);
});
