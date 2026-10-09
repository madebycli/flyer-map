# Plan 047 — v5 field UI v2: calm, square, one big button

Status: UI v2 and template mode implemented on `claude/v5-field-core-clean`
Reference: product feedback of 2026-10-08, [Plan 043](043-v5-field-core.md), [Plan 045](045-v5-pickup-rooms-admin.md), [Plan 046](046-v5-rust-tiles.md)

## Principles

1. **Place by use frequency.** Marking a route is done all day → one floating button, always at the thumb. Drawing or reshaping an
   Area is rare (templates will be reused) → inside the Area sheet, admin/team-editor only, reached through the Home menu.
   Manual street adding is gone for good; the engine derives, people mark.
2. **One shape language.** Icon controls are squares (`--ctl`, 3 rem; the marking button 4 rem), long controls are horizontal
   pills of the same height, every corner is rounded (never sharp), borders are uniform. No ovals, no odd rectangles.
3. **Calm colour.** "Open" is a quiet slate and translucent, done is a soft green, later a muted amber, not possible a dusty rose
   (both themes). Status also drives opacity (open ≈ 0.5, done ≈ 0.9) so the basemap shows through and progress stands out.
   Lines are thin, the area fill is almost invisible, no backdrop blur anywhere (it is the most expensive CSS effect on old phones).
4. **Plain words.** Distribution: Offen / Ausgeteilt / Später / Nicht möglich; collection: Offen / Abgeholt / Später / Nicht möglich.
   Every status has a one-line hint (`labels.ts`), shown as tooltip, under the selected status and as legend in the overview.
5. **Short animations.** Morph by size/opacity only (≤ 200 ms), `prefers-reduced-motion` switches them off. The one playful
   element is the wavy progress line.

## The marking button (`fab.tsx`, `marking.tsx`)

| State | What you see | Gestures |
|---|---|---|
| idle | one square with the active mode's icon | tap → start (route mode); long press → options |
| panel (2×2) | points counter · undo last point · discard all / finish · ✓ | tap on the map adds a point on the nearest street; counter tile or long press → options |
| status (2×2) | Ausgeteilt · Später · Nicht möglich · Offen | one tap applies the route and returns to the panel, ready for the next route |
| options (4×3) | modes (Strecke, Tippen, Wischen, Lasso) · brush (for the three direct modes) · + Häuser · **Nur Straßen mit Häusern** · Beenden · weiter | persisted in `vf-v5-mark-2` |

A caption pill above the button says what is going on ("Startpunkt auf einer Straße antippen", "12 Straßen · 31 Häuser · 640 m",
"Nicht verbunden"). Beside the button: *Standort aktualisieren* (one fresh fix, no watcher left running), zoom ±, compass (only
while rotated).

**Nur Straßen mit Häusern.** The Rust tile cutter writes `h` = "1"/"0" on every street piece (junction-to-junction street has ≥ 1
house); the layers filter on it, the key builders (`mark.ts`) skip such streets in tap, paint, lasso and route marking.

## Home menu, overview, search

- **Menü** (top right): Austeilen/Abholen switch (admin), Übersicht, Suche, Gebiete, Notizen, Sonder-Marker, Alles zeigen, Hell/Dunkel,
  Hand, Karte aus/an, Alt-Import, Alte Ansicht, Verwaltung. App-icon grid of squares.
- **Übersicht** (tap the percentage capsule): percentage **by houses** (done / (all − not possible)), the four counts, per Area, per
  group/team, sync state (all saved / n pending / offline, last success, last error, "Jetzt abgleichen"), conflicts, colour legend,
  engine in use.
- **Suche** (top right): streets and house numbers, folded for case, umlauts and "Str."/"Straße"; picking a result flies there and opens it.

## Server and configuration

- `GET …/meta` carries `basemap` (`{dark, light}` or null). The client contains **no** third-party map URL; the deployment sets
  `V5_BASEMAP_DARK` / `V5_BASEMAP_LIGHT` (https or same-origin path; `off` = plain background). `worker/v5/config.ts` holds the
  defaults and `OSM_OVERPASS_URL` is now actually passed to the v5 handler. "Karte aus" in the menu is the per-device switch.
- `POST …/areas/:areaId/prune {keys}` (admin only): removes progress rows of that Area for keys the derivation no longer produces
  (after reshaping an Area). The client lists only keys absent from the merged network, and only when no Area is missing.
- Roles (audited, unchanged): viewer reads only; field-group-member and collection-collector write status in their Areas only; area
  editing and pack building are admin/team-editor; prune and import are admin. The UI mirrors, the server decides.

## Leak hardening

The poll idles while the page is hidden and never stacks meta requests; the soak flow (`soak.mjs`) covers reload, lock/unlock and
many-Area map moves with context loss. Locate keeps no watcher. Provider and tile caches are released in `FieldMap.destroy`.

## Template mode (built)

An Area template is a small JSON file `{format, version, name, ring, rules}` (`areas/template.ts`; no progress, no street data). The engine
derives streets and houses again from the outline, so a template needs no migration.

- **Save:** Area sheet → "Als Vorlage speichern" (download, safe file name).
- **Load:** Menü → "Vorlage laden" (new Area) or Area sheet → "Vorlage auf dieses Gebiet anwenden" (replaces the outline). The file is
  untrusted input: size, shape, coordinate range and polygon validity are checked and the result is rebuilt field by field. The outline
  goes into the normal Area editor and is saved with ✓ (same validation, team choice, pack build); the rule "Nur Straßen mit Häusern" is applied.
- **Re-derive and remove what is now outside:** after a saved reshaping the app reloads, the Rust engine derives the new network, and for
  admins the progress rows of that Area that no longer exist are pruned on the server automatically (`POST …/prune`, notice with the count).
  Team editors reshape without the bulk delete; the Area sheet offers the clean-up to an admin later.
- Browser flow `flow10` covers export, refusal of foreign files, reshaping with automatic clean-up (west half stays, east half goes) and a new Area from a template.

## Not possible from this environment

Real-device checks (touch feel, GPS), real Overpass and D1 latency, and a production deploy. Everything else runs in the browser
flows (`scripts/v5-e2e/run-all.mjs`) in both engine modes.
