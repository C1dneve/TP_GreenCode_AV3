import { AnalyticsRepository, type AnalyticsFilters, type AnalyticsLotRecord, type AnalyticsTriageEventRecord } from "./analytics.repository.js";
import { average, median, percentile, round } from "./statistics.js";

interface TriageSession {
  sessaoId: string;
  loteId: string;
  started: Date | null;
  completed: Date | null;
  operatorId: string;
  operatorName: string;
  organizationId: string;
  origemSessao: string;
  mensuravel: boolean;
}
type CompletedTriageSession = TriageSession & { completed: Date };
function hasCompletion(session: TriageSession): session is CompletedTriageSession {
  return session.completed !== null && Number.isFinite(session.completed.getTime());
}
function inPeriod(date: Date, filters: AnalyticsFilters): boolean {
  return (!filters.de || date >= filters.de) && (!filters.ate || date <= filters.ate);
}
function minutes(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60_000;
}

/**
 * A conclusão válida é um evento TRIAGEM_CONCLUIDA associado a um lote que
 * efetivamente está em TRIAGEM_CONCLUIDA. O ciclo total é contado uma vez por lote.
 * Todas as sessões AV3 válidas do lote contribuem para o tempo efetivo; intervalos
 * sobrepostos são unidos e contabilizados uma única vez. Sessões legadas podem
 * sustentar o timestamp de conclusão/ciclo total, mas não fornecem tempo efetivo.
 */
export class OperationalEfficiencyService {
  constructor(private readonly repo: AnalyticsRepository) {}

  async execute(filters: AnalyticsFilters = {}) {
    // O período é aplicado à conclusão, não à entrada: lotes recebidos antes do
    // intervalo continuam elegíveis quando sua triagem termina dentro dele.
    const unbounded = { ...filters, de: undefined, ate: undefined };
    const [events, lots] = await Promise.all([
      this.repo.triageEvents(unbounded),
      this.repo.lots(unbounded),
    ]);
    const lotById = new Map<string, AnalyticsLotRecord>(lots.map((lot: AnalyticsLotRecord): [string, AnalyticsLotRecord] => [lot.id, lot]));
    const sessions = new Map<string, TriageSession>();
    for (const event of events) {
      const current = sessions.get(event.sessaoId) ?? {
        sessaoId: event.sessaoId,
        loteId: event.loteId,
        started: null,
        completed: null,
        operatorId: event.responsavelId,
        operatorName: event.responsavel?.nome ?? "Não informado",
        organizationId: event.lote?.organizacaoId ?? "",
        origemSessao: event.origemSessao ?? "AV3",
        mensuravel: event.mensuravel !== false && (event.origemSessao ?? "AV3") !== "LEGADO_AV2",
      };
      if (event.etapa === "TRIAGEM_INICIADA" && (!current.started || event.ocorridoEm < current.started)) current.started = new Date(event.ocorridoEm);
      if (event.etapa === "TRIAGEM_CONCLUIDA" && (!current.completed || event.ocorridoEm > current.completed)) current.completed = new Date(event.ocorridoEm);
      sessions.set(event.sessaoId, current);
    }

    const completedSessions = [...sessions.values()].filter(hasCompletion);
    const sessionsByLot = new Map<string, CompletedTriageSession[]>();
    for (const session of completedSessions) {
      const lot = lotById.get(session.loteId);
      if (!lot || lot.statusProcessamento !== "TRIAGEM_CONCLUIDA" || session.completed < lot.dataEntrada || !inPeriod(session.completed, filters)) continue;
      const values = sessionsByLot.get(session.loteId) ?? [];
      values.push(session);
      sessionsByLot.set(session.loteId, values);
    }

    const totalDurations: number[] = [];
    const activeDurations: number[] = [];
    const waitDurations: number[] = [];
    const preTriageWaitDurations: number[] = [];
    const byOperator = new Map<string, {
      nome: string;
      sessoesConsideradas: number;
      sessoesComAtividade: number;
      lotesAtendidos: Set<string>;
      lotesComAtividade: Set<string>;
      duracoesEfetivasPorSessao: number[];
      tempoEfetivoTotalMinutos: number;
      tempoEfetivoPorLote: Map<string, number>;
    }>();
    const byPeriod = new Map<string, number[]>();
    let totalTempoEfetivoMinutos = 0;
    const byOrganization = new Map<string, number[]>();
    let measuredSessionCount = 0;
    let measuredLotsWithSessions = 0;
    let legacySessionCount = 0;
    let missingStartSessions = 0;
    let invalidChronologySessions = 0;

    for (const [lotId, lotSessions] of sessionsByLot) {
      const lot = lotById.get(lotId)!;
      const finalCompletion = new Date(Math.max(...lotSessions.map(session => session.completed.getTime())));
      const total = minutes(lot.dataEntrada, finalCompletion);
      if (!Number.isFinite(total) || total < 0) continue;
      totalDurations.push(total);
      const month = finalCompletion.toISOString().slice(0, 7);
      const periodValues = byPeriod.get(month) ?? [];
      periodValues.push(total);
      byPeriod.set(month, periodValues);
      const orgValues = byOrganization.get(lot.organizacaoId) ?? [];
      orgValues.push(total);
      byOrganization.set(lot.organizacaoId, orgValues);

      const measurableSessions = lotSessions.filter(session => session.mensuravel && session.started !== null);
      legacySessionCount += lotSessions.filter(session => !session.mensuravel || session.origemSessao === "LEGADO_AV2").length;
      missingStartSessions += lotSessions.filter(session => session.started === null).length;
      const validIntervals = measurableSessions.filter(session => {
        const valid = session.started !== null && session.started >= lot.dataEntrada && session.started <= session.completed;
        if (!valid) invalidChronologySessions += 1;
        return valid;
      }).sort((a, b) => a.started!.getTime() - b.started!.getTime() || a.sessaoId.localeCompare(b.sessaoId));
      measuredSessionCount += validIntervals.length;
      if (validIntervals.length) measuredLotsWithSessions += 1;

      if (validIntervals.length) {
        // União dos intervalos: a parte sobreposta pertence à sessão que começou primeiro.
        // Isso impede que uma retomada/concorrência infle artificialmente o tempo efetivo.
        let cursor = lot.dataEntrada.getTime();
        let activeMs = 0;
        for (const session of validIntervals) {
          const start = Math.max(session.started!.getTime(), cursor);
          const end = Math.max(start, session.completed.getTime());
          const uniqueMs = end - start;
          const uniqueMinutes = uniqueMs / 60_000;
          activeMs += uniqueMs;

          // Toda sessão AV3 cronologicamente válida é uma observação, mesmo
          // quando sua contribuição exclusiva é zero por estar totalmente coberta
          // por uma sessão anterior. Isso torna a amostra explícita e auditável.
          const operator = byOperator.get(session.operatorId) ?? {
            nome: session.operatorName,
            sessoesConsideradas: 0,
            sessoesComAtividade: 0,
            lotesAtendidos: new Set<string>(),
            lotesComAtividade: new Set<string>(),
            duracoesEfetivasPorSessao: [],
            tempoEfetivoTotalMinutos: 0,
            tempoEfetivoPorLote: new Map<string, number>(),
          };
          operator.sessoesConsideradas += 1;
          operator.duracoesEfetivasPorSessao.push(uniqueMinutes);
          operator.lotesAtendidos.add(lotId);
          operator.tempoEfetivoTotalMinutos += uniqueMinutes;
          operator.tempoEfetivoPorLote.set(lotId, (operator.tempoEfetivoPorLote.get(lotId) ?? 0) + uniqueMinutes);
          if (uniqueMs > 0) {
            operator.sessoesComAtividade += 1;
            operator.lotesComAtividade.add(lotId);
          }
          byOperator.set(session.operatorId, operator);
          cursor = Math.max(cursor, session.completed.getTime());
        }
        const active = activeMs / 60_000;
        totalTempoEfetivoMinutos += active;
        const wait = total - active;
        if (Number.isFinite(active) && active >= 0 && Number.isFinite(wait) && wait >= 0) {
          activeDurations.push(active);
          waitDurations.push(wait);
        }
      }
    }

    const lotsInPeriod = lots.filter(lot => inPeriod(lot.dataEntrada, filters));
    const lotsInPeriodIds = new Set(lotsInPeriod.map(lot => lot.id));
    const waitingLots = lotsInPeriod.filter(lot => lot.statusProcessamento === "RECEBIDO");
    const processingLots = lotsInPeriod.filter(lot => lot.statusProcessamento === "EM_TRIAGEM");
    const pendingLots = waitingLots.length + processingLots.length;
    const incompleteSessions = [...sessions.values()].filter(session =>
      session.completed === null && lotsInPeriodIds.has(session.loteId),
    ).length;
    const validStartByLot = new Map<string, Date>();
    for (const session of sessions.values()) {
      const lot = lotById.get(session.loteId);
      if (!lot || !session.started || session.started < lot.dataEntrada
        || (session.completed && session.started > session.completed)) continue;
      const previous = validStartByLot.get(lot.id);
      if (!previous || session.started < previous) validStartByLot.set(lot.id, session.started);
    }
    const lotsWithoutValidStart = lotsInPeriod.filter(lot => !validStartByLot.has(lot.id));
    // A espera histórica é calculada uma vez por lote concluído, usando o
    // primeiro início AV3 válido, mesmo que aquela sessão tenha ficado aberta.
    for (const lotId of sessionsByLot.keys()) {
      const lot = lotById.get(lotId)!;
      const firstMeasuredStart = [...sessions.values()]
        .filter(session => session.loteId === lotId && session.mensuravel && session.started
          && session.started >= lot.dataEntrada && (!session.completed || session.started <= session.completed))
        .sort((a, b) => a.started!.getTime() - b.started!.getTime())[0]?.started;
      if (!firstMeasuredStart) continue;
      const preTriageWait = minutes(lot.dataEntrada, firstMeasuredStart);
      if (Number.isFinite(preTriageWait) && preTriageWait >= 0) preTriageWaitDurations.push(preTriageWait);
    }
    const distributionByStatus = [...lotsInPeriod.reduce((counts, lot) => {
      counts.set(lot.statusProcessamento, (counts.get(lot.statusProcessamento) ?? 0) + 1);
      return counts;
    }, new Map<string, number>())]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([estado, quantidade]) => ({ estado, quantidade }));
    const finalLotCount = sessionsByLot.size;
    const validMean = (values: number[]) => average(values) === null ? null : round(average(values)!);
    const periodResults = [...byPeriod].sort(([a], [b]) => a.localeCompare(b)).map(([periodo, values]) => ({
      periodo, lotesConcluidos: values.length, tempoTotalMedioMinutos: validMean(values),
    }));
    const periodWithHighestAverage = periodResults
      .filter(item => item.tempoTotalMedioMinutos !== null)
      .sort((a, b) => (b.tempoTotalMedioMinutos ?? 0) - (a.tempoTotalMedioMinutos ?? 0) || a.periodo.localeCompare(b.periodo))[0] ?? null;
    const preTriageWaitAverage = validMean(preTriageWaitDurations);
    const preTriageWaitMedian = median(preTriageWaitDurations);
    const diagnostic = {
      lotesAguardandoInicioTriagem: waitingLots.length,
      lotesEmTriagem: processingLots.length,
      sessoesIncompletas: incompleteSessions,
      lotesSemEventoValidoInicio: lotsWithoutValidStart.length,
      distribuicaoLotesPorEstado: distributionByStatus,
      tempoEsperaAntesInicioMedioMinutos: preTriageWaitAverage,
      tempoEsperaAntesInicioMedianoMinutos: preTriageWaitMedian === null ? null : round(preTriageWaitMedian),
      observacoesTempoEsperaAntesInicio: preTriageWaitDurations.length,
      periodoMaiorTempoMedioProcessamento: periodWithHighestAverage,
    };
    const result = {
      periodo: { de: filters.de?.toISOString() ?? null, ate: filters.ate?.toISOString() ?? null, criterio: "data de conclusão da triagem" },
      totalLotes: lotsInPeriod.length,
      lotesPendentes: pendingLots,
      lotesAguardandoInicioTriagem: waitingLots.length,
      lotesEmTriagem: processingLots.length,
      lotesSemEventoValidoInicio: lotsWithoutValidStart.length,
      distribuicaoLotesPorEstado: distributionByStatus,
      tempoEsperaAntesInicioMedioMinutos: preTriageWaitAverage,
      tempoEsperaAntesInicioMedianoMinutos: preTriageWaitMedian === null ? null : round(preTriageWaitMedian),
      observacoesTempoEsperaAntesInicio: preTriageWaitDurations.length,
      periodoMaiorTempoMedioProcessamento: periodWithHighestAverage,
      diagnosticoGargalos: diagnostic,
      lotesComTriagemConcluida: finalLotCount,
      triagensConcluidas: finalLotCount,
      sessoesConcluidasHistoricas: completedSessions.length,
      sessoesMensuraveis: measuredSessionCount,
      sessoesLegadasSincronas: legacySessionCount,
      sessoesSemInicio: missingStartSessions,
      sessoesComCronologiaInvalida: invalidChronologySessions,
      sessoesSemConclusao: incompleteSessions,
      tempoTotalProcessoMedioMinutos: validMean(totalDurations),
      tempoTotalProcessoMedianoMinutos: median(totalDurations) === null ? null : round(median(totalDurations)!),
      tempoEfetivoTriagemTotalMinutos: round(totalTempoEfetivoMinutos),
      tempoEfetivoTriagemMedioMinutos: validMean(activeDurations),
      tempoEfetivoTriagemMedianoMinutos: median(activeDurations) === null ? null : round(median(activeDurations)!),
      tempoEsperaMedioMinutos: validMean(waitDurations),
      tempoEsperaMedianoMinutos: median(waitDurations) === null ? null : round(median(waitDurations)!),
      distribuicaoTempoTotalMinutos: {
        p25: percentile(totalDurations, .25), p75: percentile(totalDurations, .75), p90: percentile(totalDurations, .90),
        minimo: totalDurations.length ? round(Math.min(...totalDurations)) : null,
        maximo: totalDurations.length ? round(Math.max(...totalDurations)) : null,
      },
      porOperador: [...byOperator].map(([operadorId, value]) => {
        const sessoesObservadas = value.duracoesEfetivasPorSessao.length;
        const lotesObservados = value.tempoEfetivoPorLote.size;
        const mediaSessao = average(value.duracoesEfetivasPorSessao);
        const medianaSessao = median(value.duracoesEfetivasPorSessao);
        const mediaLote = average([...value.tempoEfetivoPorLote.values()]);
        const participacao = totalTempoEfetivoMinutos > 0
          ? (value.tempoEfetivoTotalMinutos / totalTempoEfetivoMinutos) * 100
          : null;
        return {
          operadorId,
          operador: value.nome,
          // Campos existentes preservados para compatibilidade com consumidores internos.
          lotesComAtividade: value.lotesComAtividade.size,
          sessoesComAtividade: value.sessoesComAtividade,
          tempoEfetivoTriagemMinutos: round(value.tempoEfetivoTotalMinutos),
          // Comparativos com denominadores explícitos; sessões sobrepostas por
          // completo permanecem na amostra com contribuição zero.
          tempoEfetivoTotalMinutos: round(value.tempoEfetivoTotalMinutos),
          sessoesConsideradas: value.sessoesConsideradas,
          observacoesTempoPorSessao: sessoesObservadas,
          tempoEfetivoMedioPorSessaoMinutos: mediaSessao === null ? null : round(mediaSessao),
          tempoEfetivoMedianoPorSessaoMinutos: medianaSessao === null ? null : round(medianaSessao),
          lotesAtendidos: value.lotesAtendidos.size,
          observacoesTempoPorLote: lotesObservados,
          tempoMedioParticipacaoPorLoteMinutos: mediaLote === null ? null : round(mediaLote),
          participacaoPercentualTempoEfetivo: participacao === null ? null : round(participacao),
          // Base global do denominador: lotes com ao menos uma sessão AV3 mensurável.
          observacoesParticipacaoPercentual: measuredLotsWithSessions,
        };
      }),
      porOrganizacao: [...byOrganization].map(([organizacaoId, values]) => ({ organizacaoId, lotesConcluidos: values.length, tempoTotalMedioMinutos: validMean(values) })),
      porPeriodo: periodResults,
      gargalo: pendingLots > 0 || incompleteSessions > 0 || lotsWithoutValidStart.length > 0
        ? `${waitingLots.length} lote(s) aguardando início; ${processingLots.length} em triagem; ${lotsWithoutValidStart.length} sem evento válido de início; ${incompleteSessions} sessão(ões) sem conclusão.`
        : null,
      metodologia: "Tempo total: dataEntrada do lote até o último evento TRIAGEM_CONCLUIDA válido. Tempo efetivo: união dos intervalos TRIAGEM_INICIADA→TRIAGEM_CONCLUIDA das sessões AV3 válidas do lote; intervalos sobrepostos são atribuídos à sessão que começou primeiro e cada trecho de tempo é contado uma única vez. Comparativos por operador usam apenas sessões AV3 completas com cronologia válida; uma sessão totalmente coberta por outra permanece na amostra com zero minuto exclusivo. Média e mediana por sessão usam a duração exclusiva de cada sessão; média por lote usa a soma exclusiva do operador em cada lote; participação percentual divide o tempo exclusivo do operador pelo tempo efetivo total de todos os lotes elegíveis. Quantidades de observações acompanham cada indicador. Sessões legadas podem contribuir para o ciclo total, mas não para comparativos por operador. Cada lote entra uma única vez nas métricas de ciclo. Espera antes do início é data do primeiro TRIAGEM_INICIADA AV3 cronologicamente válido menos dataEntrada, calculada somente para lotes concluídos com início válido; não é estimada para lotes ainda abertos. O diagnóstico operacional considera estados persistidos dos lotes e eventos encontrados, sem usar relógio de parede.",
    };
    await this.repo.saveRun({
      tipo: "EFICIENCIA_OPERACIONAL", organizacaoId: filters.organizacaoId ?? null,
      metodo: "Ciclo de lote (entrada→conclusão), união de sessões efetivas e espera",
      versaoModelo: "3.0.0", filtros: { ...filters }, resultado: result,
      observacoes: totalDurations.length, indisponivel: totalDurations.length === 0,
      motivo: totalDurations.length === 0 ? "Não existem lotes com evento de conclusão válido no período." : null,
      demonstracao: Boolean(filters.incluirDemonstracao), origemExecucao: filters.origemExecucao ?? "MANUAL",
      schedulerId: filters.schedulerId ?? null, jobId: filters.jobId ?? null,
      chaveExecucao: filters.schedulerId && filters.jobId ? `${filters.schedulerId}:${filters.jobId}` : null,
    });
    return result;
  }
}
