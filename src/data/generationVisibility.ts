import type { CampaignSnapshot } from '../domain/campaign.ts';

export type GenerationManifest={areaId:string;generation:string;streets:number;houses:number};
/** Never expose a mixture while independently replicated collections catch up. */
export class GenerationVisibility {
  private manifests=new Map<string,GenerationManifest>();
  private revision=-1;
  private previous:CampaignSnapshot|null=null;
  accept(manifests:GenerationManifest[],revision:number){
    if(!Number.isSafeInteger(revision)||revision<this.revision)return false;
    if(!Array.isArray(manifests)||manifests.some(m=>!m||typeof m.areaId!=='string'||typeof m.generation!=='string'||!Number.isSafeInteger(m.streets)||!Number.isSafeInteger(m.houses)||m.streets<0||m.houses<0))return false;
    this.revision=revision;this.manifests=new Map(manifests.map(m=>[m.areaId,m]));return true;
  }
  state(){return {revision:this.revision,manifests:[...this.manifests.values()]};}
  project(snapshot:CampaignSnapshot):CampaignSnapshot{
    const blocked=new Set<string>();
    const counts=new Map<string,{streets:number;houses:number;generations:Set<string>}>();
    for(const entity of [...snapshot.tasks,...snapshot.houseTasks??[]]){
      if(!entity.areaPreparationGeneration)continue;
      const count=counts.get(entity.areaId)??{streets:0,houses:0,generations:new Set<string>()};
      if(entity.taskType==='street')count.streets++;else count.houses++;
      count.generations.add(entity.areaPreparationGeneration);counts.set(entity.areaId,count);
    }
    for(const area of snapshot.areas){
      const manifest=this.manifests.get(area.id);
      const count=counts.get(area.id)??{streets:0,houses:0,generations:new Set<string>()};
      if(manifest){
        if(count.streets!==manifest.streets||count.houses!==manifest.houses||[...count.generations].some(g=>g!==manifest.generation))blocked.add(area.id);
      }else if(count.generations.size>1){blocked.add(area.id);}
    }
    const visibleAreas=new Set(snapshot.areas.map(a=>a.id));
    const result=blocked.size?{...snapshot,
      tasks:[...snapshot.tasks.filter(t=>!blocked.has(t.areaId)||!t.areaPreparationGeneration),...(this.previous?.tasks??[]).filter(t=>visibleAreas.has(t.areaId)&&blocked.has(t.areaId)&&t.areaPreparationGeneration)],
      houseTasks:[...(snapshot.houseTasks??[]).filter(t=>!blocked.has(t.areaId)||!t.areaPreparationGeneration),...(this.previous?.houseTasks??[]).filter(t=>visibleAreas.has(t.areaId)&&blocked.has(t.areaId)&&t.areaPreparationGeneration)],
    }:snapshot;
    this.previous=result;return result;
  }
}
