---
id: operations-deployment
type: operations
status: active
last_updated: 2026-08-24
related: [architecture-stack]
---

# Deployment

## Target

One Cloudflare Worker deployment containing:
- Vite-built React static assets
- Worker API routes
- later a D1 binding

The repository is the source of truth. Normal releases should flow from GitHub to Cloudflare automatically; downloading/uploading builds from a phone should not be required.

## First Cloudflare connection

Do this after the foundation pull request is green and merged.

1. Sign in to Cloudflare.
2. Open Workers & Pages.
3. Create/import a Worker application from GitHub.
4. Connect the GitHub account if needed.
5. Select `madebycli/flyer-map`.
6. Use the repository configuration (`wrangler.jsonc`) as the Worker source of truth.
7. Build command: `npm run build`.
8. Deploy command: `npx wrangler deploy` if the UI requests one.
9. Deploy and open the generated `workers.dev` URL.
10. Verify `/api/health` returns `{ "ok": true, ... }`.
11. Verify map rendering and geolocation on a phone.

Cloudflare's current React/Vite guidance supports the frontend assets and Worker API as one deployment through the Cloudflare Vite plugin.

## D1 setup (later milestone)

Do not create D1 until persistence work starts.

Expected CLI equivalent:

```bash
npx wrangler d1 create flyer-map-db --location=weur
```

Cloudflare returns a database id/binding configuration. Add that binding to `wrangler.jsonc` in a reviewed change, then apply migrations intentionally.

Never invent or commit a fake production database id.

## Release workflow

Preferred:

```text
feature branch -> pull request -> CI -> merge to main -> Cloudflare build/deploy
```

Production config changes should be reviewed like code changes.
