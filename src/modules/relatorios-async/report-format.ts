import { publicAnalyticsProjection } from "../analytics/public-analytics.dto.js";

export type ReportFormat = "CSV" | "JSON";

export function sanitizePublicReportPayload(type: string, payload: unknown): unknown {
  const analyticsType: Record<string, string> = {
    operacional: "eficiencia-operacional",
    rentabilidade: "rentabilidade",
    "vida-util": "vida-util",
  };
  if (analyticsType[type]) return publicAnalyticsProjection(analyticsType[type]!, payload);
  if (!Array.isArray(payload)) return payload;
  if (type === "equipamentos") {
    return payload.map((row: any) => ({
      tipo: row.tipo, marca: row.marca, modelo: row.modelo, anoFabricacao: row.anoFabricacao,
      estadoFisico: row.estadoFisico, pesoQuilogramas: row.pesoQuilogramas,
      statusRastreamento: row.statusRastreamento, recebidoEm: row.createdAt,
    }));
  }
  if (type === "triagem") {
    return payload.map((row: any) => ({
      ocorridoEm: row.ocorridoEm, etapa: row.etapa,
    }));
  }
  if (type === "lotes") {
    return payload.map((row: any) => ({
      status: row.statusProcessamento, dataEntrada: row.dataEntrada,
      criadoEm: row.createdAt, atualizadoEm: row.updatedAt,
      quantidadeEquipamentos: row._count?.equipamentos ?? 0,
    }));
  }
  return payload;
}

function csvEscape(value: unknown): string {
  let text = value === null || value === undefined
    ? ""
    : value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
      ? JSON.stringify(value, (_key, nested) => typeof nested === "bigint" ? nested.toString() : nested)
      : typeof value === "bigint"
        ? value.toString()
        : String(value);
  // Evita que planilhas executem conteúdo importado como fórmula (CSV/Formula Injection).
  if (/^[\s\u0000-\u001f]*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function flattenRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.map((item, index) => item && typeof item === "object" && !(item instanceof Date)
      ? item as Record<string, unknown>
      : { indice: index, valor: item });
  }
  const out: Record<string, unknown> = {};
  const walk = (value: unknown, prefix: string) => {
    if (value instanceof Date) out[prefix || "valor"] = value.toISOString();
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) walk(child, prefix ? `${prefix}.${key}` : key);
    } else out[prefix || "valor"] = value;
  };
  walk(payload, "");
  return Object.entries(out).map(([campo, valor]) => ({ campo, valor }));
}

/** Converte registros em CSV compatível com planilhas, escapando aspas e fórmulas. */
export function toCsv(payload: unknown): string {
  const rows = flattenRows(payload);
  if (!rows.length) return "";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return `${columns.map(csvEscape).join(",")}\r\n${rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")).join("\r\n")}\r\n`;
}

/** Serializa resultados JSON preservando BigInt como string, ou converte para CSV. */
export function serializeReport(payload: unknown, format: ReportFormat): string {
  return format === "CSV"
    ? toCsv(payload)
    : JSON.stringify(payload, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2);
}
