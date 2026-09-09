import { NetworkD1 } from './networkD1.ts';
import type { D1PreparedStatement } from '../../worker/campaignRepository.ts';

export type D1BudgetReport = {
  statements:number; batches:number; maxStatementsPerBatch:number;
  returnedRows:number; estimatedRowsRead:number; snapshotRows:number;
  tableRowsWritten:number; estimatedIndexRowsWritten:number; estimatedTotalRowsWritten:number;
  tables:Record<string,{insert:number;update:number;delete:number;indexWrites:number}>;
  potentialScans:{table:string;rows:number;sql:string}[];
  method:string;
};
const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"';
class BudgetStatement implements D1PreparedStatement {
  values:unknown[]=[];
  constructor(readonly query:string,readonly owner:BudgetD1){}
  get db(){return this.owner.sqlite;}
  bind(...values:unknown[]){this.values=values;return this;}
  async first<T>(){this.owner.observe(this.query,this.values);const result=this.owner.sqlite.prepare(this.query).get(...this.values);this.owner.returned(this.query,result?1:0);return (result??null) as T;}
  async all<T>(){this.owner.observe(this.query,this.values);const results=this.owner.sqlite.prepare(this.query).all(...this.values);this.owner.returned(this.query,results.length);return {results:results as T[]};}
}
/** Local estimates only. TEMP triggers count committed logical writes, including FK cascades. */
export class BudgetD1 extends NetworkD1 {
  statements=0;batches=0;maxStatementsPerBatch=0;returnedRows=0;scanRows=0;snapshotRows=0;
  scans:D1BudgetReport['potentialScans']=[];
  tableNames=new Set<string>();
  constructor(baseChunks=false,fullSchema=false){
    super(baseChunks,fullSchema);
    this.sqlite.exec('CREATE TEMP TABLE budget_writes(table_name TEXT, operation TEXT, index_writes INTEGER)');
    const tables=this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[];
    for(const {name} of tables){
      this.tableNames.add(name);
      const indexes=this.sqlite.prepare(`PRAGMA index_list(${quote(name)})`).all() as {name:string}[];
      const columns=indexes.map(index=>this.sqlite.prepare(`PRAGMA index_info(${quote(index.name)})`).all() as {name:string|null}[]);
      for(const operation of ['insert','update','delete'] as const){
        const writes=operation==='update'?columns.map(cols=>cols.some(col=>col.name===null)?'1':`CASE WHEN ${cols.map(col=>`old.${quote(col.name!)} IS new.${quote(col.name!)}`).join(' AND ')} THEN 0 ELSE 1 END`).join('+')||'0':String(indexes.length);
        this.sqlite.exec(`CREATE TEMP TRIGGER ${quote('budget_'+name+'_'+operation)} AFTER ${operation.toUpperCase()} ON main.${quote(name)} BEGIN INSERT INTO budget_writes VALUES('${name}','${operation}',${writes}); END`);
      }
    }
  }
  prepare(query:string){return new BudgetStatement(query,this);}
  observe(query:string,values:unknown[]){
    this.statements++;
    try{
      const plan=this.sqlite.prepare('EXPLAIN QUERY PLAN '+query).all(...values) as {detail:string}[];
      for(const {detail} of plan){
        const match=/SCAN (?:TABLE )?([\w]+)/u.exec(detail);
        if(!match||!this.tableNames.has(match[1]))continue;
        const rows=Number(this.sqlite.prepare(`SELECT COUNT(*) n FROM ${quote(match[1])}`).get()!.n);
        this.scanRows+=rows;
        if(rows>0 && this.scans.length<100)this.scans.push({table:match[1],rows,sql:query.slice(0,180)});
      }
    }catch{/* PRAGMA and other non-plannable statements still count as queries. */}
  }
  returned(query:string,count:number){
    this.returnedRows+=count;
    if(/FROM (?:tasks|house_tasks|areas|teams)\b/u.test(query))this.snapshotRows+=count;
  }
  async batch(statements:D1PreparedStatement[]){
    this.batches++;this.maxStatementsPerBatch=Math.max(this.maxStatementsPerBatch,statements.length);
    this.batchSizes.push(statements.length);this.sqlite.exec('BEGIN');
    try{
      const results=statements.map(statement=>{
        const {query,values}=statement as BudgetStatement;this.observe(query,values);
        if(this.failFeed&&query.includes('INSERT INTO campaign_sync_changes'))throw new Error('injected_feed_failure');
        const result=this.sqlite.prepare(query).run(...values);return {success:true,meta:{changes:Number(result.changes)}};
      });
      this.sqlite.exec('COMMIT');return results;
    }catch(error){this.sqlite.exec('ROLLBACK');throw error;}
  }
  resetBudget(){this.statements=0;this.batches=0;this.maxStatementsPerBatch=0;this.returnedRows=0;this.scanRows=0;this.snapshotRows=0;this.scans=[];this.sqlite.exec('DELETE FROM budget_writes');}
  report():D1BudgetReport {
    const rows=this.sqlite.prepare('SELECT table_name,operation,COUNT(*) n,SUM(index_writes) index_writes FROM budget_writes GROUP BY table_name,operation').all() as {table_name:string;operation:'insert'|'update'|'delete';n:number;index_writes:number}[];
    const tables:D1BudgetReport['tables']={};let tableRowsWritten=0,estimatedIndexRowsWritten=0;
    for(const row of rows){const table=tables[row.table_name]??={insert:0,update:0,delete:0,indexWrites:0};table[row.operation]+=Number(row.n);table.indexWrites+=Number(row.index_writes);tableRowsWritten+=Number(row.n);estimatedIndexRowsWritten+=Number(row.index_writes);}
    return {statements:this.statements,batches:this.batches,maxStatementsPerBatch:this.maxStatementsPerBatch,returnedRows:this.returnedRows,estimatedRowsRead:this.returnedRows+this.scanRows,snapshotRows:this.snapshotRows,tableRowsWritten,estimatedIndexRowsWritten,estimatedTotalRowsWritten:tableRowsWritten+estimatedIndexRowsWritten,tables,potentialScans:this.scans,method:'Logical writes exact via TEMP triggers, FK cascades included; one estimated index-row write per affected index. Reads approximate returned rows plus EXPLAIN full-scan cardinalities; nested/index probes are not fully counted. Not Cloudflare billing ground truth.'};
  }
}
