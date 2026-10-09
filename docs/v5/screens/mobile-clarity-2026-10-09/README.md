# Mobile clarity, B, 2026-10-09

Branch: `ai-B/mobile-clarity-2026-10-09`. Basis: integration `5e352a28f8b58591bfa77fb0ecd841841d3fc241` plus independently reviewed A-5 `62d3234bb3d6071736c0664aa55b316d0a0b892b`, merged as `f2cf94ae1fc99e6ed4c3830d23fb982f93c75668`. Product changes are confined to App and AccessSheet. A counterreview is pending; this is not a release approval.

## Behavior

- The obsolete-progress action now says **Veraltete Einträge bereinigen**, visibly distinct from **Gebiet löschen**. Both existing operations and confirmations are retained. Clean-up preserves the Gebiet and current derived progress.
- After the last obsolete key is cleared, the clean-up control refreshes immediately. `FieldStore.forget` does not notify the derived-house progress tracker; App explicitly invalidates the memoized count after a successful response. A new flow9 assertion failed before this fix and passes afterward.
- Helper-right switches reuse the existing `v5-seg`/`v5-seg-btn` components, with visible Sehen/Anlegen/Bearbeiten/Zuweisen captions, accessible names and pressed states. No new CSS, dependency, server policy or assignment interface.

## Validation

- `npm test`: **432/432**, no skips or failures. `npx tsc --noEmit -p .`: exit 0. `npm run build`: exit 0.
- Flow 9: existing shell interactions and the new immediate clean-up refresh regression pass. [Log](flow9-and14.txt).
- Flow 14: collection setup and helper-right mutation pass against real Worker handlers. [Log](flow9-and14.txt).
- Flow 15: **144/144 checks** over eight configurations. [Log](flow15.txt). Real handler seeds a current house and an obsolete key; cleaning clears only the latter and preserves the Gebiet. Each configuration checks captions, theme/hand, horizontal overflow, 44px action targets, 16px area input text, unclipped rights captions, confirmation, immediate refresh, Tab/Shift+Tab, Space activation, tap restoration, server result and unchanged rights of the other helper.
- [Negative baseline](baseline-flow9.txt): the additional assertion fails on the unchanged combined baseline before the App fix. Exit 1 is intentional evidence, not a positive gate.
- The final matrix waits for the sheet animation before taking screenshots. Rights views are deliberately scrolled to Nutzer 2; the heading is above the visible portion of the scrollable sheet. All screenshots are 932px high. Synthetic city, plain basemap, fixture identities only.

```sh
npm run build
PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs \
CHROMIUM_PATH=/path/to/chrome-headless-shell \
SHOTS_DIR=/tmp/mobile-clarity \
node scripts/v5-e2e/run-all.mjs flow9 flow14 flow15
```

The runner now includes flow15 by default. This branch's complete 16-flow run has not been repeated. The first matrix process stopped with a native environment error; an unchanged-product retry and the final screenshot run both completed successfully. No real-device, live D1, Overpass, basemap or organizer live-API evidence. The full-sheet/A11y audit and dense-city soak remain open.

## Screenshot matrix

| Width | Theme | Hand | Gebiet before clean-up | Helper rights |
|---|---|---|---|---|
| 390 | Dark | Left | [Area](area-390-dark-left.png) | [Rights](rights-390-dark-left.png) |
| 390 | Dark | Right | [Area](area-390-dark-right.png) | [Rights](rights-390-dark-right.png) |
| 390 | Light | Left | [Area](area-390-light-left.png) | [Rights](rights-390-light-left.png) |
| 390 | Light | Right | [Area](area-390-light-right.png) | [Rights](rights-390-light-right.png) |
| 430 | Dark | Left | [Area](area-430-dark-left.png) | [Rights](rights-430-dark-left.png) |
| 430 | Dark | Right | [Area](area-430-dark-right.png) | [Rights](rights-430-dark-right.png) |
| 430 | Light | Left | [Area](area-430-light-left.png) | [Rights](rights-430-light-left.png) |
| 430 | Light | Right | [Area](area-430-light-right.png) | [Rights](rights-430-light-right.png) |

Reviewer A must inspect the diff, run the affected flows and view the 430px screenshots before UI OK. The larger B-2/B-3 audit remains in Plan 051 and the shared Board.
