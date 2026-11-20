import type { IntegrationIdentity } from "./integration-auth.js";
import type { ApiPublicaService, PublicSubmissionInput } from "./api-publica.service.js";

export class ApiPublicaController {
  constructor(private readonly service: ApiPublicaService) {}

  submit(input: PublicSubmissionInput, identity: IntegrationIdentity, integrationId: string, idempotencyKey: string, requestId: string) {
    return this.service.submit(input, identity, integrationId, idempotencyKey, requestId);
  }

  getByPublicId(publicId: string, identity: IntegrationIdentity, requestId: string) {
    return this.service.getByPublicId(publicId, identity, requestId);
  }

  getByExternalId(externalId: string, identity: IntegrationIdentity, requestId: string) {
    return this.service.getByExternalId(externalId, identity, requestId);
  }
}
