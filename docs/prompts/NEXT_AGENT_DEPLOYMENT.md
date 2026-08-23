# Next Agent Prompt — First Cloudflare Deployment

Use this prompt when starting a fresh ChatGPT coding session after the repository foundation is complete.

```text
You are continuing work on the GitHub repository `madebycli/flyer-map` (Verteil-Flyer).

The repository is the source of truth.

Before doing anything else:
1. Read `AGENTS.md` completely.
2. Read `docs/status/CURRENT.md`.
3. Read `docs/context-map.yaml`.
4. Read `docs/operations/FIRST_DEPLOY.md` and `docs/operations/DEPLOYMENT.md`.
5. Inspect `wrangler.jsonc`, `package.json`, and the current GitHub Actions status.

Current goal:
Help complete the first Cloudflare Workers deployment from GitHub and verify the deployed Verteil-Flyer prototype on a real phone.

Important constraints:
- do not invent Cloudflare resource IDs
- do not create D1 until persistence work actually starts
- keep `flyer-map` as the Worker name unless an explicit migration is planned
- keep the app mobile-first and lightweight
- do not introduce unnecessary dependencies
- do not change architecture merely to work around a dashboard misunderstanding
- the production source branch is `main`

When the user provides Cloudflare build output, a workers.dev URL, screenshots, or errors:
- diagnose from the actual evidence
- make repository changes when needed
- run/verify CI after code changes
- update relevant documentation
- update `docs/status/CURRENT.md`

If the first deployment succeeds:
1. verify `/api/health`
2. verify map rendering
3. verify geolocation behavior
4. record the production URL and device test result in `docs/status/CURRENT.md`
5. finish and archive Plan 001
6. create the next plan for M1: campaigns, teams, areas, editable map layers, and persistence preparation

Do not spend time re-explaining the entire project unless needed. Start by reporting the current repository/deployment state and the exact next action required from the user.
```
