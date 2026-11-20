import test from "node:test";
import assert from "node:assert/strict";
import { average, linearRegression, median, percentile } from "../modules/analytics/statistics.js";
import { OperationalEfficiencyService } from "../modules/analytics/operational-efficiency.service.js";
import { ProfitabilityService } from "../modules/analytics/profitability.service.js";
import { UsefulLifeService } from "../modules/analytics/useful-life.service.js";
import type { AnalyticsRepository } from "../modules/analytics/analytics.repository.js";
import { calculateDepreciatedValue } from "../modules/historico-equipamentos/historico.service.js";
import { serializeReport, toCsv } from "../modules/relatorios-async/report-format.js";

test("estatística descritiva lida com vazio e calcula média, mediana e percentil", () => {
  assert.equal(average([]), null);
  assert.equal(median([]), null);
  assert.equal(average([2, 4, 6]), 4);
  assert.equal(median([8, 2, 4]), 4);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
});

test("regressão linear OLS retorna inclinação, intercepto e R² e rejeita amostras insuficientes", () => {
  const result = linearRegression([[1, 8], [2, 6], [3, 4], [4, 2]]);
  assert.ok(result);
  assert.equal(result.slope, -2);
  assert.equal(result.intercept, 10);
  assert.equal(result.rSquared, 1);
  assert.equal(linearRegression([[1, 2], [1, 3]]), null);
});

test("eficiência operacional usa timestamps persistidos e exclui sessões incompletas da média", async () => {
  let persisted: Record<string, unknown> | undefined;
  const repository = {
    triageEvents: async () => [
      { sessaoId: "s1", etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date("2026-11-20T10:00:00Z"), responsavelId: "u1", responsavel: { nome: "Operador A" }, lote: { organizacaoId: "o1" } },
      { sessaoId: "s1", etapa: "TRIAGEM_CONCLUIDA", ocorridoEm: new Date("2026-11-20T11:30:00Z"), responsavelId: "u1", responsavel: { nome: "Operador A" }, lote: { organizacaoId: "o1" } },
      { sessaoId: "s2", etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date("2026-11-20T12:00:00Z"), responsavelId: "u2", responsavel: { nome: "Operador B" }, lote: { organizacaoId: "o1" } },
    ],
    lots: async () => [{ statusProcessamento: "RECEBIDO" }, { statusProcessamento: "EM_TRIAGEM" }, { statusProcessamento: "FINALIZADO" }],
    saveRun: async (data: Record<string, unknown>) => { persisted = data; },
  } as unknown as AnalyticsRepository;
  const result = await new OperationalEfficiencyService(repository).execute();
  assert.equal(result.tempoMedioMinutos, 90);
  assert.equal(result.tempoMedianoMinutos, 90);
  assert.equal(result.triagensConcluidas, 1);
  assert.equal(result.sessoesSemConclusao, 1);
  assert.equal(result.sessoesMensuraveis, 1);
  assert.equal(result.sessoesLegadasSincronas, 0);
  assert.equal(result.lotesPendentes, 2);
  assert.equal((persisted?.resultado as any).tempoMedioMinutos, 90);
});

test("sessões legadas síncronas permanecem identificadas, mas não contaminam a duração média", async () => {
  let persisted: Record<string, unknown> | undefined;
  const repository = {
    triageEvents: async () => [
      { sessaoId: "legacy", etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date("2026-11-20T10:00:00Z"), responsavelId: "u1", origemSessao: "LEGADO_AV2", mensuravel: false, lote: { organizacaoId: "o1" } },
      { sessaoId: "legacy", etapa: "TRIAGEM_CONCLUIDA", ocorridoEm: new Date("2026-11-20T10:00:00.010Z"), responsavelId: "u1", origemSessao: "LEGADO_AV2", mensuravel: false, lote: { organizacaoId: "o1" } },
      { sessaoId: "av3", etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date("2026-11-20T11:00:00Z"), responsavelId: "u2", origemSessao: "AV3", mensuravel: true, lote: { organizacaoId: "o1" } },
      { sessaoId: "av3", etapa: "TRIAGEM_CONCLUIDA", ocorridoEm: new Date("2026-11-20T12:00:00Z"), responsavelId: "u2", origemSessao: "AV3", mensuravel: true, lote: { organizacaoId: "o1" } },
    ],
    lots: async () => [],
    saveRun: async (data: Record<string, unknown>) => { persisted = data; },
  } as unknown as AnalyticsRepository;
  const result = await new OperationalEfficiencyService(repository).execute();
  assert.equal(result.triagensConcluidas, 2);
  assert.equal(result.sessoesLegadasSincronas, 1);
  assert.equal(result.sessoesMensuraveis, 1);
  assert.equal(result.sessoesNaoMensuraveis, 1);
  assert.equal(result.tempoMedioMinutos, 60);
  assert.equal((persisted?.resultado as any).sessoesLegadasSincronas, 1);
});

test("estimativa de recuperação prioriza referência por marca e separa valor real", () => {
  const estimate = ProfitabilityService.estimate({ tipo: "NOTEBOOK", marca: "ACME", estadoFisico: "BOM_ESTADO", pesoQuilogramas: 2 }, [
    { id: "generic", tipo: "NOTEBOOK", marca: null, estadoFisico: "BOM_ESTADO", valorMaterialPorKg: "10", percentualRecuperavel: "50" },
    { id: "brand", tipo: "NOTEBOOK", marca: "Acme", estadoFisico: "BOM_ESTADO", valorMaterialPorKg: "20", percentualRecuperavel: "50" },
  ]);
  assert.equal(estimate.valorEstimado, 20);
  assert.equal(estimate.fonte, "REFERENCIA_CADASTRADA");
  const fallback = ProfitabilityService.estimate({ tipo: "NOTEBOOK", marca: "ACME", estadoFisico: "BOM_ESTADO", pesoQuilogramas: 2 }, []);
  assert.equal(fallback.valorEstimado, 17.1);
  assert.equal(fallback.fonte, "TABELA_BASE_ESTIMATIVA");
});

test("referências e avaliações demonstrativas nunca são aplicadas a equipamentos reais", () => {
  const base = { tipo: "NOTEBOOK", marca: "ACME", modelo: "M1", estadoFisico: "BOM_ESTADO", valorMaterialPorKg: "100", percentualRecuperavel: "100" };
  const references = [
    { id: "real", ...base, demonstracao: false },
    { id: "demo", ...base, demonstracao: true, valorMaterialPorKg: "900" },
  ];
  const real = ProfitabilityService.estimate({ tipo: "NOTEBOOK", marca: "ACME", modelo: "M1", estadoFisico: "BOM_ESTADO", pesoQuilogramas: 1, demonstracao: false }, references);
  const demo = ProfitabilityService.estimate({ tipo: "NOTEBOOK", marca: "ACME", modelo: "M1", estadoFisico: "BOM_ESTADO", pesoQuilogramas: 1, demonstracao: true }, references);
  assert.equal(real.referenciaId, "real");
  assert.equal(real.valorEstimado, 100);
  assert.equal(demo.referenciaId, "demo");
  assert.equal(demo.valorEstimado, 900);
});

test("rentabilidade ignora avaliações cuja origem demonstrativa diverge da origem do equipamento", async () => {
  let persisted: any;
  const repository = {
    equipment: async () => [{
      id: "real-equipment", demonstracao: false, tipo: "NOTEBOOK", marca: "ACME", modelo: "M1",
      estadoFisico: "BOM_ESTADO", pesoQuilogramas: "2",
      avaliacoesRecuperacao: [
        { demonstracao: true, valorEstimado: "900", valorRealizado: "850", metodo: "referência demo incorreta" },
        { demonstracao: false, valorEstimado: "100", valorRealizado: "80", metodo: "avaliação real" },
      ],
    }],
    recoveryReferences: async () => [
      { id: "real-ref", tipo: "NOTEBOOK", marca: "ACME", modelo: "M1", estadoFisico: "BOM_ESTADO", demonstracao: false, valorMaterialPorKg: "10", percentualRecuperavel: "50" },
      { id: "demo-ref", tipo: "NOTEBOOK", marca: "ACME", modelo: "M1", estadoFisico: "BOM_ESTADO", demonstracao: true, valorMaterialPorKg: "900", percentualRecuperavel: "100" },
    ],
    saveRun: async (data: any) => { persisted = data; },
  } as unknown as AnalyticsRepository;
  const result = await new ProfitabilityService(repository).execute({ incluirDemonstracao: true });
  assert.equal(result.valorEstimadoTotal, 100);
  assert.equal(result.valorRealizadoTotal, 80);
  assert.equal((persisted.resultado as any).avaliacoesComRealizacao, 1);
});

test("previsão de vida útil exige pelo menos três avaliações em datas distintas", async () => {
  const item = {
    id: "equipment-1", tipo: "NOTEBOOK", marca: "Marca", modelo: "Modelo", anoFabricacao: 2020,
    valorAquisicao: "1000", estadoFisico: "BOM_ESTADO", falhas: [], manutencoes: [],
    depreciacoes: [
      { avaliadoEm: new Date("2021-01-01T00:00:00Z"), valorEstimado: "800" },
      { avaliadoEm: new Date("2022-01-01T00:00:00Z"), valorEstimado: "600" },
      { avaliadoEm: new Date("2023-01-01T00:00:00Z"), valorEstimado: "400" },
    ],
  };
  let persisted = 0;
  const repository = { lifeData: async () => [item], saveRun: async () => { persisted += 1; } } as unknown as AnalyticsRepository;
  const available = await new UsefulLifeService(repository).execute();
  assert.equal(available.previsoesDisponiveis, 1);
  assert.ok(available.previsoes[0]?.mesesRemanescentesEstimados !== null);
  assert.equal(persisted, 1);

  const insufficientRepo = { lifeData: async () => [{ ...item, depreciacoes: item.depreciacoes.slice(0, 2) }], saveRun: async () => undefined } as unknown as AnalyticsRepository;
  const insufficient = await new UsefulLifeService(insufficientRepo).execute();
  assert.equal(insufficient.previsoesDisponiveis, 0);
  assert.match(insufficient.previsoes[0]?.motivoIndisponibilidade ?? "", /três avaliações/);
});

test("depreciação linear é limitada a zero e usa taxa anual", () => {
  const date = new Date("2026-01-01T00:00:00Z");
  assert.equal(calculateDepreciatedValue(1000, 15, 2024, date), 700);
  assert.equal(calculateDepreciatedValue(1000, 100, 2024, date), 0);
});

test("exportação CSV protege fórmulas e escapa delimitadores; JSON converte bigint", () => {
  const output = toCsv([{ nome: "Ana, Silva", valor: "=1+1", observacao: "diz \"olá\"" }]);
  assert.match(output, /"Ana, Silva"/);
  assert.match(output, /"'=1\+1"/);
  assert.match(output, /"diz ""olá"""/);
  assert.equal(serializeReport({ bytes: 10n }, "JSON"), '{\n  "bytes": "10"\n}');
});

// Regression coverage for model-level recovery-reference precedence.
test("referência de recuperação seleciona primeiro marca + modelo e respeita todos os fallbacks", () => {
  const base = { tipo: "NOTEBOOK", estadoFisico: "BOM_ESTADO" };
  const references = [
    { id: "generic", ...base, marca: null, modelo: null, valorMaterialPorKg: "10", percentualRecuperavel: "50" },
    { id: "brand", ...base, marca: "ACME", modelo: null, valorMaterialPorKg: "20", percentualRecuperavel: "50" },
    { id: "model", ...base, marca: "Acme", modelo: "Model X", valorMaterialPorKg: "30", percentualRecuperavel: "50" },
    { id: "other-model", ...base, marca: "Acme", modelo: "Model Y", valorMaterialPorKg: "40", percentualRecuperavel: "50" },
  ];
  const input = { tipo: base.tipo, estadoFisico: base.estadoFisico, marca: "ACME", modelo: "model x", pesoQuilogramas: 2 };
  assert.equal(ProfitabilityService.selectReference(input, references)?.id, "model");
  assert.equal(ProfitabilityService.selectReference({ ...input, modelo: "missing" }, references)?.id, "brand");
  assert.equal(ProfitabilityService.selectReference({ ...input, marca: "Other", modelo: "missing" }, references)?.id, "generic");
  assert.equal(ProfitabilityService.selectReference({ ...input, marca: "Other", modelo: "missing" }, [references[2]!]), null);
  const estimate = ProfitabilityService.estimate(input, references);
  assert.equal(estimate.referenciaId, "model");
  assert.equal(estimate.valorEstimado, 30);
});
