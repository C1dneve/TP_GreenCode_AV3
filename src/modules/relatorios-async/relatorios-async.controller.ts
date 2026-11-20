import type { IntegrationIdentity } from "../api-publica/integration-auth.js";
import { RelatoriosAsyncService } from "./relatorios-async.service.js";
export class RelatoriosAsyncController {
  constructor(private readonly service: RelatoriosAsyncService) {}
  requestInternal(body: any, actor: string, requestId: string) { return this.service.requestInternal(body, actor, requestId); }
  requestPublic(body: any, identity: IntegrationIdentity, requestId: string) { return this.service.requestPublic(body, identity, requestId); }
  listInternal(query: any) { return this.service.listInternal(query); }
  listPublic(identity: IntegrationIdentity, query: any) { return this.service.listPublic(identity, query); }
  getInternal(id: string) { return this.service.getInternal(id); }
  reprocess(id: string, actor: string, requestId: string) { return this.service.reprocess(id, actor, requestId); }
  getPublic(id: string, identity: IntegrationIdentity) { return this.service.getPublic(id, identity); }
  download(id: string, actor: { usuarioId?: string; parceiroId?: string; apiKeyId?: string; escoposEfetivos?: string[] }, requestId: string) { return this.service.download(id, actor, requestId); }
}
