import test from 'node:test';
import assert from 'node:assert/strict';
import { GenerationVisibility } from '../src/data/generationVisibility.ts';
import { NetworkD1,seedNetwork,networkOsm } from './helpers/networkD1.ts';
import { prepareAreaTasks } from '../worker/areaTaskPreparation.ts';
import { loadCampaignSnapshot } from '../worker/campaignRepository.ts';
import { handleRxdbPull } from '../worker/rxdbSync.ts';

test('separate Street/House deliveries expose only complete generations and delete cannot resurrect buffered work',async()=>{
 const db=new NetworkD1(true);seedNetwork(db);await prepareAreaTasks(db,'campaign_n','area_n',{fetchImpl:async()=>networkOsm()});
 const old=(await loadCampaignSnapshot(db,'campaign_n'))!;
 const response=await handleRxdbPull(db,'campaign_n','streetTasks',{campaignId:'campaign_n',role:'admin',teamId:null,label:null,grantId:'test'},{});
 const {generationState}=await response.json() as any;
 const generationManifests=generationState.manifests;
 assert.equal(generationManifests[0].houses,3);
 const visibility=new GenerationVisibility();visibility.accept(generationManifests,old.revision);
 assert.equal(visibility.project(old).houseTasks!.length,3);
 const next={...old,revision:old.revision+1,tasks:old.tasks.map(t=>({...t,areaPreparationGeneration:'next'})),houseTasks:old.houseTasks!.map(t=>({...t,areaPreparationGeneration:'next'}))};
 const manifests=[{areaId:'area_n',generation:'next',streets:next.tasks.length,houses:3}];visibility.accept(manifests,next.revision);
 for(const partial of [{...old,tasks:next.tasks},{...old,houseTasks:next.houseTasks.slice(0,1)}]){
  const visible=visibility.project(partial);assert.equal(visible.tasks[0].areaPreparationGeneration,old.tasks[0].areaPreparationGeneration);assert.equal(visible.houseTasks!.length,3);
 }
 // A fresh offline runtime restores the manifest and suppresses partial data.
 const restored=new GenerationVisibility();const state=visibility.state();restored.accept(state.manifests,state.revision);
 assert.equal(restored.project({...old,tasks:next.tasks}).tasks.length,0);
 assert.equal(visibility.project(next).tasks[0].areaPreparationGeneration,'next');
 assert.equal(visibility.accept(generationManifests,old.revision),false);
 const removed=visibility.project({...next,areas:[],tasks:[],houseTasks:[]});assert.equal(removed.tasks.length,0);assert.equal(removed.houseTasks!.length,0);
 db.sqlite.close();
});
