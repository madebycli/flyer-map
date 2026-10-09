/**
 * Retired: the realtime/RxDB coordinator of the old map. The class stays exported only because the deployed Worker's Durable Object
 * migration history names it; taking the class away needs a `deleted_classes` migration, which destroys the object's stored data and
 * therefore waits for an explicit go (docs/status/CURRENT.md). It answers nothing.
 */
export class CampaignSyncDurableObject {
  constructor(_state?: unknown, _env?: unknown) {}
  async fetch(): Promise<Response> {
    return Response.json({ error: { code: "retired", message: "Dieser Dienst wurde abgelöst." } }, { status: 410 });
  }
}
