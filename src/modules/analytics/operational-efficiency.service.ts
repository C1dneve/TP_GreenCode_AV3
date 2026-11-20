import { AnalyticsRepository, type AnalyticsFilters, type AnalyticsLotRecord, type AnalyticsTriageEventRecord } from "./analytics.repository.js";
import { average, median, percentile, round } from "./statistics.js";

interface TriageSession {
  started: Date | null;
  completed: Date | null;
  operatorId: string;
  operatorName: string;
  organizationId: string;
  origemSessao: string;
  mensuravel: boolean;
}

type CompletedTriageSession = TriageSession & { started: Date; completed: Date };

function isCompletedTriageSession(session: TriageSession): session is CompletedTriageSession {
  return session.started !== null && session.completed !== null && session.completed >= session.started;
}

export class OperationalEfficiencyService {
  constructor(private readonly repo: AnalyticsRepository) {}

  async execute(filters: AnalyticsFilters = {}) {
    const [events, lots] = await Promise.all([this.repo.triageEvents(filters), this.repo.lots(filters)]);
    const sessions = new Map<string, TriageSession>();
    for (const event of events) {
      const item: TriageSession = sessions.get(event.sessaoId) ?? {
        started: null,
        completed: null,
        operatorId: event.responsavelId,
        operatorName: event.responsavel?.nome ?? "Não informado",
        organizationId: event.lote?.organizacaoId ?? "",
        origemSessao: event.origemSessao ?? "AV3",
        mensuravel: event.mensuravel !== false && (event.origemSessao ?? "AV3") !== "LEGADO_AV2",
      };
      if (event.etapa === "TRIAGEM_INICIADA") item.started = new Date(event.ocorridoEm.getTime());
      if (event.etapa === "TRIAGEM_CONCLUIDA") item.completed = new Date(event.ocorridoEm.getTime());
      sessions.set(event.sessaoId, item);
    }

    const completed = [...sessions.values()].filter(isCompletedTriageSession);
    const measurable = completed.filter((session: CompletedTriageSession) => session.mensuravel);
    const legacySynchronous = completed.filter((session: CompletedTriageSession) => session.origemSessao === "LEGADO_AV2" || !session.mensuravel);
    const durations = measurable.map((session: CompletedTriageSession) => (session.completed.getTime() - session.started.getTime()) / 60000);
    const byOperator = new Map<string, { nome: string; durations: number[] }>();
    const byOrganization = new Map<string, number[]>();
    const byPeriod = new Map<string, number[]>();
    for (const item of measurable) {
      const duration = (item.completed.getTime() - item.started.getTime()) / 60000;
      const operator = byOperator.get(item.operatorId) ?? { nome: item.operatorName, durations: [] };
      operator.durations.push(duration);
      byOperator.set(item.operatorId, operator);
      const organization = byOrganization.get(item.organizationId) ?? [];
      organization.push(duration);
      byOrganization.set(item.organizationId, organization);
      const period = item.completed.toISOString().slice(0, 7);
      const month = byPeriod.get(period) ?? [];
      month.push(duration);
      byPeriod.set(period, month);
    }
    const pendingLots = lots.filter((lot: AnalyticsLotRecord) => ["RECEBIDO", "EM_TRIAGEM"].includes(lot.statusProcessamento)).length;
    const mean = average(durations);
    const medianDuration = median(durations);
    const result = {
      periodo: { de: filters.de?.toISOString() ?? null, ate: filters.ate?.toISOString() ?? null },
      totalLotes: lots.length,
      lotesPendentes: pendingLots,
      triagensConcluidas: completed.length,
      sessoesCompletas: completed.length,
      sessoesMensuraveis: measurable.length,
      sessoesLegadasSincronas: legacySynchronous.length,
      sessoesNaoMensuraveis: completed.length - measurable.length,
      sessoesSemConclusao: sessions.size - completed.length,
      tempoMedioMinutos: mean === null ? null : round(mean),
      tempoMedianoMinutos: medianDuration === null ? null : round(medianDuration),
      distribuicaoMinutos: {
        p25: percentile(durations, .25),
        p75: percentile(durations, .75),
        p90: percentile(durations, .90),
        minimo: durations.length ? round(Math.min(...durations)) : null,
        maximo: durations.length ? round(Math.max(...durations)) : null,
      },
      porOperador: [...byOperator].map(([operadorId, value]) => ({ operadorId, operador: value.nome, triagens: value.durations.length, tempoMedioMinutos: round(average(value.durations)!) })),
      porOrganizacao: [...byOrganization].map(([organizacaoId, values]) => ({ organizacaoId, triagens: values.length, tempoMedioMinutos: round(average(values)!) })),
      porPeriodo: [...byPeriod].sort(([a], [b]) => a.localeCompare(b)).map(([periodo, values]) => ({ periodo, triagens: values.length, tempoMedioMinutos: round(average(values)!) })),
      gargalo: pendingLots > 0 ? "Existem lotes aguardando início ou conclusão de triagem." : null,
      metodologia: "Duração calculada somente para sessões mensuráveis iniciadas/concluídas pelo fluxo explícito AV3. Sessões síncronas legadas AV2 permanecem no total de triagens concluídas, são identificadas separadamente e não entram nas métricas de duração.",
    };
    await this.repo.saveRun({
      tipo: "EFICIENCIA_OPERACIONAL",
      organizacaoId: filters.organizacaoId ?? null,
      metodo: "Agregação de timestamps persistidos",
      versaoModelo: "1.0.0",
      filtros: { ...filters },
      resultado: result,
      observacoes: measurable.length,
      indisponivel: measurable.length === 0,
      motivo: measurable.length === 0 ? "Não existem sessões com duração efetivamente mensurável no período; sessões legadas síncronas não são usadas para estimar tempo." : null,
      demonstracao: Boolean(filters.incluirDemonstracao),
      origemExecucao: filters.origemExecucao ?? "MANUAL",
      schedulerId: filters.schedulerId ?? null,
      jobId: filters.jobId ?? null,
      chaveExecucao: filters.schedulerId && filters.jobId ? `${filters.schedulerId}:${filters.jobId}` : null,
    });
    return result;
  }
}
