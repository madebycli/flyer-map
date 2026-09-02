# P0 Closure Plan: independent Street and House preparation

## Context

- Repository: `madebycli/flyer-map`
- Branch: `feature/established-street-preparation-engine`
- PR: `#75`
- Verified starting head: `998d1bcc724c901f29291614058623df22bbd060`
- Scope: close the live reproduction where automatic Street geometry and House lists stay empty, and make `area_preparation_work_started` a true action-required state.
- Guardrails: keep PR #75 open and Draft; do not touch PR #74; do not modify `mission-rxdb-sync`; do not apply remote D1 migrations; do not production deploy; keep the accepted JSTS/Turf geometry core unchanged.

## Evidence and root cause

The Area Sheet reads `snapshot.tasks` and `snapshot.houseTasks`. The current Worker runs roads and buildings through one `runAreaTaskPreparation` path and only publishes the combined result when both phases succeed. The persisted `area_task_preparations` row has one status, so a Building timeout or size error can prevent successful Streets from becoming canonical. The UI and poller also treat `area_preparation_work_started` like an ordinary retryable failure.

## Architecture options

### Option A: encode two states in the existing combined row

Use the existing row's status plus error code and infer House status from selected error codes.

- Smallest apparent diff.
- No new schema object.
- Does not represent both state machines cleanly.
- Makes House-only retry and second-client behavior ambiguous.
- Risks losing a truthful distinction between House failed, House pending, and Street failed.

Decision: reject for P0 because it cannot reliably satisfy independent retry and snapshot semantics.

### Option B: persist independent Street and House state

Extend the prepared Area state with explicit Street and House statuses, error codes, timestamps and source counters. Keep one Area generation and one guarded preparation claim, but run and publish the Street and House branches independently. A Street success commits Street tasks and Street ready state even when House fails. A House retry consults the same generation and only runs the House branch when Streets are already ready. A Street retry never deletes or regenerates ready House state.

- Represents the required `AREA +-- Street Preparation +-- House Preparation` model.
- Preserves atomicity per branch and prevents stale generations from publishing.
- Supports honest snapshot reloads and isolated retries.
- Requires a prepared local D1 schema extension. No remote migration is applied in this pass.

Recommendation: Option B.

## First three files to inspect and change

1. `migrations/0015_area_task_preparation_split.sql`
   - Add the prepared schema fields required for independent Street and House state.
2. `worker/areaTaskPreparation.ts`
   - Split the lifecycle, guarded branch publishes, result classification and retry decisions.
3. `src/App.tsx`
   - Render the dedicated action-required state and hide Retry for worked Areas.

Supporting files expected after those first three:

- `worker/areaTaskPreparationApi.ts`
- `src/data/campaignApi.ts`
- `src/areaPreparation/preparationPolling.ts`
- `worker/campaignRepository.ts`
- `src/i18n.ts`
- focused runtime, polling and UI tests
- `docs/SYNC_REQUIREMENTS_FOR_STREET_ENGINE.md`
- `docs/plans/active/029-established-street-preparation-engine.md` or its completed counterpart, depending on the final gate result
- `PR #75` metadata

## Implementation sequence

1. Add the prepared local schema extension without applying it remotely.
2. Add a public state contract exposing separate Street and House states while preserving backward-compatible fields during the transition.
3. Keep the durable claim and generation guard, but make branch execution independent:
   - Roads and Street Engine produce and publish canonical Street tasks when valid.
   - Buildings produce and publish canonical House tasks independently.
   - A House upstream failure leaves already-published Streets ready and records House failed.
   - A Street failure leaves no false Street ready, while House may still publish successfully.
   - Both successful branches report both ready.
4. Make POST retry branch-aware:
   - House retry does not fetch or regenerate Streets when Street is already ready.
   - Street retry does not recreate unrelated House state.
   - A ready generation is not rerun merely because a second client opens the Area.
5. Make the UI and poller action-required aware:
   - dedicated localized explanation for `area_preparation_work_started`;
   - no Retry button;
   - no automatic start or retry;
   - no destructive reset control.
6. Add the end-to-end mocked Overpass -> D1 publish -> snapshot reload coverage and the requested isolation matrix.
7. Update the sync handoff, architecture requirement/planner prompt, Plan 029 status and PR body with exact final evidence.

## Verification gates

- `npm test`
- `npm run typecheck`
- `npm run audit:dependencies`
- `npm run build`
- GitHub CI success on the exact final SHA
- Cloudflare Workers check success on the exact final SHA, recording Build ID, Version ID, commit Preview URL and branch alias
- No PR #74 writes, no sync files changed, no remote D1 changes, no production deployment
- Real-device acceptance remains external unless actually performed

## Implementation status

- Die empfohlene Option B ist umgesetzt: eine gemeinsame Area-Generation mit unabhängigen Street-/House-States und je Phase guarded Publish.
- Street ready plus House failed ist ein gültiger, sichtbarer Zustand. House-Retry und Street-Retry sind getrennt und bewahren den jeweils bereits fertigen Zweig.
- `area_preparation_work_started` ist als action-required-Zustand umgesetzt: lokalisierte Erklärung, kein Retry, kein Auto-Start und kein destruktiver Reset.
- Runtime-, Polling- und UI-Verträge enthalten die unabhängige Status- und Isolation-Matrix.
- Der Zwischenstand vor Dokumentationsabschluss war `3cc67046611587ca277ac23eb0a3440d5f2acc0f`; der exakte finale Head wird nach den letzten Änderungen im PR-Body und im Abschlussbericht festgehalten.

## Open points

- UNKLAR: the connected Cloudflare preview's remote D1 schema state cannot be changed in this pass because remote migrations are explicitly forbidden. Local D1 tests can prove the lifecycle only after the prepared schema extension is present; the PR must state the deployment migration prerequisite clearly.
