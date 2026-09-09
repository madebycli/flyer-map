import type { D1DatabaseLike, D1PreparedStatement } from './campaignRepository.ts';

const wrapped=new WeakSet<object>();
/** Cache schema inspection only, for one request/alarm. Never cache entity reads. */
export function requestDatabase(db:D1DatabaseLike,queryBudget=Number.POSITIVE_INFINITY):D1DatabaseLike{
  if(wrapped.has(db))return db;
  const reads=new Map<string,Promise<unknown>>();
  const originals=new WeakMap<D1PreparedStatement,D1PreparedStatement>();
  let queries=0;
  const consume=(count:number)=>{if(queries+count>queryBudget)throw new Error('d1_invocation_budget_exceeded');queries+=count;};
  const result:D1DatabaseLike={
    batch:statements=>{consume(statements.length);return db.batch(statements.map(statement=>originals.get(statement)??statement));},
    prepare(query){
      if(!/^PRAGMA table_info\(/i.test(query)&&!/^SELECT name FROM sqlite_master WHERE type\s*=\s*'table'/i.test(query)){
        let original=db.prepare(query);
        const statement:D1PreparedStatement={bind(...values){original=original.bind(...values);originals.set(statement,original);return statement;},first:<T>()=>{consume(1);return original.first<T>();},all:<T>()=>{consume(1);return original.all<T>();}};
        originals.set(statement,original);return statement;
      }
      let values:unknown[]=[];
      const get=(kind:'first'|'all')=>{
        const key=JSON.stringify([query,values,kind]);
        let pending=reads.get(key);
        if(!pending){consume(1);pending=db.prepare(query).bind(...values)[kind]();reads.set(key,pending);pending.catch(()=>reads.delete(key));}
        return pending;
      };
      const statement:D1PreparedStatement={bind(...next){values=next;return statement;},first:<T>()=>get('first') as Promise<T|null>,all:<T>()=>get('all') as Promise<{results:T[]}>};
      return statement;
    },
  };
  wrapped.add(result);return result;
}
