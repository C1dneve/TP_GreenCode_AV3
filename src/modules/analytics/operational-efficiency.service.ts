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
    const byOperator = new Map<string, { nome: string; sessoes: number; lotes: Set<string>; active: number }>();
    const byPeriod = new Map<string, number[]>();
    const byOrganization = new Map<string, number[]>();
    let measuredSessionCount = 0;
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

      if (validIntervals.length) {
        // União dos intervalos: a parte sobreposta pertence à sessão que começou primeiro.
        // Isso impede que uma retomada/concorrência infle artificialmente o tempo efetivo.
        let cursor = lot.dataEntrada.getTime();
        let activeMs = 0;
        for (const session of validIntervals) {
          const start = Math.max(session.started!.getTime(), cursor);
          const end = Math.max(start, session.completed.getTime());
          const uniqueMs = end - start;
          if (uniqueMs > 0) {
            activeMs += uniqueMs;
            const operator = byOperator.get(session.operatorId) ?? { nome: session.operatorName, sessoes: 0, lotes: new Set<string>(), active: 0 };
            operator.active += uniqueMs / 60_000;
            operator.lotes.add(lotId);
            operator.sessoes += 1;
            byOperator.set(session.operatorId, operator);
          }
          cursor = Math.max(cursor, session.completed.getTime());
        }
        const active = activeMs / 60_000;
        const wait = total - active;
        if (Number.isFinite(active) && active >= 0 && Number.isFinite(wait) && wait >= 0) {
          activeDurations.push(active);
          waitDurations.push(wait);
        }
      }
    }

    const lotsInPeriod = lots.filter(lot => inPeriod(lot.dataEntrada, filters));
    const pendingLots = lotsInPeriod.filter(lot => ["RECEBIDO", "EM_TRIAGEM"].includes(lot.statusProcessamento)).length;
    const incompleteSessions = [...sessions.values()].filter(session => session.completed === null).length;
    const finalLotCount = sessionsByLot.size;
    const validMean = (values: number[]) => average(values) === null ? null : round(average(values)!);
    const result = {
      periodo: { de: filters.de?.toISOString() ?? null, ate: filters.ate?.toISOString() ?? null, criterio: "data de conclusão da triagem" },
      totalLotes: lotsInPeriod.length,
      lotesPendentes: pendingLots,
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
      tempoEfetivoTriagemMedioMinutos: validMean(activeDurations),
      tempoEfetivoTriagemMedianoMinutos: median(activeDurations) === null ? null : round(median(activeDurations)!),
      tempoEsperaMedioMinutos: validMean(waitDurations),
      tempoEsperaMedianoMinutos: median(waitDurations) === null ? null : round(median(waitDurations)!),
      distribuicaoTempoTotalMinutos: {
        p25: percentile(totalDurations, .25), p75: percentile(totalDurations, .75), p90: percentile(totalDurations, .90),
        minimo: totalDurations.length ? round(Math.min(...totalDurations)) : null,
        maximo: totalDurations.length ? round(Math.max(...totalDurations)) : null,
      },
      porOperador: [...byOperator].map(([operadorId, value]) => ({
        operadorId, operador: value.nome, lotesComAtividade: value.lotes.size, sessoesComAtividade: value.sessoes,
        tempoEfetivoTriagemMinutos: round(value.active),
      })),
      porOrganizacao: [...byOrganization].map(([organizacaoId, values]) => ({ organizacaoId, lotesConcluidos: values.length, tempoTotalMedioMinutos: validMean(values) })),
      porPeriodo: [...byPeriod].sort(([a], [b]) => a.localeCompare(b)).map(([periodo, values]) => ({ periodo, lotesConcluidos: values.length, tempoTotalMedioMinutos: validMean(values) })),
      gargalo: pendingLots > 0 ? "Existem lotes aguardando início ou conclusão de triagem." : null,
      metodologia: "Tempo total: dataEntrada do lote até o último evento TRIAGEM_CONCLUIDA válido. Tempo efetivo: união dos intervalos TRIAGEM_INICIADA→TRIAGEM_CONCLUIDA das sessões AV3 válidas do lote; intervalos sobrepostos são contados uma vez. Espera: tempo total menos tempo efetivo, calculada apenas para lotes com sessão mensurável. Sessões legadas podem contribuir para o ciclo total, mas não para tempo efetivo. Cada lote entra uma única vez nas métricas de ciclo.",
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
