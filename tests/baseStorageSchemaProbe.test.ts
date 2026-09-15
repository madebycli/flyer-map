import test from 'node:test';
import assert from 'node:assert/strict';
import { hasBaseStorage } from '../worker/streetNetwork/baseStorage.ts';
import type { D1DatabaseLike, D1PreparedStatement } from '../worker/campaignRepository.ts';

function schemaDb(initiallyPresent:boolean){
  let present=initiallyPresent;
  const queries:string[]=[];
  const db:D1DatabaseLike={
    prepare(query:string){
      queries.push(query);
      const statement:D1PreparedStatement={
        bind(){return statement;},
        async first<T>(){
          return (query.includes('sqlite_master')&&present?{name:'street_base_chunks'}:null) as T|null;
        },
        async all<T>(){
          const rows=query==='PRAGMA table_info(street_base_chunks)'&&present
            ? [{name:'campaign_id'},{name:'payload_json'}]
            : [];
          return {results:rows as T[]};
        },
      };
      return statement;
    },
    async batch(){return [];},
  };
  return {db,queries,setPresent(value:boolean){present=value;}};
}

test('base storage schema probe avoids sqlite_master scans and caches a positive result',async()=>{
  const fixture=schemaDb(true);
  assert.equal(await hasBaseStorage(fixture.db),true);
  assert.equal(await hasBaseStorage(fixture.db),true);
  assert.deepEqual(fixture.queries,['PRAGMA table_info(street_base_chunks)']);
});

test('base storage schema probe does not permanently cache a missing pre-migration schema',async()=>{
  const fixture=schemaDb(false);
  assert.equal(await hasBaseStorage(fixture.db),false);
  fixture.setPresent(true);
  assert.equal(await hasBaseStorage(fixture.db),true);
  assert.equal(await hasBaseStorage(fixture.db),true);
  assert.deepEqual(fixture.queries,[
    'PRAGMA table_info(street_base_chunks)',
    'PRAGMA table_info(street_base_chunks)',
  ]);
});
