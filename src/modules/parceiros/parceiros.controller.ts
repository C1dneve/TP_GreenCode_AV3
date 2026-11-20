import { ParceirosService } from "./parceiros.service.js";
export class ParceirosController {
  constructor(private readonly service: ParceirosService) {}
  list(query: any) { return this.service.list(query); }
  get(id: string) { return this.service.get(id); }
  create(body: any, actorId: string, requestId: string) { return this.service.create(body, { usuarioId: actorId, requestId }); }
  update(id: string, body: any, actorId: string, requestId: string) { return this.service.update(id, body, { usuarioId: actorId, requestId }); }
  active(id: string, active: boolean, actorId: string, requestId: string) { return this.service.changeActive(id, active, { usuarioId: actorId, requestId }); }
  listOrganizations(id: string) { return this.service.listOrganizations(id); }
  associateOrganization(id: string, organizationId: string, actorId: string, requestId: string) { return this.service.associateOrganization(id, organizationId, { usuarioId: actorId, requestId }); }
  revokeOrganization(id: string, associationId: string, actorId: string, requestId: string) { return this.service.revokeOrganization(id, associationId, { usuarioId: actorId, requestId }); }
  listKeys(id: string) { return this.service.listKeys(id); }
  createKey(id: string, body: any, actorId: string, requestId: string) { return this.service.createKey(id, body, { usuarioId: actorId, requestId }); }
  getKey(id: string, keyId: string) { return this.service.getKey(id, keyId); }
  updateKey(id: string, keyId: string, body: any, actorId: string, requestId: string) { return this.service.updateKey(id, keyId, body, { usuarioId: actorId, requestId }); }
  revokeKey(id: string, keyId: string, actorId: string, requestId: string) { return this.service.revokeKey(id, keyId, { usuarioId: actorId, requestId }); }
}
