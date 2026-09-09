import type { D1DatabaseLike } from './campaignRepository.ts';
import { hasBaseStorage } from './streetNetwork/baseStorage.ts';
/** Query-only union: old event rows plus exact individual events from new batches. */
export async function domainEventHistoryRelation(db:D1DatabaseLike){
  return await hasBaseStorage(db)?'domain_event_history':'domain_events';
}
