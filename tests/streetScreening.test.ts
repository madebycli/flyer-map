import test from 'node:test';
import assert from 'node:assert/strict';
import type { DistributionTask, HouseTask } from '../src/domain/campaign.ts';
import { screenDistributionStreets } from '../src/domain/streetScreening.ts';

function road(id:string,label:string,prepared=true):DistributionTask {
  return {
    id,campaignId:'campaign',areaId:'area',taskType:'street',label,
    geometry:{type:'LineString',coordinates:[[13,51],[13.001,51]]},
    source:{dataset:'OpenStreetMap',objectType:'way',objectIds:[1]},
    areaPreparationGeneration:prepared?'generation':null,
    status:'open',completedAt:null,createdAt:'2026-09-16T00:00:00Z',updatedAt:'2026-09-16T00:00:00Z',
    ...(prepared?{network:{fromNode:'a',toNode:'b',length:70,coverage:[]}}:{}),
  };
}

function house(id:string,parentStreetTaskId:string|null):HouseTask {
  return {
    id,campaignId:'campaign',areaId:'area',taskType:'house',label:id,
    geometry:{type:'Polygon',coordinates:[[[13,51],[13.0001,51],[13.0001,51.0001],[13,51.0001],[13,51]]]},
    source:{dataset:'OpenStreetMap',objectType:'way',objectIds:[2]},areaPreparationGeneration:'generation',
    parentStreetTaskId,status:'open',completedAt:null,createdAt:'2026-09-16T00:00:00Z',updatedAt:'2026-09-16T00:00:00Z',
  };
}

test('classic screening preserves the entire prepared output',()=>{
  const tasks=[road('unnamed','Straße'),road('named','Rosenweg')];
  const result=screenDistributionStreets(tasks,[], 'classic');
  assert.deepEqual(result.tasks.map(task=>task.id),['unnamed','named']);
  assert.deepEqual(result.hiddenTaskIds,[]);
});

test('delivery-v2 hides only auto-prepared generic unnamed streets without assigned houses',()=>{
  const tasks=[
    road('unused','Straße'),
    road('served','Straße'),
    road('named','Rosenweg'),
    road('manual','Straße',false),
  ];
  const result=screenDistributionStreets(tasks,[house('house-1','served')], 'delivery-v2');
  assert.deepEqual(result.hiddenTaskIds,['unused']);
  assert.deepEqual(result.tasks.map(task=>task.id),['served','named','manual']);
  assert.equal(result.decisions.find(decision=>decision.taskId==='served')?.reason,'serves_houses');
  assert.equal(result.decisions.find(decision=>decision.taskId==='unused')?.reason,'unnamed_without_houses');
});

test('delivery-v2 never hides a street merely because a house or business name is absent',()=>{
  const named=road('business-address-road','Gewerbepark');
  const result=screenDistributionStreets([named],[house('home-business',null)],'delivery-v2');
  assert.deepEqual(result.hiddenTaskIds,[]);
  assert.equal(result.decisions[0].reason,'named_or_referenced');
});
