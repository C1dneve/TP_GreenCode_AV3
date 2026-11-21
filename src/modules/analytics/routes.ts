import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AnalyticsController } from "./analytics.controller.js";
import type { AnalyticsFilters } from "./analytics.repository.js";
import { DomainError, errors } from "../../shared/domain-error.js";
const err = { $ref: "Erro#" } as const;
const uuid = { type: "string", format: "uuid" } as const;
const filters = { type: "object", additionalProperties: false, properties: { organizacaoId: { ...uuid, description: "UUID interno da organização (somente rota administrativa).", examples: ["1d2c3b4a-5566-4788-8999-aabbccddeeff"] }, de: { type: "string", format: "date-time", description: "Início inclusivo do período.", examples: ["2026-11-01T00:00:00.000Z"] }, ate: { type: "string", format: "date-time", description: "Fim inclusivo do período.", examples: ["2026-11-21T23:59:59.999Z"] }, incluirDemonstracao: { type: "boolean", default: false, description: "Disponível somente para a análise interna; endpoints públicos sempre excluem registros demonstrativos." } }, examples: [{ de: "2026-11-01T00:00:00.000Z", ate: "2026-11-21T23:59:59.999Z", incluirDemonstracao: false }] } as const;
interface AnalyticsFilterBody {
  organizacaoId?: string;
  de?: string;
  ate?: string;
  incluirDemonstracao?: boolean;
}

interface PublicAnalyticsBody {
  de?: string;
  ate?: string;
}

const internalAnalyticsExamples = [
  {
    periodo: { de: null, ate: null, criterio: "data de conclusão da triagem" },
    totalLotes: 2, lotesPendentes: 0, lotesComTriagemConcluida: 2,
    triagensConcluidas: 2, sessoesConcluidasHistoricas: 5, sessoesMensuraveis: 5,
    sessoesLegadasSincronas: 0, sessoesSemInicio: 0, sessoesComCronologiaInvalida: 0, sessoesSemConclusao: 0,
    tempoTotalProcessoMedioMinutos: 105, tempoTotalProcessoMedianoMinutos: 105,
    tempoEfetivoTriagemMedioMinutos: 105, tempoEfetivoTriagemMedianoMinutos: 105,
    tempoEsperaMedioMinutos: 0, tempoEsperaMedianoMinutos: 0,
    distribuicaoTempoTotalMinutos: { p25: 97.5, p75: 112.5, p90: 117, minimo: 90, maximo: 120 },
    porOperador: [
      { operadorId: "internal-operator-a", operador: "Operador A", lotesComAtividade: 2, sessoesComAtividade: 2, tempoEfetivoTriagemMinutos: 120, tempoEfetivoTotalMinutos: 120, sessoesConsideradas: 2, observacoesTempoPorSessao: 2, tempoEfetivoMedioPorSessaoMinutos: 60, tempoEfetivoMedianoPorSessaoMinutos: 60, lotesAtendidos: 2, observacoesTempoPorLote: 2, tempoMedioParticipacaoPorLoteMinutos: 60, participacaoPercentualTempoEfetivo: 57.14, observacoesParticipacaoPercentual: 2 },
      { operadorId: "internal-operator-b", operador: "Operador B", lotesComAtividade: 2, sessoesComAtividade: 2, tempoEfetivoTriagemMinutos: 90, tempoEfetivoTotalMinutos: 90, sessoesConsideradas: 3, observacoesTempoPorSessao: 3, tempoEfetivoMedioPorSessaoMinutos: 30, tempoEfetivoMedianoPorSessaoMinutos: 30, lotesAtendidos: 2, observacoesTempoPorLote: 2, tempoMedioParticipacaoPorLoteMinutos: 45, participacaoPercentualTempoEfetivo: 42.86, observacoesParticipacaoPercentual: 2 },
    ],
  },
  {
    equipamentosAvaliados: 1, avaliacoesComRealizacao: 1,
    valorEstimadoMedioPorEquipamento: 20, valorRealizadoMedioPorEquipamento: 18,
    valorEstimadoTotal: 20, valorRealizadoTotal: 18, desvioRealizadoVsEstimado: -2,
    porTipo: [{ nome: "NOTEBOOK", equipamentos: 1, estimadoMedio: 20, estimadoMinimo: 20, estimadoMaximo: 20, realizadoMedio: 18, realizacoes: 1 }],
    porMarca: [{ nome: "ACME", equipamentos: 1, estimadoMedio: 20, estimadoMinimo: 20, estimadoMaximo: 20, realizadoMedio: 18, realizacoes: 1 }],
    porModelo: [{ nome: "NB-14", equipamentos: 1, estimadoMedio: 20, estimadoMinimo: 20, estimadoMaximo: 20, realizadoMedio: 18, realizacoes: 1 }],
    porEstadoFisico: [{ nome: "BOM_ESTADO", equipamentos: 1, estimadoMedio: 20, estimadoMinimo: 20, estimadoMaximo: 20, realizadoMedio: 18, realizacoes: 1 }],
    relacaoPesoValor: [{ pesoQuilogramas: 2, valorEstimado: 20, valorRealizado: 18 }],
    detalhesEquipamentos: [{ equipamentoId: "internal-equipment-id", tipo: "NOTEBOOK", marca: "ACME", modelo: "NB-14", estadoFisico: "BOM_ESTADO", pesoQuilogramas: 2, pesoMaterialRecuperavelKg: 1, precoReferenciaPorKg: 20, percentualRecuperavel: 50, valorEstimado: 20, valorRealizado: 18, fonteEstimativa: "REFERENCIA_CADASTRADA", origemReferencia: "Cadastro interno de referência vigente", observacaoReferencia: null, referenciaRecuperacaoId: "internal-reference-id" }],
    observacao: "Valores estimados não são resultados financeiros reais; a realização só é apresentada quando registrada.",
  },
  {
    equipamentosAnalisados: 1, previsoesDisponiveis: 1, previsoesIndisponiveis: 0,
    vidaUtilRemanescenteMediaMeses: 24, confiabilidadeMedia: 0.81,
    previsoes: [{ equipamentoId: "internal-equipment-id", tipo: "NOTEBOOK", marca: "ACME", modelo: "NB-14", idadeAnos: 6, estadoFisico: "BOM_ESTADO", falhasObservadas: 0, manutencoesObservadas: 1, observacoes: 3, mesesRemanescentesEstimados: 24, dataEstimadaInservivel: "2028-11-21T00:00:00.000Z", tendenciaValorPorMes: -16.44, rSquared: 1, confiabilidade: 0.81, metodo: "Regressão linear OLS sobre valor estimado de depreciação x idade em meses, ajustada por condição física, falhas e manutenções", indisponivel: false, motivoIndisponibilidade: null }],
    limitacao: "Exige ao menos três observações em datas distintas, tendência negativa e R² mínimo de 0,35; o resultado é estimativo, não uma garantia de falha.",
  },
];

const publicAnalyticsExamples = [
  {
    periodo: { de: "2026-11-01T00:00:00.000Z", ate: "2026-11-21T23:59:59.999Z", criterio: "data de conclusão da triagem" },
    totalLotes: 2, lotesPendentes: 0, lotesComTriagemConcluida: 2, sessoesMensuraveis: 5,
    tempoTotalProcessoMedioMinutos: 105, tempoTotalProcessoMedianoMinutos: 105,
    tempoEfetivoTriagemMedioMinutos: 105, tempoEfetivoTriagemMedianoMinutos: 105,
    tempoEsperaMedioMinutos: 0, tempoEsperaMedianoMinutos: 0,
    distribuicaoTempoTotalMinutos: { p25: 97.5, p75: 112.5, p90: 117, minimo: 90, maximo: 120 },
    porPeriodo: [{ periodo: "2026-11", lotesConcluidos: 2, tempoTotalMedioMinutos: 105 }], gargalo: null,
    metodologia: "Tempos calculados a partir dos eventos de triagem mensuráveis; sessões sobrepostas não duplicam tempo efetivo.",
  },
  {
    equipamentosAvaliados: 1, avaliacoesComRealizacao: 1, valorEstimadoTotal: 20,
    valorRealizadoTotal: 18, valorEstimadoMedioPorEquipamento: 20,
    valorRealizadoMedioPorEquipamento: 18, desvioRealizadoVsEstimado: -2,
    porTipo: [{ nome: "NOTEBOOK", equipamentos: 1, estimadoMedio: 20, estimadoMinimo: 20, estimadoMaximo: 20, realizadoMedio: 18, realizacoes: 1 }],
    porMarca: [{ nome: "ACME", equipamentos: 1, estimadoMedio: 20, estimadoMinimo: 20, estimadoMaximo: 20, realizadoMedio: 18, realizacoes: 1 }],
    porModelo: [{ nome: "NB-14", equipamentos: 1, estimadoMedio: 20, estimadoMinimo: 20, estimadoMaximo: 20, realizadoMedio: 18, realizacoes: 1 }],
    porEstadoFisico: [{ nome: "BOM_ESTADO", equipamentos: 1, estimadoMedio: 20, estimadoMinimo: 20, estimadoMaximo: 20, realizadoMedio: 18, realizacoes: 1 }],
    relacaoPesoValor: [{ pesoQuilogramas: 2, valorEstimado: 20, valorRealizado: 18 }],
    detalhesEquipamentos: [{ tipo: "NOTEBOOK", marca: "ACME", modelo: "NB-14", estadoFisico: "BOM_ESTADO", pesoQuilogramas: 2, pesoMaterialRecuperavelKg: 1, precoReferenciaPorKg: 20, percentualRecuperavel: 50, valorEstimado: 20, valorRealizado: 18, fonteEstimativa: "REFERENCIA_CADASTRADA", origemReferencia: "Cadastro interno de referência vigente", observacaoReferencia: null }],
    observacao: "Valores estimados não são resultados financeiros reais; a realização só é apresentada quando registrada.",
  },
  {
    equipamentosAnalisados: 1, previsoesDisponiveis: 1, previsoesIndisponiveis: 0,
    vidaUtilRemanescenteMediaMeses: 24, confiabilidadeMedia: 0.81,
    previsoes: [{ tipo: "NOTEBOOK", marca: "ACME", modelo: "NB-14", idadeAnos: 6, estadoFisico: "BOM_ESTADO", falhasObservadas: 0, manutencoesObservadas: 1, observacoes: 3, mesesRemanescentesEstimados: 24, dataEstimadaInservivel: "2028-11-21T00:00:00.000Z", tendenciaValorPorMes: -16.44, rSquared: 1, confiabilidade: 0.81, metodo: "Regressão linear OLS sobre valor estimado de depreciação x idade em meses, ajustada por condição física, falhas e manutenções", indisponivel: false, motivoIndisponibilidade: null }],
    limitacao: "Exige ao menos três observações em datas distintas, tendência negativa e R² mínimo de 0,35; o resultado é estimativo, não uma garantia de falha.",
  },
];

type PublicHook = (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
type RateLimiter = { consume(key: string, limit: number): Promise<{ allowed: boolean; remaining: number; resetAt: number; retryAfterSeconds: number }> };
export function registerAnalyticsRoutes(app: FastifyInstance, controller: AnalyticsController, publicAuth: PublicHook, limiter: RateLimiter) {
  const auth = { preHandler: [app.authenticate, async (request: FastifyRequest, reply: FastifyReply) => { if (!(["ADMINISTRADOR", "AUDITOR"].includes(request.user.papel))) return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Permissão insuficiente.", requestId: request.id } }); }] };
  app.post<{ Body: AnalyticsFilterBody }>("/api/v1/analytics/vida-util/backtesting", { ...auth, schema: {
    tags: ["Análises"], summary: "Executa backtesting das previsões históricas de vida útil",
    description: "Compara previsões amadurecidas com a primeira transição auditada posterior para INSERVIVEL. Previsões sem evento observado são reportadas separadamente.",
    security: [{ bearerAuth: [] }], body: filters,
    response: { 200: { type: "object", additionalProperties: true, examples: [{ periodo: { de: null, ate: null, avaliadoAte: "2026-11-21T12:00:00.000Z" }, previsoesEncontradas: 2, previsoesAindaNaoMaduras: 0, previsoesMadurasSemEventoObservado: 1, previsoesAvaliadas: 1, erroMedioDias: 18, erroAbsolutoMedioDias: 18, erroPercentualAbsolutoMedio: 6.4, metodo: "Erro entre data prevista e primeira transição auditada para INSERVIVEL posterior à execução da previsão. MAPE usa o horizonte previsto como denominador; previsões sem evento observado são reportadas separadamente.", limitacao: "A ausência de evento não prova que o equipamento permaneceu utilizável." }] }, 400: err, 403: err },
  } }, async request => controller.backtestLife(normalizeFilters({ ...request.body, incluirDemonstracao: false })));
  app.post<{ Params: { tipo: string }; Body: AnalyticsFilterBody }>("/api/v1/analytics/:tipo", { ...auth, schema: { tags: ["Análises"], summary: "Executa e persiste uma análise GreenCode", description: "Escolha eficiencia-operacional, rentabilidade ou vida-util. A resposta contém os indicadores calculados e os metadados metodológicos do serviço selecionado. A rota exige JWT e papel ADMINISTRADOR ou AUDITOR; ADMINISTRADOR/AUDITOR são verificados no preHandler.", security: [{ bearerAuth: [] }], params: { type: "object", required: ["tipo"], properties: { tipo: { type: "string", enum: ["eficiencia-operacional", "rentabilidade", "vida-util"], examples: ["eficiencia-operacional"] } } }, body: filters, response: { 200: { type: "object", additionalProperties: true, examples: internalAnalyticsExamples }, 400: err, 403: err } } }, async request => controller.execute(request.params.tipo, normalizeFilters(request.body)));
  app.get<{ Params: { tipo: string }; Querystring: { organizacaoId?: string; limit?: number } }>("/api/v1/analytics/:tipo/historico", { ...auth, schema: { tags: ["Análises"], summary: "Consulta execuções analíticas persistidas", description: "Retorna as execuções mais recentes do tipo solicitado. O limite padrão é 20 e o máximo é 100 registros.", security: [{ bearerAuth: [] }], params: { type: "object", required: ["tipo"], properties: { tipo: { type: "string", enum: ["eficiencia-operacional", "rentabilidade", "vida-util"], examples: ["eficiencia-operacional"] } } }, querystring: { type: "object", additionalProperties: false, properties: { organizacaoId: { ...uuid, description: "Filtra por organização." }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20, examples: [20] } }, examples: [{ limit: 10 }] }, response: { 200: { type: "array", items: { type: "object" }, examples: [[{ tipo: "EFICIENCIA_OPERACIONAL", metodo: "Ciclo de lote (entrada→conclusão), união de sessões efetivas e espera", versaoModelo: "3.0.0", executadoEm: "2026-11-21T12:00:00.000Z", observacoes: 2, indisponivel: false, motivo: null, resultado: { lotesComTriagemConcluida: 2 } }]] }, 403: err } } }, async request => {
    const rows = await controller.history(request.params.tipo, request.query.organizacaoId);
    return rows.slice(0, request.query.limit ?? 20);
  });

  const publicPre = (scope: "analytics:read" | "analytics:write") => async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = request.integrationIdentity!; const [partner, key] = await Promise.all([limiter.consume(`partner:${identity.parceiroId}`, identity.limiteParceiroPorMinuto), limiter.consume(`key:${identity.apiKeyId}`, identity.limiteChavePorMinuto)]);
    reply.header("X-RateLimit-Limit", String(identity.limiteRequisicoesPorMinuto))
      .header("X-RateLimit-Remaining", String(Math.min(partner.remaining, key.remaining)))
      .header("X-RateLimit-Reset", String(Math.ceil(Math.max(partner.resetAt, key.resetAt) / 1000)));
    if (!partner.allowed || !key.allowed) {
      const retry = Math.max(partner.allowed ? 0 : partner.retryAfterSeconds, key.allowed ? 0 : key.retryAfterSeconds);
      reply.header("Retry-After", String(retry));
      throw new DomainError(429, "RATE_LIMIT_EXCEEDED", "Limite de requisições por minuto excedido.", { retryAfterSeconds: retry });
    }
    if (!identity.escoposEfetivos.includes(scope)) throw errors.forbidden(`Escopo necessário: ${scope}.`);
    if (Buffer.byteLength(JSON.stringify(request.body ?? {}), "utf8") > identity.maxPayloadBytes) throw new DomainError(413, "PAYLOAD_TOO_LARGE", "Payload excede o limite efetivo da API Key.");
  };
  const typeParams = { type: "object", required: ["tipo"], properties: { tipo: { type: "string", enum: ["eficiencia-operacional", "rentabilidade", "vida-util"] } } } as const;
  const publicBody = { type: "object", additionalProperties: false, properties: { de: { type: "string", format: "date-time", examples: ["2026-11-01T00:00:00.000Z"] }, ate: { type: "string", format: "date-time", examples: ["2026-11-21T23:59:59.999Z"] } }, examples: [{ de: "2026-11-01T00:00:00.000Z", ate: "2026-11-21T23:59:59.999Z" }] } as const;
  const publicIntegrationHeader = { type: "object", additionalProperties: true, required: ["x-api-key", "x-integration-id"], properties: { "x-api-key": { type: "string", description: "API Key enviada pelo header X-API-Key ou preenchida em Authorize." }, "x-integration-id": { type: "string", minLength: 1, maxLength: 64, description: "Identificador público parceiro-organização ativo.", examples: ["gci_0123456789abcdef0123456789abcdef"] } }, examples: [{ "x-api-key": "gc_live_COLOQUE_SUA_CHAVE", "x-integration-id": "gci_0123456789abcdef0123456789abcdef" }] } as const;
  app.post<{ Params: { tipo: string }; Body: PublicAnalyticsBody }>("/api/v1/public/analytics/:tipo", { onRequest: publicAuth, preHandler: [publicPre("analytics:write")], schema: { tags: ["API Pública", "Análises"], summary: "Executa análise no escopo da integração autorizada", description: "Requer API Key com analytics:write e X-Integration-ID ativo. A organização é resolvida pelo identificador público e os registros demonstrativos são sempre excluídos. Respostas: 401 chave inválida/ausente; 403 escopo insuficiente ou associação não autorizada; 404 integração ou tipo de análise inexistente; 413 payload acima do limite; 429 limite por parceiro/chave excedido (header Retry-After). A projeção pública remove dados internos de operadores e IDs do banco.", security: [{ apiKeyAuth: [] }], params: typeParams, headers: publicIntegrationHeader, body: publicBody, response: { 200: { type: "object", additionalProperties: true, examples: publicAnalyticsExamples }, 401: err, 403: err, 404: err, 400: err, 413: err, 429: err } } }, async request => {
    const identity = request.integrationIdentity!;
    const integrationId = request.headers["x-integration-id"];
    if (typeof integrationId !== "string" || !integrationId.trim()) throw errors.badRequest("MISSING_INTEGRATION_HEADER", "Informe X-Integration-ID.");
    const body = request.body ?? {};
    const normalizedFilters = normalizeFilters({ de: body.de, ate: body.ate, incluirDemonstracao: false });
    return controller.executePublicByIntegration(request.params.tipo, normalizedFilters, identity, request.id, integrationId);
  });
  app.get<{ Params: { tipo: string }; Querystring: { limit?: number } }>("/api/v1/public/analytics/:tipo/historico", { onRequest: publicAuth, preHandler: [publicPre("analytics:read")], schema: { tags: ["API Pública", "Análises"], summary: "Consulta análises persistidas da integração autorizada", description: "Requer analytics:read e X-Integration-ID. O histórico é restrito ao parceiro e à organização vinculada; não retorna porOperador ou identificadores internos. limit aceita 1 a 100 e assume 20.", security: [{ apiKeyAuth: [] }], params: typeParams, headers: publicIntegrationHeader, querystring: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 20, examples: [20] } }, examples: [{ limit: 10 }] }, response: { 200: { type: "array", items: { type: "object" }, examples: [[{ tipo: "EFICIENCIA_OPERACIONAL", metodo: "Ciclo de lote (entrada→conclusão), união de sessões efetivas e espera", versaoModelo: "3.0.0", executadoEm: "2026-11-21T12:00:00.000Z", observacoes: 2, confiabilidade: null, indisponivel: false, motivo: null, filtros: {}, resultado: { lotesComTriagemConcluida: 2 } }]] }, 401: err, 403: err, 404: err, 429: err } } }, async request => {
    const integrationId = request.headers["x-integration-id"];
    if (typeof integrationId !== "string" || !integrationId.trim()) throw errors.badRequest("MISSING_INTEGRATION_HEADER", "Informe X-Integration-ID.");
    return controller.historyPublicByIntegration(request.params.tipo, request.integrationIdentity!, integrationId, request.query.limit ?? 20);
  });
}
function normalizeFilters(input: AnalyticsFilterBody): AnalyticsFilters {
  const result: AnalyticsFilters = { incluirDemonstracao: input.incluirDemonstracao === true };
  if (input.organizacaoId) result.organizacaoId = input.organizacaoId;
  if (input.de) {
    const date = new Date(input.de);
    if (!Number.isFinite(date.getTime())) throw errors.badRequest("VALIDATION_ERROR", "Filtro de inválido.");
    result.de = date;
  }
  if (input.ate) {
    const date = new Date(input.ate);
    if (!Number.isFinite(date.getTime())) throw errors.badRequest("VALIDATION_ERROR", "Filtro ate inválido.");
    result.ate = date;
  }
  if (result.de && result.ate && result.de > result.ate) throw errors.badRequest("VALIDATION_ERROR", "de não pode ser posterior a ate.");
  return result;
}
