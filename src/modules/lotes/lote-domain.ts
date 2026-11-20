import { errors } from "../../shared/domain-error.js";

export interface LoteCreateInput {
  dataEntrada?: string;
  notaFiscal: string;
  transportadora: string;
  observacoes?: string;
}

export function normalizeLoteCreateInput(input: LoteCreateInput, now = new Date()) {
  const dataEntrada = input.dataEntrada ? new Date(input.dataEntrada) : now;
  const oldest = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(dataEntrada.getTime())) throw errors.badRequest("VALIDATION_ERROR", "Data inválida.");
  if (dataEntrada > now || dataEntrada < oldest) throw errors.badRequest("VALIDATION_ERROR", "Data de entrada deve estar entre hoje e os últimos 90 dias.");
  const notaFiscal = input.notaFiscal.trim();
  const transportadora = input.transportadora.trim();
  if (!notaFiscal || !transportadora || notaFiscal.length > 100 || transportadora.length > 120) throw errors.badRequest("VALIDATION_ERROR", "Nota fiscal e transportadora são obrigatórias e devem respeitar os limites de tamanho.");
  const observacoes = input.observacoes?.trim() ?? "";
  if (observacoes.length > 2000) throw errors.badRequest("VALIDATION_ERROR", "Observações excedem o limite de 2000 caracteres.");
  return { dataEntrada, notaFiscal, transportadora, observacoes };
}
