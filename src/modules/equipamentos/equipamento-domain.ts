import { randomInt } from "node:crypto";
import { errors } from "../../shared/domain-error.js";

export const EQUIPMENT_TYPES = ["COMPUTADOR_MESA", "NOTEBOOK", "MONITOR", "IMPRESSORA", "SERVIDOR", "ROTEADOR", "CABO_ESTRUTURADO", "FONTE_ALIMENTACAO"] as const;
export const PHYSICAL_STATES = ["NOVO", "BOM_ESTADO", "USADO_LEVE", "USADO_MODERADO", "DANIFICADO_LEVE", "DANIFICADO_GRAVE", "INSERVIVEL"] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];
export type PhysicalState = (typeof PHYSICAL_STATES)[number];

export function decimal(value: string | number, name: string, places: number, max: number): string {
  const str = String(value);
  const number = Number(str);
  if (!Number.isFinite(number) || number < 0 || number > max || !new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(str)) {
    throw errors.badRequest("VALIDATION_ERROR", `${name} deve ser não negativo com até ${places} casas decimais.`);
  }
  return number.toFixed(places);
}

export interface EquipmentCreateInput {
  tipo: string;
  marca: string;
  modelo: string;
  anoFabricacao: number;
  estadoFisico: string;
  pesoQuilogramas: string | number;
  valorAquisicao?: string | number;
}

export function normalizeEquipmentCreateInput(input: EquipmentCreateInput, now = new Date()) {
  const year = now.getUTCFullYear();
  if (!EQUIPMENT_TYPES.includes(input.tipo as EquipmentType) || !input.marca.trim() || input.marca.trim().length > 100 || !input.modelo.trim() || input.modelo.trim().length > 120 || !Number.isInteger(input.anoFabricacao) || input.anoFabricacao < 1900 || input.anoFabricacao > year || !PHYSICAL_STATES.includes(input.estadoFisico as PhysicalState)) {
    throw errors.badRequest("VALIDATION_ERROR", "Atributos do equipamento inválidos.");
  }
  return {
    tipo: input.tipo as EquipmentType,
    marca: input.marca.trim(),
    modelo: input.modelo.trim(),
    anoFabricacao: input.anoFabricacao,
    estadoFisico: input.estadoFisico as PhysicalState,
    pesoQuilogramas: decimal(input.pesoQuilogramas, "Peso", 3, 99999999.999),
    valorAquisicao: decimal(input.valorAquisicao ?? 0, "Valor de aquisição", 2, 9999999999.99),
    prefixo: input.tipo.replace(/[^A-Z]/g, "").slice(0, 4).padEnd(4, "X"),
  };
}

export function generateInternalBarcode(prefix: string): string {
  return `GC-${prefix}-${String(randomInt(0, 1_000_000)).padStart(6, "0")}`;
}
