# flyermap-web

The Verteil-Flyer app in Rust (Leptos 0.8, client-side rendering, WebAssembly), Plan 059 milestone M5, first slice: **the shell with
fake data**. No map engine, no store, no server yet. The React app (`src/v5`, `src/ui`) is the reference for look and behaviour.

## Build, look, test

```sh
scripts/rs-web-build.sh --release     # cargo (wasm32, profile `web`) -> wasm-bindgen --target web -> dist-rs/ (git-ignored)
node scripts/rs-web-serve.mjs         # http://localhost:8150
node scripts/rs-e2e/shell.mjs         # browser flow: 390x844 and 1280x800, dark and light (screenshots go to $SHOTS_DIR or <tmp>/flyermap-rs-e2e)
cargo test -p flyermap-web            # native tests of the pure parts (run from flyermap-rs/)
node --experimental-transform-types scripts/rs-vectors/palette.ts [--check]   # palette vectors from src/ui/palette.ts
```

Without `--release` the build is a debug build (fast to compile, large). No Node bundler: `index.html` loads the `wasm-bindgen` module;
`assets/css/app.css` lists the stylesheets, the build script inlines them into one `app.css`. All URLs in `index.html` are relative, so the
same files work under `/rs/` next to the React app.

## Layers (each uses only the ones below)

| Layer | What | Files |
| --- | --- | --- |
| `platform` | typed wrappers over `web-sys`: local storage with an in-memory fallback, theme (`data-theme`, `theme-color`), settings with the React app's keys (`vf-v5-theme`, `vf-v5-hand`, `vf-v5-base`, `vf-awake`, `vf-haptics`, `vf-v5-seed`), viewport variables (`--vvh`, `--kb`, `data-kb`), wake lock, vibration, panic hook | `src/platform/*` |
| `ui` | the design system: `Icon` (all 57 icons of `src/ui/icons.tsx`, same names), `Button`/`IconButton` (4 variants each), `ListGroup`/`ListRow`/`SwitchRow`, `Segmented`, `Progress`, `Sheet` (handle, header, meta/actions/toolbar/footer slots), `CommandBar` with results card and `StatusPill`, `Toast`, `Card`/`Overlay`/`Hint`; the Material You palette (port of `src/ui/palette.ts`); status labels and colours; text folding for search | `src/ui/*` |
| `features` | the screens: Menü, Einstellungen, Farbe, Vorlagen, Übersicht, Hilfe, the search, the map stand-in | `src/features/*` |
| `app` | the shell state (plain data + one reducer), navigation, effects of the settings, the frame with its zones, made-up data | `src/app/*` |

Each file is one concept; `mod.rs` only declares and re-exports; the longest file is 278 lines.

## DOM contract kept

Menu button "Menü", search textbox "Straße oder Adresse suchen", `.v5-cmd`, `.v5-spot` (role listbox "Suchergebnisse") with `.v5-result`
options, `button.v5-pill` with `data-done`/`data-total`, `.v5-sheet` (section named by its title) with `.v5-handle`, "Zurück"/"Schließen",
rows as buttons named by their label, `Segmented` as `role=group` with `aria-pressed` buttons, `role=switch` rows with `aria-checked`,
`.v5-faqitem`, "Fragen durchsuchen", group "Grundfarbe" with nine swatches, `.v5-root[data-ui][data-hand]`, `.v5-map` named "Karte".

## Decisions and deviations

- **Profile `web`** (workspace `Cargo.toml`): release with `opt-level = "z"`. Measured for this slice (after `wasm-bindgen`):
  opt-level 3: 991 kB raw / 291 kB gzip / 204 kB brotli; 2: 939 / 278 / 196; s: 607 / 211 / 164; **z: 499 / 188 / 153**. Plus 38 kB JS glue
  and 33 kB CSS. `RS_WEB_PROFILE=release` builds with opt-level 3. `--cfg erase_components` (Leptos) gave z: 484 / 172 / 139 kB but needs a
  global `RUSTFLAGS`, which would also rebuild the digest-checked engine; not enabled. `wasm-opt` is not installed here; not measured.
- **Wake lock** is an unstable API in `web-sys`; it is reached through `js_sys::Reflect` instead of a crate-wide `--cfg web_sys_unstable_apis`.
- **Icons** are inline SVG whose inner markup is set with `inner_html` from one generated table (`ui/icon/table.rs`), not one `view!` per icon.
- **Tablet sheets**: `src/v5/app/v5.css` line 220 (`.v5-sheet { border-radius: … 0 0 }`) comes after the `@media (min-width: 600px)` rule
  of `components.css` and cancels its rounded bottom corners in the React app. It is left out here, so sheets from 600 px are rounded all
  round (checked by the flow). The dangling selector at `v5.css` line 32 is also left out.
- **Status pill** keeps `role="status"` on the `<button>` as in the React app (DOM contract). A button with that role loses its button
  semantics for screen readers; worth deciding when the flows are switched over.
- **Text folding** for search (help, bar) is a small hand-written map (umlauts, accents, `ß` → `ss`) instead of Unicode NFD, so no
  normalisation tables go into the WebAssembly. It finds a little more than the TypeScript version (`strasse` finds `Straße`).
- **`Button` variant `Quiet`** has one new CSS line (`.v5-btn.quiet`); everything else is the React app's CSS, copied rule by rule.
- **German texts** sit in the features (rows, help entries generated once from `help.tsx`) until `flyermap-wire::text` exists.
- Rows whose screen is not ported yet (Team, Runs, Notizen, Gebiete, …) show a note under the bar; "Verwaltung" asks in a card before
  leaving for the organiser pages.

## Not in this slice

MapLibre bridge and the real map, right rail / context chip / marking button zones, store, sync and the sync box of the overview, the
engine's search, Räume, diagnostics (`flyermap-diag`), the manifest. Measured only on desktop Chromium (headless); no real phone yet.
