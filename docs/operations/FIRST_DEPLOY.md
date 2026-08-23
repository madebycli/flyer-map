---
id: operations-first-deploy
type: operations
status: active
last_updated: 2026-08-24
related: [operations-deployment, architecture-stack]
---

# First Cloudflare Deployment

This guide is the one-time setup for publishing Verteil-Flyer from GitHub to Cloudflare Workers.

## Goal

After this setup:

- `main` is connected to Cloudflare Workers Builds.
- every production push to `main` can build and deploy automatically.
- the app is reachable on a public `*.workers.dev` URL.
- `/api/health` responds successfully.
- the map can be opened and tested on a real phone.

## Before you start

You need:

- a free Cloudflare account
- access to the GitHub account that owns `madebycli/flyer-map`

You do not need:

- a custom domain
- a credit card for this initial setup
- a D1 database yet
- to download the repository to a computer

## Step-by-step

1. Create or sign in to your Cloudflare account.
2. In the Cloudflare dashboard, open **Workers & Pages**.
3. Select **Create application**.
4. Choose **Import a repository**.
5. Connect GitHub when prompted.
6. Authorize Cloudflare to access the repository `madebycli/flyer-map`.
7. Select `madebycli/flyer-map`.
8. Ensure the Worker/project name is exactly `flyer-map`.
   - This must match the `name` field in `wrangler.jsonc`.
9. Use the repository root `/` as the root directory.
10. Production branch: `main`.
11. Build command: `npm run build`.
12. Deploy command: `npx wrangler deploy`.
    - If Cloudflare already supplies this as the default, keep the default.
13. Save and deploy.
14. Wait for the build to finish and open the generated `workers.dev` URL.

The final URL should look approximately like:

```text
https://flyer-map.<your-cloudflare-subdomain>.workers.dev
```

The exact account subdomain is chosen/provided by Cloudflare.

## Verification checklist

Open the production URL on your phone and check:

- the Verteil-Flyer page loads
- the map renders
- zooming and panning work
- the location control is visible
- allowing location shows your current location
- denying location does not break the app

Then open:

```text
https://<your-worker-url>/api/health
```

Expected result:

```json
{
  "ok": true,
  "service": "flyer-map"
}
```

The exact JSON may contain additional fields later, but `ok` must be `true`.

## If the build fails

Do not randomly change Cloudflare settings.

Record or copy:

1. the failed build step
2. the complete error message
3. the build command
4. the deploy command

Then give that information to a Verteil-Flyer coding agent together with the repository link.

## Important: do not create D1 yet

The repository already contains an initial SQL schema proposal, but the production D1 database should only be created when M1 persistence work starts.

Do not add a fake `database_id` to `wrangler.jsonc`.

## After the first successful deploy

Update `docs/status/CURRENT.md` with:

- the real production URL
- whether `/api/health` works
- Android test result
- iPhone test result if available

Then Plan 001 can be completed and archived, and M1 can start.
