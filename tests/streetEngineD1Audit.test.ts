import assert from 'node:assert/strict';
import test from 'node:test';
import { createRxDatabase } from 'rxdb';
import { replicateRxCollection } from 'rxdb/plugins/replication';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { BudgetD1 } from './helpers/d1Budget.ts';
import { seedNetwork } from './helpers/networkD1.ts';
import { handleRxdbCheckpoint, handleRxdbPull, handleRxdbPush } from '../worker/rxdbSync.ts';
import { beginAreaTaskPreparation } from '../worker/areaTaskPreparation.ts';
import { requestDatabase } from '../worker/requestDatabase.ts';
import type { AccessContext } from '../worker/access.ts';

// Phase A characterizations: these deliberately expose current defects. Replace
// the defect assertions with the desired invariants when their fixes are made.
const stamp='2026-09-07T00:00:00.000Z';
const access:AccessContext={campaignId:'campaign_n',grantId:'audit',role:'admin',teamId:null,label:null};
const team={id:'team_n',campaignId:'campaign_n',name:'Team',color:'#2563eb',createdAt:stamp,updatedAt:stamp};

function seedLegacyHouses(db:BudgetD1,count:number){
  const insert=db.sqlite.prepare("INSERT INTO house_tasks(id,campaign_id,area_id,label,geometry_json,status,created_at,updated_at) VALUES(?,'campaign_n','area_n',? ,?,'open',?,?)");
  const polygon=JSON.stringify({type:'Polygon',coordinates:[[[13.001,51.001],[13.002,51.001],[13.002,51.002],[13.001,51.001]]]});
  db.sqlite.exec('BEGIN');
  for(let i=0;i<count;i++)insert.run(`house_${i}`,String(i),polygon,stamp,stamp);
  db.sqlite.exec('COMMIT');db.resetBudget();
}

test('audit: one Team rename rereads every unrelated legacy House three times',async(t)=>{
  const db=new BudgetD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);seedLegacyHouses(db,2000);
  const response=await handleRxdbPush(db,'campaign_n','teams',access,{rows:[{assumedMasterState:team,newDocumentState:{...team,name:'Renamed'}}]});
  assert.equal(response.status,200);assert.deepEqual((await response.json() as any).rejections,[]);
  const report=db.report();
  assert.ok(report.returnedRows>=6000,JSON.stringify(report));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM house_tasks').get()!.n,2000);
  t.diagnostic(JSON.stringify({operation:'one-team-rename',houses:2000,statements:report.statements,returnedRows:report.returnedRows,snapshotRows:report.snapshotRows}));
});

test('audit: preparation begin loads unrelated Houses; repeated start keeps generation',async(t)=>{
  const db=new BudgetD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);seedLegacyHouses(db,2000);
  const first=await beginAreaTaskPreparation(requestDatabase(db),'campaign_n','area_n');
  assert.equal(first.outcome,'run');const firstReport=db.report();db.resetBudget();
  const second=await beginAreaTaskPreparation(requestDatabase(db),'campaign_n','area_n');
  assert.equal(second.outcome,'run');
  if(first.outcome!=='run'||second.outcome!=='run')throw new Error('missing run');
  assert.equal(first.run.generation,second.run.generation);
  assert.ok(firstReport.returnedRows>=2000);assert.ok(db.report().returnedRows>=2000);
  t.diagnostic(JSON.stringify({operation:'begin-and-duplicate',firstReturnedRows:firstReport.returnedRows,duplicateReturnedRows:db.report().returnedRows}));
});

test('audit: idle safety checkpoint reads no task snapshot even with 2000 Houses',async(t)=>{
  const db=new BudgetD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);seedLegacyHouses(db,2000);
  const response=await handleRxdbCheckpoint(requestDatabase(db),'campaign_n',access);
  assert.equal(response.status,200);assert.equal(db.report().snapshotRows,0);
  t.diagnostic(JSON.stringify({operation:'idle-checkpoint',statements:db.report().statements,returnedRows:db.report().returnedRows}));
});

test('audit: actual RxDB stops after a deduplicated short page before the feed head',async(t)=>{
  const db=new BudgetD1(true,true);seedNetwork(db);t.after(()=>db.sqlite.close());
  const insert=db.sqlite.prepare("INSERT INTO campaign_sync_changes(campaign_id,collection_name,document_id,operation,scope_team_id,document_json,changed_at) VALUES('campaign_n','teams','team_n','upsert','team_n',?,?)");
  for(let i=1;i<=101;i++)insert.run(JSON.stringify({...team,name:`Version ${i}`}),stamp);
  const local=await createRxDatabase({name:`audit-${crypto.randomUUID()}`,storage:getRxStorageMemory(),multiInstance:false});
  const collections=await local.addCollections({teams:{schema:{title:'Audit team',version:0,primaryKey:'id',type:'object',properties:{id:{type:'string',maxLength:160},campaignId:{type:'string'},name:{type:'string'},color:{type:'string'},createdAt:{type:'string'},updatedAt:{type:'string'}},required:['id','campaignId','name','color','createdAt','updatedAt']}}});
  const calls:{from:number;to:number;documents:number}[]=[];
  const replication=replicateRxCollection({replicationIdentifier:'audit-short-feed',collection:collections.teams,live:false,waitForLeadership:false,pull:{batchSize:100,handler:async(checkpoint:any,batchSize:number)=>{
    const response=await handleRxdbPull(requestDatabase(db),'campaign_n','teams',access,{checkpoint:checkpoint??{seq:0},batchSize});
    assert.equal(response.status,200);
    const body=await response.json() as any;calls.push({from:checkpoint?.seq??0,to:body.checkpoint.seq,documents:body.documents.length});
    return {documents:body.documents.map((doc:any)=>({...doc,_deleted:false})),checkpoint:body.checkpoint};
  }}});
  try{
    await replication.awaitInitialReplication();
    const document=await collections.teams.findOne('team_n').exec();
    assert.equal(document?.get('name'),'Version 100');
    assert.deepEqual(calls,[{from:0,to:100,documents:1}]);
    const next=await handleRxdbPull(requestDatabase(db),'campaign_n','teams',access,{checkpoint:{seq:100},batchSize:100});
    assert.equal((await next.json() as any).documents[0].name,'Version 101');
    t.diagnostic(JSON.stringify({operation:'actual-rxdb-short-page',calls,unreadFeedRows:1}));
  }finally{await replication.cancel();await local.remove();}
});

test('audit: legacy read estimator misses an aliased full scan',async(t)=>{
  const db=new BudgetD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);seedLegacyHouses(db,2000);
  const sql="SELECT COUNT(*) n FROM house_tasks h WHERE h.label='absent'";
  const plan=db.sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all();
  assert.ok(plan.some(row=>String(row.detail)==='SCAN h'));
  await db.prepare(sql).first();
  assert.equal(db.report().estimatedRowsRead,1);
  t.diagnostic(JSON.stringify({operation:'aliased-full-scan',physicalTableRows:2000,estimatedRowsRead:db.report().estimatedRowsRead,plan}));
});
