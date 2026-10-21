---
id: plan-056
status: active
date: 2026-10-21
---

# Plan 056: App shell (PWA)

Goal: the field tool feels like an app: one calm start screen, always the current version, installable, no accidental zoom, and joining works inside the installed app. Decision: [ADR-0038](../../decisions/ADR-0038-pwa-app-shell.md).

## Done when

1. **Start screen.** A dark page with the logo and one line of status shows at once and stays until the map and its data are ready; no cards or fields pop in underneath. Errors and "data missing" are full pages in the same style. The first paint is dark (no white flash) and follows the chosen theme.
2. **Versions.** `vMAJOR.MINOR.BUILD` is shown at the end of the menu and in `/version.json`; each push to `unstable` has a new BUILD.
3. **Updates.** At a cold start the app compares its build with `/version.json` and reloads once when a newer one is online (at most one try per build and session, never a loop). While running: check on return to the foreground and every 10 minutes; a newer build shows a banner at the top ("Neue Version … Jetzt aktualisieren"). A return after at least 30 minutes away reloads by itself (counts as a start).
4. **App feel.** Browser zoom is off on every page (viewport, `touch-action`, iOS gesture events); text selection and the long-press menu are off except in inputs; overscroll bounce is off; safe areas are respected. Fix: the undo bar and the loader follow the theme (dark by default).
5. **Install.** Manifest, icons (192, 512, maskable, Apple touch icon), service worker as in the ADR. On a phone or tablet in a normal browser tab, before the app loads, a guide shows the installation for iOS (Share, Add to Home Screen) and Android (install button or menu) with pictures; "Open in the browser anyway" hides it for a week. Desktop and the installed app never see it.
6. **Joining in the installed app.** The installed app opens a start page: continue the last Aktion, paste an invitation link, or sign in as organiser. Pasting a link redeems it exactly like opening it.

## Later (own steps, server work)

- **Join code.** A short one-time code per access link, shown where links are shown (also as QR), entered on the start page. Needs a column for the code's hash on the grant table, rate limiting like the link redemption, and no way to show it again (same rule as links).
- **QR codes and the installed app.** Android opens in-scope links in the installed app (manifest scope, `launch_handler`); iOS never does, so a QR code on iOS lands in Safari. The guide offers "copy link", the installed app pastes it; the code covers the rest.

## Not now

Offline start of a never-opened Aktion, push notifications, background sync, store apps.
