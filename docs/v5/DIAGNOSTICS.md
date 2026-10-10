# Diagnostics and logs (v5)

One question answers most field problems: *what was the device doing, and how long did each part take?* The diagnostics panel, the report and the server's
request lines exist to answer it without a debugger, on a real phone, with nothing leaving the device unless the user copies it.

## Open it

| How | What happens |
|---|---|
| `/v5?campaign=…&diag=1` | verbose logging from the first line, frame-rate / memory sensors on, panel opens once the map is up, small readout (`60 fps · 15 MB · sync ✓ · 0✕ 2!`) stays on the map |
| Menu → **Diagnose** | the panel without any flag; sensors that cost something run only while it is open |
| Panel → *Diagnose-Modus dauerhaft* | the same as `?diag=1`, remembered on the device (`localStorage` key `vf-v5-diag`) until switched off |
| error screen → **Diagnose** | the panel is reachable even when the map failed to start |

The readout is hidden without the flag. Nothing in the panel needs a network.

## The panel (six areas)

- **Status** – plain-German *findings* first (`src/v5/diag/findings.ts`: what is wrong, why it matters, what it means for the work), then engine / network / sync / frame rate / memory / warnings, the start timings (load Aktion, packs, derive, ready after), the device (browser, viewport, pixel ratio, cores, memory, connection, GPU, storage) and the report buttons.
- **Engine** – Rust/WASM or TypeScript fallback (and why), WASM memory, areas held, queue length, worker crashes; per call (`init`, `area`, `tile`, `mapData`, `stats`, `reset`) count, median, 95 %, worst of the round trip, the compute time in the worker and the waiting time; the network cache (hits, misses, stored, last size, load time); per Gebiet the street-engine details: source (cache/server), pack size and fetch time, unzip, Rust compute, parse, ways in the pack, segments (visible), promoted by houses, hidden connectors, buildings in the pack, houses made, orphan houses, ways excluded and buildings skipped *by reason*.
- **Sync** – state, last success, waiting marks and notes, failures with the next retry, server cursor, clock skew, own marks, overwritten marks, rounds, sent/accepted/rejected, received (in how many pages), notes, local saves and failed saves, timings (round, push, pull, each IndexedDB write, load, hydrate) and the last rounds with duration, counts and result.
- **Netz** – online/offline, connection type, requests, failures, in flight, online/offline changes; per **route template** (`…/areas/:a/pack`, never an id) count, median, 95 %, worst, and per route time to first byte, size and — from the server's `Server-Timing` — server time and database time; loaded files by kind (JS, CSS, WASM, images, API), cache hits, the last network warnings.
- **Karte** – frame rate and the slowest frame of the last 5 s, frames over 32 / 100 ms, long tasks, JS heap, local storage; MapLibre version, rendering mode, layers / sources / providers (they must not grow with repeated use — a leak otherwise), loaded tiles per source, painted marks, graphics stack, context losses, basemap state, map errors; tile creation, paint and style timings and tile sizes.
- **Log** – newest first, level filter, category filter (`boot engine pack net sync store notes map cache ui device error console`), text search, each line expandable to its (redacted) data. Warnings and errors of the **previous page session** are one tap away (*Vorherige Sitzung*), which is what a crash or a forced reload leaves behind.

## The report

*Bericht kopieren* / *Herunterladen* produce one JSON document, schema `v5-diag-1`:

```
schema, generatedAt, run{id,startedAt,uptimeS,bootCount}, flags, device,
metrics{counters,gauges,histograms{n,mean,p50,p95,p99,min,max,last,sum,lastAt}},
subsystems{engine,sync,campaign{…store…},map,app,…},   // each subsystem describes itself on demand
log{counts,verbose,entries[≤300]}, previousSession{id,endedAt,entries}|null
```

Counter names are `<area>.<what>` (`sync.push.sent`, `engine.area.rtt_ms`, `net.GET /api/v5/campaigns/:c/state.status.2xx`, `map.tiles.failed`), timings end in `_ms`, sizes in `.bytes`. A report is sized for reading: every metric name is kept, the log is capped at the newest 300 lines.

## What the code does to stay cheap

- **Bounded memory**: a ring of 1 000 lines plus a separate ring of 300 warnings/errors (a burst of debug lines can never push out the one error that matters); histograms keep exact statistics for the last 256 samples and never-resetting totals.
- **Cheap always, expensive only while looked at**: counters, timings and the resource-timing / long-task observers are always on (microseconds); the frame sampler (rAF) and the heap/storage poll run only while the panel is open or `?diag=1` is set.
- **Probes, not plumbing**: each subsystem registers `diag.probe(name, () => ({…}))` and is asked only when a report or the panel needs it.
- **Never breaks the app**: every write to `localStorage` is guarded; a failing diagnostic call is swallowed.

## Privacy (a binding rule, tested)

Positions stay on the device (AGENTS.md). Redaction is structural, textual and — for text from outside our own code — an **allowlist** (`src/v5/diag/redact.ts`), applied when a line is recorded, again when a report is built, and again when a saved tail is read back. A saved tail carries a format number: one of an older format is deleted unread; in a current one, the `error`/`console` categories keep only our fixed messages:

- keys that can carry personal or credential data are replaced by `[removed]` (`lat lng coordinates center position geometry ring bbox token secret password cookie authorization session hash access label name address title text body email note notes` …);
- **free text from outside** (exception messages, rejection reasons, a library's console line, a server's error text; keys `message error reason lastError initError cause detail description`) is never kept; a thrown object or array under such a key is not walked at all (recorded as `[object removed, N keys]`): only a message that starts like a known technical one (`Failed to fetch`, `The operation was aborted`, `QuotaExceededError`, `HTTP 503`, …) survives, as that start; anything else is recorded as `[text removed, N chars]`. Extend the list when a harmless message is missed in the field, never loosen it to "keep most text";
- every string and object key, wherever it appears (cut to its length limit *before* matching, so the cost never depends on the input): web addresses with or without a scheme become `[url]`, query strings `[query]`, coordinates (`51.12345`, `51,12345`, pairs like `51.123, 13.543`) and long digit runs `[num]`, e-mail addresses `[email]`, 32+ character token-like strings `[token]`, `#access=` / `#collection=` fragments are cut;
- addresses of failed resources become a **kind** (`tile`, `style`, `glyphs`, `sprite`, `api`), never a path, tile number or query; error locations are `file.js:line:col` (file name only); stacks are kept as up to four frames `function file.js:line:col` (V8, Firefox and Safari formats; anything else is dropped); an error is recorded as `{ type, message, stack }`, its type only if it looks like `…Error`/`…Exception`. Redaction is idempotent: the second pass for a report or a saved tail leaves an already-redacted entry as it is;
- routes are logged as **templates** (ids replaced), query strings never;
- the session id in the report is a random per-page id, not the cookie; campaign and area ids are not recorded.

`tests/v5Diag.test.ts` and `scripts/v5-e2e/flow16.mjs` assert that a real report contains no campaign id, no session cookie, no token-like string and no coordinates, and that the review's counterexamples (a map error with an address and a key in it, an uncaught error, a console line and a rejection with a name, a note and a position) leave nothing in the panel, the copied report or the saved tail.

## Server side

`worker/v5/observe.ts`, applied by `handleV5Api` to every `/api/v5/` request:

- **`x-request-id`**: the client sends one (`c-xxxxxxxx`); the server echoes it if it is well-formed (`[A-Za-z0-9_-]{6,40}`), otherwise makes one (`s-…`). The same id is in the client's warning for a failed request and in the server's log line.
- **`Server-Timing`**: `total;dur=…, db;dur=…;desc="N queries[, M batch]"`. Same-origin, so the browser exposes it without extra work; the Netz tab shows it per route. Database time is measured by a counting wrapper around the D1 binding (`instrumentDb`): `bind`, `first` (with its column argument), `all`, `run`, `raw` and `batch` pass their arguments through unchanged; only counting and timing is added.
- **One JSON line per request** at or above `V5_LOG_LEVEL` (`debug|info|warn|error`, default **`warn`**): healthy requests are silent; 4xx are `warn`; 5xx and thrown exceptions are `error` (the error *name* only); a request over 1.5 s or with over 0.8 s of database time is `warn`. Fields: `rid route method status ms db{queries,batches,ms,slowestMs} code`. No ids, no query string, no cookie, no body, no names, no error message text.

Enabling it on a deployment is a configuration decision, not a code change: set the variable `V5_LOG_LEVEL=info` (staging) and, if lines should be kept beyond `wrangler tail`, turn on Workers Logs/observability for that Worker in the Cloudflare dashboard or its config. Neither is set in the repository's `wrangler.jsonc`, so production behaviour is unchanged by this feature.

## Not included on purpose

- No telemetry upload and no server-side store for client logs: a log leaves the device only when the user copies or downloads the report. (A client → server sink would need a migration and an explicit decision.)
- No GPS, no per-street or per-house data in any log.
- No third-party SDK.

## Reading a problem report

1. *Status → findings*: the plain-German list says what is wrong.
2. *Engine → Gebiete*: slow start? Look at pack size, unzip, Rust compute, parse; a TypeScript fallback shows its reason on *Status*.
3. *Karte*: low frame rate with growing *Ebenen / Quellen / Anbieter* is a leak; many context losses is graphics memory.
4. *Sync*: failures with the error text and retry time; *Netz* shows whether the server or the network is slow (server time vs. time to first byte).
5. *Log → Vorherige Sitzung*: what the last run ended with.
6. Match a failing request by its id with the server's line (`wrangler tail`).
