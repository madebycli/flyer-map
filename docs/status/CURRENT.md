---
id: status-current
type: status
status: active
last_updated: 2026-09-25
---

# Current Project State

The authoritative cross-repository route is `.ai/CONTEXT.md` → `madebycli/master-context/projects/flyer-map/INDEX.md` → `handoffs/CURRENT.md`. The release-channel invariant there maps `beta` to the Beta Worker and Beta D1; `main` is Stable.

- On 2026-09-25 the user reports that Beta D1 Free daily rows read and rows written are exhausted, so a live Gebiet-8 retry and a Beta release with automatic D1 migrations cannot be verified today. A local Beta-only change is being prepared: HTTP and realtime V4 progress both use the 130 source shards rather than mixing them with 102 geometry tiles; stale failed jobs are hidden during the next retry, diagnostic polling is serialized and slowed, and staging prefix reads/deletes use the existing composite primary-key range. A full local 130-shard BBox replay under the 50-query wrapper remains the offline gate. D1 billed row counts and the actual Base-step failure remain unknown; no new live success is claimed.
- PR #129 is deployed to Beta at commit `603775645a07c1587df6b3cae21e35836a6de81c` with Worker `3194334a-0985-4048-8b28-b889040b796d`. The PR #129 diagnostics expose bounded `baseStep` and `baseFailureClass`; the 11:28 UTC device snapshot predates this release. The next real snapshot can identify the Base-step failure once the D1 quota resets.
- The 2026-09-25 11:28 UTC Gebiet-8 diagnosis identifies exact PR-#128 Beta Worker `e1f2fb85-a9a0-4b10-a1e4-3d3de43534b2`, the same 55,270 Streets / 46,665 Houses, and another generic failure at `v4-base` cursor 0. It was copied 514 ms after a same-generation retry began: outer preparation `pending` at 11:28:26 while the V4 job still showed the previous failed phase. The reason `baseStep` was absent is proven: `diagnostics.ts` omitted it from its public allowlist even though the job stored it on failure. The Beta-only diagnostic fix allowlists bounded `baseStep` and `baseFailureClass`; a regression verifies both through the public snapshot. The specific D1 exception and the outcome of the newly begun retry remain unknown. `STREET_ENGINE_LIVE_READY=FALSE`.

- PR #128 is on Beta as commit `c20a6ce748ef73efbfd31fbaf554801a48043b9a`. The earlier real Gebiet-8 retry loaded the 130-shard pack and calculated 55,270 Streets / 46,665 Houses before failing at the first Base bucket. PR #128 aligned the feed and base row limits to 220 KB, but the fresh device run still failed at that bucket. No generation has been published.

- PR #126 repaired the 50-query Free D1 alarm budget; PR #127 repaired same-generation retries that retained an outdated source manifest. Gebiet 7 was previously accepted with 788 Streets and 1,737 Houses. A local rectangular Gebiet-8 BBox replay reached `ready` under the 50-query wrapper, but local SQLite does not establish the exact private Area or Cloudflare D1 limits.
- `STREET_ENGINE_LIVE_READY=FALSE` until Gebiet 8 reaches `ready` on exact-commit Beta, Streets/Houses render, reload is stable, a second client converges and Gebiet 7 remains correct.

Continue with [Plan 042](../plans/active/042-v4-large-area-staged-preparation.md). No Production/Main deploy, Production D1 mutation, secret rotation, V3/V2 runtime fallback or live Overpass fallback.
