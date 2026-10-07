"""Local SQLite comparisons; VM steps and timings are not D1 billed row metrics."""
import json
import sqlite3
import statistics
import sys
import time
from datetime import datetime, timezone

db = sqlite3.connect(':memory:')
db.executescript('''CREATE TABLE street_network_staging (
  campaign_id TEXT NOT NULL, area_id TEXT NOT NULL, generation TEXT NOT NULL,
  kind TEXT NOT NULL, chunk_key TEXT NOT NULL, payload_json TEXT NOT NULL,
  PRIMARY KEY(campaign_id,area_id,generation,kind,chunk_key));''')
db.executemany('INSERT INTO street_network_staging VALUES(?,?,?,?,?,?)', (
    ('c', 'a', 'g', 'v4-node-usage', f'{bucket:02}:{owner:06}:000000', '[["node",2]]')
    for bucket in range(32) for owner in range(130)))
db.commit()
scope = ['c', 'a', 'g']
base = "SELECT chunk_key,payload_json FROM street_network_staging WHERE campaign_id=? AND area_id=? AND generation=? AND kind='v4-node-usage'"
queries = {
    'beta_like': (base + ' AND (' + ' OR '.join(['chunk_key LIKE ?'] * 8) + ') ORDER BY chunk_key', scope + [f'{b:02}:%' for b in range(8)]),
    'pr130_or_ranges': (base + ' AND (' + ' OR '.join(['(chunk_key>=? AND chunk_key<?)'] * 8) + ') ORDER BY chunk_key', scope + [p for b in range(8) for p in [f'{b:02}:', f'{b:02}:\uffff']]),
    'candidate_union_ranges': (' UNION ALL '.join([base + ' AND chunk_key>=? AND chunk_key<?'] * 8) + ' ORDER BY chunk_key', [p for b in range(8) for p in scope + [f'{b:02}:', f'{b:02}:\uffff']]),
}
results = {}
expected = None
for name, (query, values) in queries.items():
    rows = list(db.execute(query, values))
    if expected is None:
        expected = rows
    assert rows == expected
    vm = [0]
    def progress():
        vm[0] += 1
        return 0
    db.set_progress_handler(progress, 1)
    list(db.execute(query, values))
    db.set_progress_handler(None, 0)
    durations = []
    for sample in range(35):
        started = time.perf_counter()
        list(db.execute(query, values))
        elapsed = (time.perf_counter() - started) * 1000
        if sample >= 5:
            durations.append(elapsed)
    results[name] = {'rowsReturned': len(rows), 'vmSteps': vm[0], 'medianMs': statistics.median(durations),
                     'rawMs': durations, 'bindings': len(values),
                     'plan': [r[3] for r in db.execute('EXPLAIN QUERY PLAN ' + query, values)]}
report = {'at': datetime.now(timezone.utc).isoformat(), 'sqlite': sqlite3.sqlite_version,
          'dataset': {'buckets': 32, 'shards': 130, 'stagingRows': 4160, 'requestedBuckets': 8},
          'method': 'local in-memory warm SQLite; 5 warmups, 30 timings; VM counter separate; no D1 billing claim', 'results': results}
text = json.dumps(report, indent=2) + '\n'
if len(sys.argv) > 1:
    with open(sys.argv[1], 'w') as output:
        output.write(text)
print(json.dumps(report))
