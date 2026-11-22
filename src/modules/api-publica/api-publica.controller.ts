import type { IntegrationIdentity } from "./integration-auth.js";
import type { ApiPublicaService, PublicSubmissionInput } from "./api-publica.service.js";

export class ApiPublicaController {
  constructor(private readonly service: ApiPublicaService) {}

  submit(input: PublicSubmissionInput, identity: IntegrationIdentity, integrationId: string, idempotencyKey: string, requestId: string) {
    return this.service.submit(input, identity, integrationId, idempotencyKey, requestId);
  }

  listLots(query: { page?: number; pageSize?: number; status?: string; externalId?: string; dataEntradaDe?: string; dataEntradaAte?: string; ativo?: boolean }, identity: IntegrationIdentity) {
    return this.service.listLots(query, identity);
  }

  getLot(publicId: string, identity: IntegrationIdentity) {
    return this.service.getLot(publicId, identity);
  }

  updateLot(publicId: string, input: { versaoEsperada: number; notaFiscal?: string; transportadora?: string; observacoes?: string }, identity: IntegrationIdentity, requestId: string) {
    return this.service.updateLot(publicId, input, identity, requestId);
  }

  cancelLot(publicId: string, versaoEsperada: number, identity: IntegrationIdentity, requestId: string) {
    return this.service.cancelLot(publicId, versaoEsperada, identity, requestId);
  }

  getByPublicId(publicId: string, identity: IntegrationIdentity, requestId: string) {
    return this.service.getByPublicId(publicId, identity, requestId);
  }

  getByExternalId(externalId: string, identity: IntegrationIdentity, requestId: string) {
    return this.service.getByExternalId(externalId, identity, requestId);
  }
}
