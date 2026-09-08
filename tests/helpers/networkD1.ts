import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { D1DatabaseLike, D1PreparedStatement } from '../../worker/campaignRepository.ts';
class Statement implements D1PreparedStatement {
  values:unknown[]=[];
  constructor(readonly query:string,readonly db:DatabaseSync){}
  bind(...values:unknown[]){this.values=values;return this;}
  async first<T>(){return this.db.prepare(this.query).get(...this.values) as T??null;}
  async all<T>(){return {results:this.db.prepare(this.query).all(...this.values) as T[]};}
}
export class NetworkD1 implements D1DatabaseLike {
  sqlite=new DatabaseSync(':memory:'); failFeed=false; batchSizes:number[]=[];
  constructor(){this.sqlite.exec('PRAGMA foreign_keys=ON');for(const file of ['0001_initial.sql','0002_m4_access.sql','0003_m5_mutations.sql','0004_m6_task_source_provenance.sql','0005_m6_house_tasks.sql','0014_auto_area_task_preparation.sql','0017_rxdb_sync_changes.sql','0022_street_house_network.sql'])this.sqlite.exec(readFileSync(new URL('../../migrations/'+file,import.meta.url),'utf8'));}
  prepare(query:string){return new Statement(query,this.sqlite);}
  async batch(statements:D1PreparedStatement[]){this.batchSizes.push(statements.length);this.sqlite.exec('BEGIN');try{const results=statements.map(statement=>{const s=statement as Statement;if(this.failFeed&&s.query.includes('INSERT INTO campaign_sync_changes'))throw new Error('injected_feed_failure');const r=this.sqlite.prepare(s.query).run(...s.values);return {success:true,meta:{changes:Number(r.changes)}};});this.sqlite.exec('COMMIT');return results;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}}
}
export function seedNetwork(db:NetworkD1){
  const time='2026-09-07T00:00:00.000Z';
  const area={type:'Polygon',coordinates:[[[13,51],[13.01,51],[13.01,51.01],[13,51.01],[13,51]]]};
  db.sqlite.prepare("INSERT INTO campaigns(id,name,status,revision,write_token,created_at,updated_at) VALUES('campaign_n','Network','active',1,'seed',?,?)").run(time,time);
  db.sqlite.prepare("INSERT INTO teams(id,campaign_id,name,color,created_at,updated_at) VALUES('team_n','campaign_n','Team','#2563eb',?,?)").run(time,time);
  db.sqlite.prepare("INSERT INTO areas(id,campaign_id,team_id,name,geometry_json,created_at,updated_at) VALUES('area_n','campaign_n','team_n','Area',?,?,?)").run(JSON.stringify(area),time,time);
}
export const networkOsm=()=>new Response(JSON.stringify({osm3s:{timestamp_osm_base:'2026-09-07T00:00:00Z'},elements:[
  {type:'way',id:1,tags:{highway:'residential',name:'Straße'},geometry:[{lon:13.001,lat:51.005},{lon:13.009,lat:51.005}]},
  ...[13.002,13.004,13.008].map((x,i)=>({type:'way',id:100+i,tags:{building:'house','addr:street':'Straße','addr:housenumber':String(i)},geometry:[{lon:x,lat:51.0051},{lon:x+0.00003,lat:51.0051},{lon:x+0.00003,lat:51.00513},{lon:x,lat:51.0051}]}))
]}));
