import assert from 'node:assert/strict';
import test from 'node:test';
import { createRxDatabase } from 'rxdb';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';

// The sync core caches the validated plain copy per RxDocument instance. That is only sound while RxDB hands out a
// NEW instance for a changed revision and the SAME instance for an unchanged one; this pins that assumption.
test('RxDB documents are immutable per revision: changed → new instance, unchanged → same instance', async () => {
  const db = await createRxDatabase({ name: `immutability${Math.random().toString(36).slice(2)}`, storage: getRxStorageMemory() });
  await db.addCollections({
    houses: { schema: { version: 0, primaryKey: 'id', type: 'object', properties: { id: { type: 'string', maxLength: 50 }, status: { type: 'string' } }, required: ['id', 'status'] } },
  });
  await db.houses.bulkInsert([{ id: 'a', status: 'open' }, { id: 'b', status: 'open' }]);
  const before = await db.houses.find().exec();
  const a1 = before.find((d) => d.id === 'a')!, b1 = before.find((d) => d.id === 'b')!;
  await db.houses.findOne('a').patch({ status: 'completed' });
  const after = await db.houses.find().exec();
  const a2 = after.find((d) => d.id === 'a')!, b2 = after.find((d) => d.id === 'b')!;
  assert.notEqual(a2, a1);
  assert.equal(a1.toJSON().status, 'open', 'the old instance keeps its old data');
  assert.equal(a2.toJSON().status, 'completed');
  assert.equal(b2, b1, 'untouched documents keep their instance, so the cache stays warm');
  await db.close();
});
