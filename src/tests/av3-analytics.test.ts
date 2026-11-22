import test from "node:test";
import assert from "node:assert/strict";
import { average, linearRegression, median, percentile } from "../modules/analytics/statistics.js";
import { OperationalEfficiencyService } from "../modules/analytics/operational-efficiency.service.js";
import { ProfitabilityService } from "../modules/analytics/profitability.service.js";
import { UsefulLifeService } from "../modules/analytics/useful-life.service.js";
import { UsefulLifeBacktestingService } from "../modules/analytics/backtesting.service.js";
import type { AnalyticsRepository } from "../modules/analytics/analytics.repository.js";
import { calculateDepreciatedValue } from "../modules/historico-equipamentos/historico.service.js";
import { sanitizePublicReportPayload, serializeReport, toCsv } from "../modules/relatorios-async/report-format.js";
import { AnalyticsController } from "../modules/analytics/analytics.controller.js";
import { publicAnalyticsProjection } from "../modules/analytics/public-analytics.dto.js";

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

test("eficiência operacional mede entrada→conclusão, triagem efetiva e espera sem contar lote duas vezes", async () => {
  let persisted: Record<string, unknown> | undefined;
  const repository = {
    triageEvents: async () => [
      { sessaoId: "s1", loteId: "l1", etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date("2026-11-20T10:00:00Z"), responsavelId: "u1", responsavel: { nome: "Operador A" }, lote: { id: "l1", organizacaoId: "o1" } },
      { sessaoId: "s1", loteId: "l1", etapa: "TRIAGEM_CONCLUIDA", ocorridoEm: new Date("2026-11-20T11:30:00Z"), responsavelId: "u1", responsavel: { nome: "Operador A" }, lote: { id: "l1", organizacaoId: "o1" } },
      { sessaoId: "s2", loteId: "l2", etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date("2026-11-20T12:00:00Z"), responsavelId: "u2", responsavel: { nome: "Operador B" }, lote: { id: "l2", organizacaoId: "o1" } },
    ],
    lots: async () => [
      { id: "l1", dataEntrada: new Date("2026-11-20T09:30:00Z"), statusProcessamento: "TRIAGEM_CONCLUIDA", organizacaoId: "o1" },
      { id: "l2", dataEntrada: new Date("2026-11-20T11:45:00Z"), statusProcessamento: "EM_TRIAGEM", organizacaoId: "o1" },
      { id: "l3", dataEntrada: new Date("2026-11-20T08:00:00Z"), statusProcessamento: "RECEBIDO", organizacaoId: "o1" },
    ],
    saveRun: async (data: Record<string, unknown>) => { persisted = data; },
  } as unknown as AnalyticsRepository;
  const result = await new OperationalEfficiencyService(repository).execute();
  assert.equal(result.tempoTotalProcessoMedioMinutos, 120);
  assert.equal(result.tempoEfetivoTriagemMedioMinutos, 90);
  assert.equal(result.tempoEsperaMedioMinutos, 30);
  assert.equal(result.lotesComTriagemConcluida, 1);
  assert.equal(result.sessoesSemConclusao, 1);
  assert.equal(result.sessoesMensuraveis, 1);
  assert.equal(result.lotesPendentes, 2);
  assert.equal((persisted?.resultado as any).tempoTotalProcessoMedioMinutos, 120);
});



test("diagnóstico operacional quantifica filas, inícios ausentes, espera histórica e mês crítico", async () => {
  const events = [
    { sessaoId: "done-1", loteId: "done-1", etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date("2026-11-20T09:30:00Z"), responsavelId: "op-1", responsavel: { nome: "Operador" }, lote: { id: "done-1", organizacaoId: "org" } },
    { sessaoId: "done-1", loteId: "done-1", etapa: "TRIAGEM_CONCLUIDA", ocorridoEm: new Date("2026-11-20T10:30:00Z"), responsavelId: "op-1", responsavel: { nome: "Operador" }, lote: { id: "done-1", organizacaoId: "org" } },
    { sessaoId: "done-2", loteId: "done-2", etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date("2026-11-20T10:45:00Z"), responsavelId: "op-1", responsavel: { nome: "Operador" }, lote: { id: "done-2", organizacaoId: "org" } },
    { sessaoId: "done-2", loteId: "done-2", etapa: "TRIAGEM_CONCLUIDA", ocorridoEm: new Date("2026-11-20T12:45:00Z"), responsavelId: "op-1", responsavel: { nome: "Operador" }, lote: { id: "done-2", organizacaoId: "org" } },
    { sessaoId: "open-1", loteId: "open-1", etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date("2026-11-20T11:30:00Z"), responsavelId: "op-1", responsavel: { nome: "Operador" }, lote: { id: "open-1", organizacaoId: "org" } },
  ];
  const repository = {
    triageEvents: async () => events,
    lots: async () => [
      { id: "done-1", organizacaoId: "org", statusProcessamento: "TRIAGEM_CONCLUIDA", dataEntrada: new Date("2026-11-20T09:00:00Z") },
      { id: "done-2", organizacaoId: "org", statusProcessamento: "TRIAGEM_CONCLUIDA", dataEntrada: new Date("2026-11-20T10:00:00Z") },
      { id: "waiting", organizacaoId: "org", statusProcessamento: "RECEBIDO", dataEntrada: new Date("2026-11-20T08:00:00Z") },
      { id: "open-1", organizacaoId: "org", statusProcessamento: "EM_TRIAGEM", dataEntrada: new Date("2026-11-20T11:00:00Z") },
      { id: "open-no-start", organizacaoId: "org", statusProcessamento: "EM_TRIAGEM", dataEntrada: new Date("2026-11-20T11:15:00Z") },
    ],
    saveRun: async () => undefined,
  } as unknown as AnalyticsRepository;

  const result = await new OperationalEfficiencyService(repository).execute();
  assert.equal(result.lotesAguardandoInicioTriagem, 1);
  assert.equal(result.lotesEmTriagem, 2);
  assert.equal(result.lotesSemEventoValidoInicio, 2);
  assert.equal(result.sessoesSemConclusao, 1);
  assert.deepEqual(result.distribuicaoLotesPorEstado, [
    { estado: "EM_TRIAGEM", quantidade: 2 },
    { estado: "RECEBIDO", quantidade: 1 },
    { estado: "TRIAGEM_CONCLUIDA", quantidade: 2 },
  ]);
  assert.equal(result.tempoEsperaAntesInicioMedioMinutos, 37.5);
  assert.equal(result.tempoEsperaAntesInicioMedianoMinutos, 37.5);
  assert.equal(result.observacoesTempoEsperaAntesInicio, 2);
  assert.deepEqual(result.periodoMaiorTempoMedioProcessamento, {
    periodo: "2026-11", lotesConcluidos: 2, tempoTotalMedioMinutos: 127.5,
  });
  assert.equal(result.diagnosticoGargalos.lotesSemEventoValidoInicio, 2);
});

test("eficiência escolhe a última sessão concluída por lote e descarta cronologia inválida", async () => {
  const repository = {
    triageEvents: async () => [
      { sessaoId: "s1", loteId: "l1", etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date("2026-11-20T09:00:00Z"), responsavelId: "u1", responsavel: { nome: "Operador A" }, lote: { id: "l1", organizacaoId: "o1" } },
      { sessaoId: "s1", loteId: "l1", etapa: "TRIAGEM_CONCLUIDA", ocorridoEm: new Date("2026-11-20T10:00:00Z"), responsavelId: "u1", responsavel: { nome: "Operador A" }, lote: { id: "l1", organizacaoId: "o1" } },
      { sessaoId: "s2", loteId: "l1", etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date("2026-11-20T09:30:00Z"), responsavelId: "u2", responsavel: { nome: "Operador B" }, lote: { id: "l1", organizacaoId: "o1" } },
      { sessaoId: "s2", loteId: "l1", etapa: "TRIAGEM_CONCLUIDA", ocorridoEm: new Date("2026-11-20T12:00:00Z"), responsavelId: "u2", responsavel: { nome: "Operador B" }, lote: { id: "l1", organizacaoId: "o1" } },
      { sessaoId: "invalid", loteId: "l2", etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date("2026-11-20T07:00:00Z"), responsavelId: "u3", responsavel: { nome: "Operador C" }, lote: { id: "l2", organizacaoId: "o1" } },
      { sessaoId: "invalid", loteId: "l2", etapa: "TRIAGEM_CONCLUIDA", ocorridoEm: new Date("2026-11-20T08:00:00Z"), responsavelId: "u3", responsavel: { nome: "Operador C" }, lote: { id: "l2", organizacaoId: "o1" } },
    ],
    lots: async () => [
      { id: "l1", dataEntrada: new Date("2026-11-20T08:00:00Z"), statusProcessamento: "TRIAGEM_CONCLUIDA", organizacaoId: "o1" },
      { id: "l2", dataEntrada: new Date("2026-11-20T09:00:00Z"), statusProcessamento: "TRIAGEM_CONCLUIDA", organizacaoId: "o1" },
    ],
    saveRun: async () => undefined,
  } as unknown as AnalyticsRepository;
  const result = await new OperationalEfficiencyService(repository).execute();
  assert.equal(result.sessoesConcluidasHistoricas, 3);
  assert.equal(result.lotesComTriagemConcluida, 1);
  assert.equal(result.tempoTotalProcessoMedioMinutos, 240);
  assert.equal(result.tempoEfetivoTriagemMedioMinutos, 180);
  assert.equal(result.tempoEsperaMedioMinutos, 60);
  assert.equal(result.porOperador.length, 2);
  assert.deepEqual(result.porOperador.map(item => item.operador).sort(), ["Operador A", "Operador B"]);
});


test("comparativo por operador distribui sobreposições, explicita amostras e exclui sessões legadas", async () => {
  const events: any[] = [];
  const addSession = (
    sessaoId: string,
    loteId: string,
    responsavelId: string,
    nome: string,
    inicio: string,
    fim: string,
    origemSessao = "AV3",
    mensuravel = true,
  ) => {
    const lote = { id: loteId, organizacaoId: "org-1" };
    const responsavel = { id: responsavelId, nome };
    events.push(
      { sessaoId, loteId, responsavelId, responsavel, lote, origemSessao, mensuravel, etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date(inicio) },
      { sessaoId, loteId, responsavelId, responsavel, lote, origemSessao, mensuravel, etapa: "TRIAGEM_CONCLUIDA", ocorridoEm: new Date(fim) },
    );
  };

  // Lote 1: A trabalha 90 min. B1 fica totalmente coberta (0 min exclusivos);
  // B2 recebe somente os 30 min restantes depois de 10:30.
  addSession("a-l1", "lote-1", "op-a", "Operador A", "2026-11-20T09:00:00Z", "2026-11-20T10:30:00Z");
  addSession("b-zero-l1", "lote-1", "op-b", "Operador B", "2026-11-20T09:30:00Z", "2026-11-20T10:00:00Z");
  addSession("b-l1", "lote-1", "op-b", "Operador B", "2026-11-20T10:00:00Z", "2026-11-20T11:00:00Z");
  // Lote 2: A recebe 30 min; B inicia com 10 min sobrepostos e recebe os 60 min restantes.
  addSession("a-l2", "lote-2", "op-a", "Operador A", "2026-11-20T13:00:00Z", "2026-11-20T13:30:00Z");
  addSession("b-l2", "lote-2", "op-b", "Operador B", "2026-11-20T13:20:00Z", "2026-11-20T14:30:00Z");
  addSession("legacy-l2", "lote-2", "op-a", "Operador A", "2026-11-20T13:00:00Z", "2026-11-20T13:15:00Z", "LEGADO_AV2", false);

  let persisted: any;
  const repository = {
    triageEvents: async () => events,
    lots: async () => [
      { id: "lote-1", organizacaoId: "org-1", dataEntrada: new Date("2026-11-20T09:00:00Z"), statusProcessamento: "TRIAGEM_CONCLUIDA" },
      { id: "lote-2", organizacaoId: "org-1", dataEntrada: new Date("2026-11-20T13:00:00Z"), statusProcessamento: "TRIAGEM_CONCLUIDA" },
    ],
    saveRun: async (run: any) => { persisted = run; },
  } as unknown as AnalyticsRepository;

  const result = await new OperationalEfficiencyService(repository).execute();
  const operatorA = result.porOperador.find(item => item.operadorId === "op-a")!;
  const operatorB = result.porOperador.find(item => item.operadorId === "op-b")!;

  assert.equal(result.lotesComTriagemConcluida, 2, "cada lote entra uma vez no ciclo, embora tenha várias sessões");
  assert.equal(result.sessoesMensuraveis, 5, "as cinco sessões AV3 completas são mensuráveis; legado fica fora");
  assert.equal(result.sessoesLegadasSincronas, 1);
  assert.equal(result.tempoEfetivoTriagemTotalMinutos, 210, "soma efetiva das sessões dos dois lotes, sem duplicar sobreposição");
  assert.equal(result.tempoEfetivoTriagemMedioMinutos, 105, "média dos tempos efetivos de 120 e 90 minutos por lote");
  assert.equal(result.porOperador.length, 2, "a sessão legada não cria observação de operador");

  assert.equal(operatorA.tempoEfetivoTotalMinutos, 120);
  assert.equal(operatorA.sessoesConsideradas, 2);
  assert.equal(operatorA.sessoesComAtividade, 2);
  assert.equal(operatorA.tempoEfetivoMedioPorSessaoMinutos, 60);
  assert.equal(operatorA.tempoEfetivoMedianoPorSessaoMinutos, 60);
  assert.equal(operatorA.lotesAtendidos, 2);
  assert.equal(operatorA.tempoMedioParticipacaoPorLoteMinutos, 60);
  assert.equal(operatorA.participacaoPercentualTempoEfetivo, 57.14);
  assert.equal(operatorA.observacoesParticipacaoPercentual, 2, "a participação usa dois lotes no denominador global");

  assert.equal(operatorB.tempoEfetivoTotalMinutos, 90);
  assert.equal(operatorB.sessoesConsideradas, 3, "a sessão inteiramente sobreposta permanece na amostra");
  assert.equal(operatorB.sessoesComAtividade, 2);
  assert.equal(operatorB.tempoEfetivoMedioPorSessaoMinutos, 30);
  assert.equal(operatorB.tempoEfetivoMedianoPorSessaoMinutos, 30);
  assert.equal(operatorB.lotesAtendidos, 2);
  assert.equal(operatorB.tempoMedioParticipacaoPorLoteMinutos, 45);
  assert.equal(operatorB.participacaoPercentualTempoEfetivo, 42.86);
  assert.equal(operatorB.observacoesParticipacaoPercentual, 2, "a base global do percentual é comum aos operadores");
  assert.equal(operatorA.tempoEfetivoTotalMinutos + operatorB.tempoEfetivoTotalMinutos, 210, "o total não duplica os 70 min de interseção dos intervalos");
  assert.equal((persisted.resultado as any).porOperador[1].sessoesConsideradas, 3);
});

test("ausência de observações mantém médias, medianas e participações indisponíveis", async () => {
  const repository = {
    triageEvents: async () => [],
    lots: async () => [],
    saveRun: async () => undefined,
  } as unknown as AnalyticsRepository;
  const result = await new OperationalEfficiencyService(repository).execute();
  assert.equal(result.tempoEfetivoTriagemMedioMinutos, null);
  assert.equal(result.tempoEfetivoTriagemMedianoMinutos, null);
  assert.deepEqual(result.porOperador, []);
  assert.equal(result.sessoesMensuraveis, 0);
});

test("ciclo total continua mensurável quando o evento de início histórico está ausente", async () => {
  const repository = {
    triageEvents: async () => [
      { sessaoId: "sem-start", loteId: "l1", etapa: "TRIAGEM_CONCLUIDA", ocorridoEm: new Date("2026-11-20T10:00:00Z"), responsavelId: "u1", responsavel: { nome: "Operador" }, lote: { id: "l1", organizacaoId: "o1" } },
    ],
    lots: async () => [
      { id: "l1", dataEntrada: new Date("2026-11-20T09:00:00Z"), statusProcessamento: "TRIAGEM_CONCLUIDA", organizacaoId: "o1" },
    ],
    saveRun: async () => undefined,
  } as unknown as AnalyticsRepository;
  const result = await new OperationalEfficiencyService(repository).execute();
  assert.equal(result.lotesComTriagemConcluida, 1);
  assert.equal(result.tempoTotalProcessoMedioMinutos, 60);
  assert.equal(result.tempoEfetivoTriagemMedioMinutos, null);
  assert.equal(result.tempoEsperaMedioMinutos, null);
  assert.equal(result.sessoesSemInicio, 1);
});

test("sessões legadas síncronas permanecem identificadas e não entram nas métricas mensuráveis", async () => {
  let persisted: Record<string, unknown> | undefined;
  const repository = {
    triageEvents: async () => [
      { sessaoId: "legacy", loteId: "l1", etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date("2026-11-20T10:00:00Z"), responsavelId: "u1", origemSessao: "LEGADO_AV2", mensuravel: false, lote: { id: "l1", organizacaoId: "o1" } },
      { sessaoId: "legacy", loteId: "l1", etapa: "TRIAGEM_CONCLUIDA", ocorridoEm: new Date("2026-11-20T10:00:00.010Z"), responsavelId: "u1", origemSessao: "LEGADO_AV2", mensuravel: false, lote: { id: "l1", organizacaoId: "o1" } },
      { sessaoId: "av3", loteId: "l2", etapa: "TRIAGEM_INICIADA", ocorridoEm: new Date("2026-11-20T11:00:00Z"), responsavelId: "u2", origemSessao: "AV3", mensuravel: true, lote: { id: "l2", organizacaoId: "o1" } },
      { sessaoId: "av3", loteId: "l2", etapa: "TRIAGEM_CONCLUIDA", ocorridoEm: new Date("2026-11-20T12:00:00Z"), responsavelId: "u2", origemSessao: "AV3", mensuravel: true, lote: { id: "l2", organizacaoId: "o1" } },
    ],
    lots: async () => [
      { id: "l1", dataEntrada: new Date("2026-11-20T09:00:00Z"), statusProcessamento: "TRIAGEM_CONCLUIDA", organizacaoId: "o1" },
      { id: "l2", dataEntrada: new Date("2026-11-20T10:30:00Z"), statusProcessamento: "TRIAGEM_CONCLUIDA", organizacaoId: "o1" },
    ],
    saveRun: async (data: Record<string, unknown>) => { persisted = data; },
  } as unknown as AnalyticsRepository;
  const result = await new OperationalEfficiencyService(repository).execute();
  assert.equal(result.lotesComTriagemConcluida, 2);
  assert.equal(result.sessoesLegadasSincronas, 1);
  assert.equal(result.sessoesMensuraveis, 1);
  assert.equal(result.tempoTotalProcessoMedioMinutos, 75);
  assert.equal(result.tempoEfetivoTriagemMedioMinutos, 60);
  assert.equal(result.tempoEsperaMedioMinutos, 30);
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
        { demonstracao: false, valorEstimado: "100", valorRealizado: "80", metodo: "avaliação real", quantidadeKg: "2", valorReferenciaPorKg: "10", percentualRecuperavel: "50", fonteReferencia: "REFERENCIA_CADASTRADA", referenciaRecuperacaoId: "reference-snapshot", observacaoReferencia: "snapshot da referência" },
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
  const detail = (result as any).detalhesEquipamentos[0];
  assert.equal(detail.precoReferenciaPorKg, 10);
  assert.equal(detail.percentualRecuperavel, 50);
  assert.equal(detail.pesoMaterialRecuperavelKg, 1);
  assert.equal(detail.referenciaRecuperacaoId, "reference-snapshot");
});

test("vida útil consolida tipos, previsões disponíveis/indisponíveis e observações", async () => {
  const base = {
    marca: "Marca", modelo: "Modelo", anoFabricacao: 2020,
    valorAquisicao: "1000", estadoFisico: "BOM_ESTADO", falhas: [], manutencoes: [],
  };
  const notebookA = {
    ...base, id: "notebook-a", tipo: "NOTEBOOK",
    falhas: [
      { id: "failure-a1", equipamentoId: "notebook-a", ocorridoEm: new Date("2024-02-01T00:00:00Z"), categoria: "HARDWARE", severidade: "ALTA", resolvidaEm: null },
      { id: "failure-a2", equipamentoId: "notebook-a", ocorridoEm: new Date("2024-03-01T00:00:00Z"), categoria: "BATERIA", severidade: "ALTA", resolvidaEm: new Date("2024-03-10T00:00:00Z") },
    ],
    depreciacoes: [
      { avaliadoEm: new Date("2021-01-01T00:00:00Z"), valorEstimado: "900" },
      { avaliadoEm: new Date("2022-01-01T00:00:00Z"), valorEstimado: "600" },
      { avaliadoEm: new Date("2023-01-01T00:00:00Z"), valorEstimado: "300" },
    ],
  };
  const notebookB = {
    ...base, id: "notebook-b", tipo: "NOTEBOOK",
    falhas: [
      { id: "failure-b1", equipamentoId: "notebook-b", ocorridoEm: new Date("2024-04-01T00:00:00Z"), categoria: "CONEXAO", severidade: "BAIXA", resolvidaEm: null },
    ],
    depreciacoes: [
      { avaliadoEm: new Date("2021-01-01T00:00:00Z"), valorEstimado: "800" },
      { avaliadoEm: new Date("2022-01-01T00:00:00Z"), valorEstimado: "600" },
      { avaliadoEm: new Date("2023-01-01T00:00:00Z"), valorEstimado: "400" },
    ],
  };
  const smartphone = {
    ...base, id: "smartphone-a", tipo: "SMARTPHONE",
    depreciacoes: notebookA.depreciacoes.slice(0, 2),
  };
  const monitor = {
    ...base, id: "monitor-a", tipo: "MONITOR", estadoFisico: "INSERVIVEL",
    depreciacoes: notebookA.depreciacoes,
  };
  let persisted = 0;
  const repository = {
    lifeData: async () => [notebookA, notebookB, smartphone, monitor],
    saveRun: async () => { persisted += 1; },
  } as unknown as AnalyticsRepository;
  const result = await new UsefulLifeService(repository).execute();

  assert.equal(result.equipamentosAnalisados, 4);
  assert.equal(result.previsoesDisponiveis, 2);
  assert.equal(result.previsoesIndisponiveis, 2);
  assert.equal(result.previsoes.length, 4, "a coleção individual existente é preservada");
  assert.equal(result.previsoesPorTipo.length, 3);
  const notebook = result.previsoesPorTipo.find(item => item.tipo === "NOTEBOOK")!;
  const notebookPredictions = result.previsoes.filter(item => item.tipo === "NOTEBOOK");
  const notebookMonths = notebookPredictions.map(item => item.mesesRemanescentesEstimados as number).sort((a, b) => a - b);
  assert.equal(notebook.equipamentosAnalisados, 2);
  assert.equal(notebook.previsoesDisponiveis, 2);
  assert.equal(notebook.previsoesIndisponiveis, 0);
  assert.equal(notebook.observacoesHistoricas, 6);
  assert.equal(notebook.falhasObservadas, 3);
  assert.equal(notebook.falhasNaoResolvidas, 2);
  assert.deepEqual(notebook.falhasPorCategoria, [
    { categoria: "BATERIA", quantidade: 1 },
    { categoria: "CONEXAO", quantidade: 1 },
    { categoria: "HARDWARE", quantidade: 1 },
  ]);
  assert.deepEqual(notebook.falhasPorSeveridade, [
    { severidade: "ALTA", quantidade: 2 }, { severidade: "BAIXA", quantidade: 1 },
  ]);
  assert.equal(notebook.ultimaFalhaEm, "2024-04-01T00:00:00.000Z");
  assert.equal(notebook.vidaUtilRemanescenteMediaMeses, Math.round(notebookMonths.reduce((a, b) => a + b, 0) / 2 * 10) / 10);
  assert.equal(notebook.vidaUtilRemanescenteMedianaMeses, Math.round((notebookMonths[0]! + notebookMonths[1]!) / 2 * 10) / 10);
  assert.ok(notebook.confiabilidadeMedia !== null);

  const phone = result.previsoesPorTipo.find(item => item.tipo === "SMARTPHONE")!;
  assert.equal(phone.previsoesDisponiveis, 0);
  assert.equal(phone.previsoesIndisponiveis, 1);
  assert.equal(phone.vidaUtilRemanescenteMediaMeses, null);
  assert.equal(phone.vidaUtilRemanescenteMedianaMeses, null);
  assert.equal(phone.confiabilidadeMedia, null);
  assert.equal(phone.observacoesHistoricas, 2);

  const display = result.previsoesPorTipo.find(item => item.tipo === "MONITOR")!;
  assert.equal(display.previsoesIndisponiveis, 1);
  assert.equal(display.observacoesHistoricas, 3);
  assert.equal(persisted, 1);

  const insufficientRepo = { lifeData: async () => [smartphone], saveRun: async () => undefined } as unknown as AnalyticsRepository;
  const insufficient = await new UsefulLifeService(insufficientRepo).execute();
  assert.equal(insufficient.previsoesDisponiveis, 0);
  assert.match(insufficient.previsoes[0]?.motivoIndisponibilidade ?? "", /três avaliações/);
  assert.deepEqual(insufficient.previsoesPorTipo[0], {
    tipo: "SMARTPHONE", equipamentosAnalisados: 1, previsoesDisponiveis: 0,
    previsoesIndisponiveis: 1, vidaUtilRemanescenteMediaMeses: null,
    vidaUtilRemanescenteMedianaMeses: null, observacoesHistoricas: 2,
    falhasObservadas: 0, falhasNaoResolvidas: 0, falhasPorCategoria: [], falhasPorSeveridade: [],
    ultimaFalhaEm: null, confiabilidadeMedia: null,
  });

  const empty = await new UsefulLifeService({ lifeData: async () => [], saveRun: async () => undefined } as unknown as AnalyticsRepository).execute();
  assert.equal(empty.equipamentosAnalisados, 0);
  assert.equal(empty.vidaUtilRemanescenteMediaMeses, null);
  assert.deepEqual(empty.previsoesPorTipo, []);
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
  assert.equal(toCsv([{ criadoEm: new Date("2026-11-20T10:00:00.000Z") }]), '"criadoEm"\r\n"2026-11-20T10:00:00.000Z"\r\n');
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

test("projeções públicas de analytics removem identificadores e dados de operadores", () => {
  const efficiency = publicAnalyticsProjection("eficiencia-operacional", {
    tempoTotalProcessoMedioMinutos: 90, tempoEfetivoTriagemTotalMinutos: 210,
    diagnosticoGargalos: { lotesAguardandoInicioTriagem: 1 },
    porOperador: [{ operadorId: "u-1", operador: "Pessoa interna" }],
    porOrganizacao: [{ organizacaoId: "org-interna", lotes: 1 }],
  }) as any;
  assert.equal(efficiency.tempoTotalProcessoMedioMinutos, 90);
  assert.equal(efficiency.tempoEfetivoTriagemTotalMinutos, 210);
  assert.equal(efficiency.diagnosticoGargalos.lotesAguardandoInicioTriagem, 1);
  assert.equal("porOperador" in efficiency, false);
  assert.equal("porOrganizacao" in efficiency, false);
  const profitability = publicAnalyticsProjection("rentabilidade", {
    detalhesEquipamentos: [{ equipamentoId: "internal-id", referenciaRecuperacaoId: "ref-id", tipo: "NOTEBOOK", precoReferenciaPorKg: 10 }],
  }) as any;
  assert.equal(profitability.detalhesEquipamentos[0].tipo, "NOTEBOOK");
  assert.equal("equipamentoId" in profitability.detalhesEquipamentos[0], false);
  assert.equal("referenciaRecuperacaoId" in profitability.detalhesEquipamentos[0], false);
  const life = publicAnalyticsProjection("vida-util", {
    previsoesPorTipo: [{ tipo: "NOTEBOOK", equipamentosAnalisados: 1, previsoesDisponiveis: 1,
      falhasPorCategoria: [{ categoria: "HARDWARE", quantidade: 2 }], ultimaFalhaEm: "2026-01-01T00:00:00.000Z" }],
    previsoes: [{ equipamentoId: "internal-id", tipo: "NOTEBOOK", mesesRemanescentesEstimados: 12 }],
  }) as any;
  assert.equal("equipamentoId" in life.previsoes[0], false);
  assert.equal(life.previsoesPorTipo[0].tipo, "NOTEBOOK");
  assert.deepEqual(life.previsoesPorTipo[0].falhasPorCategoria, [{ categoria: "HARDWARE", quantidade: 2 }]);
  assert.equal(life.previsoesPorTipo[0].ultimaFalhaEm, "2026-01-01T00:00:00.000Z");
  assert.equal("equipamentoId" in life.previsoesPorTipo[0], false);
});

test("relatório público de equipamentos remove barcode e IDs internos", () => {
  const safe = sanitizePublicReportPayload("equipamentos", [{
    id: "internal-id", codigoBarrasInterno: "GC-001", tipo: "NOTEBOOK", marca: "Marca",
    modelo: "Modelo", anoFabricacao: 2020, estadoFisico: "BOM_ESTADO",
    pesoQuilogramas: "2.1", statusRastreamento: "EM_TRIAGEM", valorAquisicao: "900",
  }]) as any[];
  assert.equal(safe[0].tipo, "NOTEBOOK");
  assert.equal("id" in safe[0], false);
  assert.equal("codigoBarrasInterno" in safe[0], false);
  assert.equal("valorAquisicao" in safe[0], false);
});


test("backtesting compara somente previsões maduras com transições reais posteriores", async () => {
  let persisted: any;
  const runDate = new Date("2025-01-01T00:00:00Z");
  const repository = {
    lifePredictionRuns: async () => [{
      executadoEm: runDate,
      resultado: { previsoes: [
        { equipamentoId: "eq-1", dataEstimadaInservivel: "2026-01-01T00:00:00.000Z" },
        { equipamentoId: "eq-2", dataEstimadaInservivel: "2026-03-01T00:00:00.000Z" },
        { equipamentoId: "eq-3", dataEstimadaInservivel: "2026-01-01T00:00:00.000Z" },
      ] },
    }],
    inservibleTransitions: async () => [
      { entidadeId: "eq-1", instante: new Date("2026-01-10T00:00:00Z"), detalhes: { para: "INSERVIVEL" } },
      { entidadeId: "eq-2", instante: new Date("2026-01-15T00:00:00Z"), detalhes: { para: "INSERVIVEL" } },
    ],
    saveRun: async (data: any) => { persisted = data; },
  } as unknown as AnalyticsRepository;
  const result = await new UsefulLifeBacktestingService(repository).execute({}, new Date("2026-02-01T00:00:00Z"));
  assert.equal(result.previsoesEncontradas, 3);
  assert.equal(result.previsoesAvaliadas, 1);
  assert.equal(result.previsoesAindaNaoMaduras, 1);
  assert.equal(result.previsoesMadurasSemEventoObservado, 1);
  assert.equal(result.erroMedioDias, 9);
  assert.equal((persisted.resultado as any).previsoesAvaliadas, 1);
  assert.equal(persisted.tipo, "BACKTESTING_VIDA_UTIL");
});


test("analytics pública resolve organização pelo X-Integration-ID sem receber UUID interno", async () => {
  let resolvedIdentifier = "";
  const repository = {
    organizationForIntegration: async (_partnerId: string, integrationId: string) => { resolvedIdentifier = integrationId; return "internal-organization-uuid"; },
    hasActivePartnerOrganization: async () => true,
    triageEvents: async () => [],
    lots: async () => [],
    saveRun: async () => undefined,
    recordPublicExecutionAudit: async () => undefined,
  } as unknown as AnalyticsRepository;
  const controller = new AnalyticsController(repository);
  const identity = {
    parceiroId: "partner", apiKeyId: "api-key", escoposEfetivos: ["analytics:write"],
    limiteRequisicoesPorMinuto: 60, limiteParceiroPorMinuto: 60, limiteChavePorMinuto: 60,
    maxEquipamentosPorSubmissao: 10, maxPayloadBytes: 10_000, permiteLoteSemEquipamentos: false,
  };
  const result = await controller.executePublicByIntegration("eficiencia-operacional", {}, identity, "request-1", "gci_public");
  assert.equal(resolvedIdentifier, "gci_public");
  assert.equal("organizacaoId" in (result as any), false);
});
