# flyermap-web

The Verteil-Flyer app in Rust (Leptos 0.8, client-side rendering, WebAssembly): the field map, marking, search, the Studio, drawing Gebiete, the way in. Plan 059/061,
reimagined, not ported: phone first, the map is the screen, everything else appears at the thing it concerns. The React app (`src/v5`, `src/ui`) stays the reference
for the look (Material 3 tokens, class names `v5-*`), the key names of the device settings and the sync format.

## Build, look, test

```sh
scripts/rs-web-build.sh --release          # cargo (wasm32, profile `web`, erase_components) -> wasm-bindgen -> dist-rs/ (git-ignored): app, MapLibre, engine, sw.js, manifest
node scripts/rs-web-serve.mjs              # http://localhost:8150, mock backend (?mock=admin|lead|member|viewer|stranger)
cargo test -p flyermap-web                 # native tests of every pure rule (from flyermap-rs/)
scripts/rs-check.sh                        # file length, fmt, clippy -D warnings, tests of the whole workspace
cargo clippy -p flyermap-web --target wasm32-unknown-unknown -- -D warnings
```

Browser flows (Chromium under `/opt/pw-browsers`, software GL; never a real device): `shell.mjs` runs against the mock. The others run against the real Rust Worker in
workerd with made-up data and no network: `HOLD=1 scripts/rs-e2e/app-local.sh` starts it (Overpass stub, Worker with the contract vectors' seed, the app on :8160), then
`node scripts/rs-e2e/<flow>.mjs` with `BASE=http://127.0.0.1:8160/ WORKER=http://127.0.0.1:8790`; without `HOLD` the script runs all flows and stops the stack.

| Flow | What it proves |
| --- | --- |
| `shell` | zones, the three anchors, live strip, sheets at the thing, Studio column, rights per persona (mock) |
| `local-map` | tiles from the engine (debug counters), status colours, dashed paths, roles, theme switch under the map |
| `local-sync` | marks reach the server (read back through `/state`), a second device converges, offline queue, restart keeps the queue, the server refuses foreign Gebiete |
| `local-mark` | the panel's places are identical in all four modes (measured, right and left hand), 44 px, real touch strokes for Wischen and Lasso, undo, server readback |
| `local-search` | combobox, groups, bold matches, typo, arrow keys, recents, sheet at a house or street, status choice, tap on the map, viewer sees no marking |
| `local-studio` | column at 1280 px, sheet on a phone, tabs by mouse and arrow keys, rights hide tabs, a list the server does not give says so |
| `local-draw` | free outline, connect (neighbour gets two corners), extend, refusal in words, save sheet, a server that cannot store says so |
| `local-join` | code typed, pasted or from `/beitreten/<code>`, wrong codes in words, account with second factor, passkey |
| `local-offline` | manifest, service worker, reload without network starts the app with its map, queued marks go out when the network is back |

## Layers (each uses only the ones above it in this list)

| Layer | What |
| --- | --- |
| `platform` | typed wrappers over the browser: storage with memory fallback, theme, viewport variables, wake lock, vibration, geolocation, tone, clipboard, keyboard, IndexedDB, http |
| `model` | pure: `World` (Aktion, Gruppen, Gebiete, Läufe, Personen, Zugänge), `Rights` (mirror of `flyermap_identity::decide`; the server still decides), `Subject` and its actions |
| `backend` | the seam: `trait Backend` (boot, pack, push/pull, lists, save Gebiete, redeem, sign in) with `mock` (invented Aktion, five personas, synthetic neighbourhoods as real packs) and `v5` (the `/api/v5` bridge of the Rust Worker; what it cannot do answers `Unsupported`) |
| `engine`, `field`, `map`, `sync`, `session` | the street engine in a Web Worker, loading packs into one field and its marking index, the MapLibre bridge (tile protocol, feature state, finger rules), the store and `flyermap_sync` host, the running app (`Session`) |
| `marking`, `drawing`, `shell` | pure rules: marking state and the panel's six places; drawing state, verdict (hints in German), drafts; navigation reducer, layout, keyboard |
| `ui` | design system: icons (63), buttons, rows, sheet, command bar with results, status tiles, tabs, palette |
| `features` | the screens: map, mode (marking panel, tools), quick bar, live, search, subject (sheets at the thing), studio, draw, join, overview, settings, help |
| `app` | wiring: state, frame with its zones, search host, shortcuts, studio, marking, drawing, boot |

Zones (`app/zones.rs`): Top (bar, live strip), Notice, Panel (tool panel), Bottom (quick bar, mode button on the thumb's side), Sheet, Overlay. A zone only positions.
The Studio is a column next to the stage from 900 px and a sheet below. Files are ≤ 300 lines (hard limit 500, `rs-check.sh` enforces it); `mod.rs` only declares.

## Numbers (release, headless Chromium; nothing measured on a real phone)

First load, brotli 11: app wasm 494 kB, MapLibre 353 kB, engine 180 kB, glue + css 29 kB, rest 30 kB: **1.09 MB**; afterwards everything is on the device (service worker).

| App wasm | raw | gzip -9 | brotli 11 |
| --- | --- | --- | --- |
| shell with fake data (first slice, `z`) | 499 kB | 188 kB | 153 kB |
| now, plain `z` | 1.81 MB | 689 kB | 536 kB |
| now, `z` + `erase_components` (**built**) | 1.70 MB | 630 kB | 494 kB |
| plain `z` + `wasm-opt -Oz` (v112, via npm) | 1.61 MB | 694 kB | 541 kB |

`erase_components` is set in `rs-web-build.sh` for this build only (own target directory `target/web-wasm`; nothing else uses Leptos). `wasm-opt` shrinks the raw file but not
what is transferred (gzip +0.8 %, brotli +1 %), so it is not in the build. Growth of the plain `z` build, raw, by step: map, store, sync, marking 1.33 MB; + search
(`flyermap-search`), sheets at the thing, keyboard 1.58 MB; + Studio 1.65 MB; + drawing (`flyermap-area`) 1.75 MB; + way in 1.81 MB; + offline 1.81 MB.

## Decisions

- **One panel for every marking mode.** Six places (mode, status, context, options, undo, confirm) in a 12-column grid; a mode only changes what stands in a place, never where. Mirrored for the left hand.
- **Search is `flyermap-search`**, fed by the app: Gebiete, Gruppen, people (only for those who manage them), commands (only what the rights allow) change entry by entry; streets and houses are built in one go after loading. Läufe are not searchable (they are in the live strip and the Studio).
- **Sheets at the thing**: a house, a street piece, a Gebiet, a Gruppe, a person, a Lauf, an invitation open *their* sheet with *their* actions; the same sheets from the map, the search and the Studio.
- **Rights are a mirror.** The screen offers what `Rights` allows; every write is judged again by the server (proved: a foreign Gebiet is refused with `area_forbidden`).
- **Offline.** `sw.js` (one cache per build, all or nothing) holds the shell; the v5 bridge remembers the last `/meta` and the last pack of each Gebiet in IndexedDB and uses them only when the server is not reached or fails itself, never after a refusal. A new build takes over on the next load.
- **Drawing by taps**, snapped to borders within 22 px (zoom aware); geometry and checks are `flyermap-area`. A drawing that does not work says why in German and what to do; it stays until undone.
- **Way in**: an invitation makes the device a guest, an account signs in (passkey, password, six digits). UI and states only.
- Wake lock and the clipboard are unstable in `web-sys`; they are reached through `js_sys::Reflect`.
- Leptos 0.8 notes: `Memo::new` needs `Send + Sync` closures (use `StoredValue::new_local` for browser objects), `<For>` keys must be `Hash`, `style:--x=` wants a `String`, `>` inside a `view!` attribute closure needs a named closure.

## Found in the existing crates

- `flyermap-identity` pulls crypto crates (and so `getrandom` with its `js` feature) into the client for what is only `decide`: worth splitting by feature.
- The test Worker's clock stands still (`TEST_FIXED_NOW_MS`, so the seeded sessions stay valid) and every pull sets the device clock back to it (`Store::sync_clock`); the hybrid clock never goes backwards, but two edits a second apart are ordered by counter, not by time. `local-sync` therefore checks that devices *agree*, not who wins.
- `scripts/rs-e2e/app-server.mjs` died on a missing file (`ERR_HTTP_HEADERS_SENT`): fixed.
- `engine`'s `session_search` is unused now (`flyermap-search` covers streets and addresses); `engine.House` already carried number and street, the web crate now reads them.

## Not there yet (honest list)

- Real devices: nothing was run on a phone; touch, GPS, haptics, keyboard and iOS behaviour are untested beyond headless Chromium with CDP touch events.
- v5 server limits: no invitations, people, access lists or saving Gebiete (`Unsupported`, said in words); Läufe come from the old Räume.
- Actions without effect yet (a note says so): start/end a Lauf, take a Gebiet (Abholen), members, change role, remove, show code, revoke.
- Notes, Abholen specials (pickups, special markers), templates, diagnostics screens, the "Vorschau auf der Karte" while hovering a search result, jumping to a Gruppe as a command.
- Camera scan of a QR code (the link a QR opens is handled), WebAuthn call behind the passkey button, freehand drawing, pinch/long-press object previews, screen-reader pass.
