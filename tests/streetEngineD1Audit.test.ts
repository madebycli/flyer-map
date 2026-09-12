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
import { handleAreaTaskPreparationApi } from '../worker/areaTaskPreparationApi.ts';
import type { AccessContext } from '../worker/access.ts';

const stamp='2026-09-07T00:00:00.000Z';
const access:AccessContext={campaignId:'campaign_n',grantId:'audit',role:'admin',teamId:null,label:null};
const team={id:'team_n',campaignId:'campaign_n',name:'Team',color:'#2563eb',createdAt:stamp,updatedAt:stamp};
const area={id:'area_n',campaignId:'campaign_n',teamId:'team_n',name:'Area',geometry:{type:'Polygon',coordinates:[[[13,51],[13.01,51],[13.01,51.01],[13,51.01],[13,51]]]},createdAt:stamp,updatedAt:stamp};

function seedLegacyHouses(db:BudgetD1,count:number){
  const insert=db.sqlite.prepare("INSERT INTO house_tasks(id,campaign_id,area_id,label,geometry_json,status,created_at,updated_at) VALUES(?,'campaign_n','area_n',? ,?,'open',?,?)");
  const polygon=JSON.stringify({type:'Polygon',coordinates:[[[13.001,51.001],[13.002,51.001],[13.002,51.002],[13.001,51.001]]]});
  db.sqlite.exec('BEGIN');
  for(let i=0;i<count;i++)insert.run(`house_${i}`,String(i),polygon,stamp,stamp);
  db.sqlite.exec('COMMIT');db.resetBudget();
}

test('audit: one Team rename uses projected reads instead of unrelated legacy Houses',async(t)=>{
  const db=new BudgetD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);seedLegacyHouses(db,2000);
  const response=await handleRxdbPush(db,'campaign_n','teams',access,{rows:[{assumedMasterState:team,newDocumentState:{...team,name:'Renamed'}}]});
  assert.equal(response.status,200);assert.deepEqual((await response.json() as any).rejections,[]);
  const report=db.report();
  assert.ok(report.returnedRows<200,JSON.stringify(report));
  assert.ok(report.snapshotRows<10,JSON.stringify(report));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM house_tasks').get()!.n,2000);
  t.diagnostic(JSON.stringify({operation:'one-team-rename',houses:2000,statements:report.statements,returnedRows:report.returnedRows,snapshotRows:report.snapshotRows}));
});

test('audit: deleting a prepared Area skips its generated child snapshot under D1 read pressure',async(t)=>{
  const db=new BudgetD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);seedLegacyHouses(db,2000);
  db.sqlite.prepare('INSERT INTO street_base_areas(campaign_id,area_id,generation) VALUES(?,?,?)').run('campaign_n','area_n','generation-delete');
  db.resetBudget();
  const response=await handleRxdbPush(db,'campaign_n','areas',access,{rows:[{assumedMasterState:area,newDocumentState:{...area,_deleted:true}}]});
  const body=await response.json() as any;
  assert.equal(response.status,200,JSON.stringify(body));
  assert.deepEqual(body.rejections,[]);
  const report=db.report();
  assert.ok(report.snapshotRows<20,JSON.stringify(report));
  assert.ok(report.returnedRows<200,JSON.stringify(report));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM areas WHERE id='area_n'").get()!.n,0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM house_tasks WHERE area_id='area_n'").get()!.n,0);
  t.diagnostic(JSON.stringify({operation:'prepared-area-delete',houses:2000,statements:report.statements,returnedRows:report.returnedRows,snapshotRows:report.snapshotRows,estimatedRowsRead:report.estimatedRowsRead}));
});

test('audit: preparation begin reads only the requested Area; repeated start keeps generation',async(t)=>{
  const db=new BudgetD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);seedLegacyHouses(db,2000);
  const first=await beginAreaTaskPreparation(requestDatabase(db),'campaign_n','area_n');
  assert.equal(first.outcome,'run');const firstReport=db.report();db.resetBudget();
  const second=await beginAreaTaskPreparation(requestDatabase(db),'campaign_n','area_n');
  assert.equal(second.outcome,'run');
  if(first.outcome!=='run'||second.outcome!=='run')throw new Error('missing run');
  assert.equal(first.run.generation,second.run.generation);
  assert.ok(firstReport.returnedRows<200,JSON.stringify(firstReport));assert.ok(db.report().returnedRows<200,JSON.stringify(db.report()));
  t.diagnostic(JSON.stringify({operation:'begin-and-duplicate',firstReturnedRows:firstReport.returnedRows,duplicateReturnedRows:db.report().returnedRows}));
});

test('audit: idle safety checkpoint reads no task snapshot even with 2000 Houses',async(t)=>{
  const db=new BudgetD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);seedLegacyHouses(db,2000);
  const response=await handleRxdbCheckpoint(requestDatabase(db),'campaign_n',access);
  assert.equal(response.status,200);assert.equal(db.report().snapshotRows,0);
  t.diagnostic(JSON.stringify({operation:'idle-checkpoint',statements:db.report().statements,returnedRows:db.report().returnedRows}));
});

test('audit: actual RxDB keeps a full physical page when deduplication would shorten it',async(t)=>{
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
    assert.equal(document?.get('name'),'Version 101');
    assert.deepEqual(calls,[{from:0,to:100,documents:100},{from:100,to:101,documents:1}]);
    const next=await handleRxdbPull(requestDatabase(db),'campaign_n','teams',access,{checkpoint:{seq:101},batchSize:100});
    const nextBody=await next.json() as any;
    assert.deepEqual(nextBody.documents,[]);
    assert.equal(nextBody.checkpoint.seq,101);
    t.diagnostic(JSON.stringify({operation:'actual-rxdb-short-page',calls,unreadFeedRows:0}));
  }finally{await replication.cancel();await local.remove();}
});

test('audit: read estimator attributes an aliased full scan to its physical table',async(t)=>{
  const db=new BudgetD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);seedLegacyHouses(db,2000);
  const sql="SELECT COUNT(*) n FROM house_tasks h WHERE h.label='absent'";
  const plan=db.sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all();
  assert.ok(plan.some(row=>String(row.detail)==='SCAN h'));
  await db.prepare(sql).first();
  assert.ok(db.report().estimatedRowsRead>=2001,JSON.stringify(db.report()));
  assert.ok(db.report().potentialScans.some(scan=>scan.table==='house_tasks'),JSON.stringify(db.report()));
  t.diagnostic(JSON.stringify({operation:'aliased-full-scan',physicalTableRows:2000,estimatedRowsRead:db.report().estimatedRowsRead,plan}));
});

test('audit: pending preparation status reads no House snapshot',async(t)=>{
  const db=new BudgetD1(true,true);t.after(()=>db.sqlite.close());seedNetwork(db);seedLegacyHouses(db,2000);
  await beginAreaTaskPreparation(requestDatabase(db),'campaign_n','area_n');db.resetBudget();let schedules=0;
  const response=await handleAreaTaskPreparationApi(new Request('https://audit.test/preparation'),requestDatabase(db),{campaignId:'campaign_n',areaId:'area_n'},access,undefined,{schedule:async()=>{schedules++;}});
  assert.equal(response.status,200);assert.equal((await response.json() as any).status,'pending');assert.equal(schedules,1);
  assert.equal(db.report().snapshotRows,1,'only the canonical Area is read');
  t.diagnostic(JSON.stringify({operation:'pending-status-before-first-alarm',statements:db.report().statements,returnedRows:db.report().returnedRows,schedules}));
});

test('audit: collection snapshot member query has no campaign-leading index',async(t)=>{
  const db=new BudgetD1(true,true);t.after(()=>db.sqlite.close());
  const sql='SELECT id, run_id, campaign_id, collector_id, label, joined_at, left_at FROM collection_run_members WHERE campaign_id = ? ORDER BY joined_at, id';
  const plan=db.sqlite.prepare('EXPLAIN QUERY PLAN '+sql).all('campaign_n');
  assert.ok(plan.some(row=>String(row.detail)==='SCAN collection_run_members'));
  t.diagnostic(JSON.stringify({operation:'collection-member-snapshot',plan,note:'schema plan, no live cardinality or billing claim'}));
});
