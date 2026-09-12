import { areaPreparationFingerprint, getAreaTaskPreparationState, runAreaTaskPreparation, type AreaTaskPreparationOptions } from '../areaTaskPreparation.ts';
import { loadCanonicalArea, type D1DatabaseLike } from '../campaignRepository.ts';
import { requestDatabase } from '../requestDatabase.ts';

export type PreparationAlarmStorage = {
  get<T>(key:string):Promise<T|undefined>;
  put(key:string,value:unknown):Promise<void>;
  setAlarm(time:number):Promise<void>;
  getAlarm():Promise<number|null>;
  deleteAlarm():Promise<void>;
};

/** D1 is authoritative; durable storage holds only the campaign wake-up key. */
export class PreparationRunner {
  constructor(private storage:PreparationAlarmStorage, private db:D1DatabaseLike, private options:AreaTaskPreparationOptions={}) {}
  async schedule(campaignId:string,restart=false) {
    const current=await this.storage.get<string>('preparationCampaign');
    if(current && current!==campaignId)throw new Error('preparation_scope_mismatch');
    await this.storage.put('preparationCampaign',campaignId);
    if(restart)await this.storage.put('preparationRunnerFailures',0);
    if(await this.storage.getAlarm()===null)await this.storage.setAlarm(Date.now()+1);
  }
  async alarm() {
    const db=requestDatabase(this.db,50);
    const campaignId=await this.storage.get<string>('preparationCampaign');
    if(!campaignId)return;
    const failures=(await this.storage.get<number>('preparationRunnerFailures')??0)+1;
    if(failures>6){
      await this.storage.deleteAlarm();
      await db.batch([db.prepare("UPDATE area_task_preparations SET status='failed',last_error_code='area_preparation_runner_unavailable',failed_at=?,updated_at=? WHERE campaign_id=? AND status='pending'").bind(new Date().toISOString(),new Date().toISOString(),campaignId)]);
      return;
    }
    await this.storage.put('preparationRunnerFailures',failures);
    // Arm crash recovery before any fetch. A killed invocation leaves a durable wake-up.
    await this.storage.setAlarm(Date.now()+65000);
    // One bounded phase per invocation preserves the per-request D1 budget.
    {
      const pending=await db.prepare("SELECT area_id FROM area_task_preparations WHERE campaign_id=? AND status='pending' ORDER BY updated_at,area_id LIMIT 1").bind(campaignId).first<{area_id:string}>();
      if(!pending){await this.storage.put('preparationRunnerFailures',0);await this.storage.deleteAlarm();return;}
      const state=await getAreaTaskPreparationState(db,campaignId,pending.area_id);
      const area=await loadCanonicalArea(db,campaignId,pending.area_id);
      if(!state||!area){await this.storage.setAlarm(Date.now()+1000);return;}
      if(await areaPreparationFingerprint(area.geometry)!==state.geometryHash) {
        await db.batch([db.prepare("UPDATE area_task_preparations SET status='failed',last_error_code='area_preparation_stale',failed_at=?,updated_at=? WHERE campaign_id=? AND area_id=? AND generation=? AND status='pending'").bind(new Date().toISOString(),new Date().toISOString(),campaignId,area.id,state.generation)]);
        await this.storage.put('preparationRunnerFailures',0);
        await this.storage.setAlarm(Date.now()+100);return;
      }
      const job=await db.prepare('SELECT lease_until FROM street_network_jobs WHERE campaign_id=? AND area_id=? AND generation=?').bind(campaignId,area.id,state.generation).first<{lease_until:string|null}>();
      const retryAt=job?.lease_until?Date.parse(job.lease_until):0;
      if(retryAt>Date.now()){await this.storage.put('preparationRunnerFailures',0);await this.storage.setAlarm(retryAt+50);return;}
      await runAreaTaskPreparation(db,{campaignId,areaId:area.id,area,geometryHash:state.geometryHash,generation:state.generation,now:new Date().toISOString()},this.options);
    }
    await this.storage.put('preparationRunnerFailures',0);
    await this.storage.setAlarm(Date.now()+100);
  }
}
