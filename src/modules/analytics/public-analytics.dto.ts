export function publicAnalyticsProjection(type: string, value: unknown): unknown {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  if (type === "eficiencia-operacional") {
    const allowed = [
      "periodo", "totalLotes", "lotesPendentes", "lotesComTriagemConcluida", "triagensConcluidas",
      "sessoesMensuraveis", "sessoesLegadasSincronas", "sessoesSemInicio",
      "sessoesComCronologiaInvalida", "sessoesSemConclusao",
      "tempoTotalProcessoMedioMinutos", "tempoTotalProcessoMedianoMinutos",
      "tempoEfetivoTriagemMedioMinutos", "tempoEfetivoTriagemMedianoMinutos",
      "tempoEsperaMedioMinutos", "tempoEsperaMedianoMinutos", "distribuicaoTempoTotalMinutos",
      "porPeriodo", "gargalo", "metodologia",
    ];
    return Object.fromEntries(allowed.filter(key => key in result).map(key => [key, result[key]]));
  }
  if (type === "rentabilidade") {
    const allowed = [
      "equipamentosAvaliados", "avaliacoesComRealizacao", "valorEstimadoTotal", "valorRealizadoTotal",
      "valorEstimadoMedioPorEquipamento", "valorRealizadoMedioPorEquipamento",
      "desvioRealizadoVsEstimado", "porTipo", "porMarca", "porModelo", "porEstadoFisico",
      "relacaoPesoValor", "observacao",
    ];
    const details = Array.isArray(result.detalhesEquipamentos)
      ? result.detalhesEquipamentos.map(item => {
          if (!item || typeof item !== "object") return null;
          const { equipamentoId: _equipmentId, referenciaRecuperacaoId: _referenceId, ...publicFields } = item as Record<string, unknown>;
          return publicFields;
        }).filter(Boolean)
      : [];
    return {
      ...Object.fromEntries(allowed.filter(key => key in result).map(key => [key, result[key]])),
      detalhesEquipamentos: details,
    };
  }
  if (type === "vida-util") {
    const predictions = Array.isArray(result.previsoes)
      ? result.previsoes.map(item => {
          if (!item || typeof item !== "object") return null;
          const { equipamentoId: _internalId, ...publicFields } = item as Record<string, unknown>;
          return publicFields;
        }).filter(Boolean)
      : [];
    return {
      equipamentosAnalisados: result.equipamentosAnalisados,
      previsoesDisponiveis: result.previsoesDisponiveis,
      previsoesIndisponiveis: result.previsoesIndisponiveis,
      vidaUtilRemanescenteMediaMeses: result.vidaUtilRemanescenteMediaMeses,
      confiabilidadeMedia: result.confiabilidadeMedia,
      previsoes: predictions,
      limitacao: result.limitacao,
    };
  }
  return null;
}
