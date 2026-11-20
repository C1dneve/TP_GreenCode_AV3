export type ReportFormat = "CSV" | "JSON";

function csvEscape(value: unknown): string {
  let text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Evita que planilhas executem conteúdo importado como fórmula.
  if (/^[\s\u0000-\u001f]*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function flattenRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.map((item, index) => item && typeof item === "object" ? item as Record<string, unknown> : { indice: index, valor: item });
  const out: Record<string, unknown> = {};
  const walk = (value: unknown, prefix: string) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) walk(child, prefix ? `${prefix}.${key}` : key);
    } else out[prefix || "valor"] = Array.isArray(value) ? JSON.stringify(value) : value;
  };
  walk(payload, "");
  return Object.entries(out).map(([campo, valor]) => ({ campo, valor }));
}

export function toCsv(payload: unknown): string {
  const rows = flattenRows(payload);
  if (!rows.length) return "";
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return `${columns.map(csvEscape).join(",")}\r\n${rows.map(row => columns.map(column => csvEscape(row[column])).join(",")).join("\r\n")}\r\n`;
}

export function serializeReport(payload: unknown, format: ReportFormat): string {
  return format === "CSV"
    ? toCsv(payload)
    : JSON.stringify(payload, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2);
}
