import type { CampaignSnapshot } from '../../src/domain/campaign.ts';
import type { AccessContext } from '../access.ts';
import type { D1DatabaseLike } from '../campaignRepository.ts';
import { hasFieldSessionHistorySchema } from '../fieldSessionHistory.ts';
import { buildMutationDomainEvent } from '../mutationEvents.ts';

export type NetworkEvent = {
  id:string; teamId:string; fieldSessionId:string|null; entityType:string; entityId:string;
  eventType:string; occurredAt:string; actorKind:string; actorRef:string|null;
  payload:Record<string,unknown>; dedupeKey:string;
};
/** Resolve the authenticated tour once, then record actual changes in the same commit. */
export async function networkEvents(db:D1DatabaseLike,before:CampaignSnapshot,after:CampaignSnapshot,access:AccessContext,intentId:string,taskId:string,timestamp:string):Promise<NetworkEvent[]> {
  if(!await hasFieldSessionHistorySchema(db))return [];
  const task=before.tasks.find(task=>task.id===taskId)!;
  const actor=await buildMutationDomainEvent(db,before,{id:intentId,campaignId:before.campaign.id,baseRevision:before.revision,createdAt:timestamp,type:'task.set-status',payload:{taskId,status:task.status,completedAt:task.completedAt,expectedUpdatedAt:task.updatedAt}},access,access.groupId);
  if(!actor)return [];
  const result:NetworkEvent[]=[];
  const append=(entityType:string,entityId:string,eventType:string,payload:Record<string,unknown>)=>{
    const key=`network:${intentId}:${entityType}:${entityId}`;
    result.push({...actor,id:`domain_event_${crypto.randomUUID()}`,entityType,entityId,eventType,occurredAt:timestamp,payload,dedupeKey:key});
  };
  const oldTasks=new Map(before.tasks.map(task=>[task.id,task]));
  for(const next of after.tasks){const old=oldTasks.get(next.id);if(!old||JSON.stringify(old.network)===JSON.stringify(next.network))continue;
    append('street-task',next.id,old.status!==next.status?'task.status.changed':'street.coverage.changed',{previousStatus:old.status,newStatus:next.status,coverage:next.network?.coverage});
  }
  const oldHouses=new Map((before.houseTasks??[]).map(house=>[house.id,house]));
  for(const next of after.houseTasks??[]){const old=oldHouses.get(next.id);if(old&&old.status!==next.status)append('house-task',next.id,'task.status.changed',{previousStatus:old.status,newStatus:next.status});}
  return result;
}
